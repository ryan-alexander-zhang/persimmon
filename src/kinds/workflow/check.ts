// Static rules of 11-workflow.md and the port rules of 10-ports.md, on one Workflow against its closure.
import type { Finding } from '../../handler/types.js'
import { ExpressionError } from '../../expression/site.js'
import { readPath } from '../../reconcile/merge-patch.js'
import { sameType, siteOf } from '../ports/ports.js'
import type { Binding, InputSpec, OutputSpec, PortType } from '../ports/types.js'
import type { Step, StepContract, WorkflowSpec } from './types.js'

/** What the checker needs about a used definition. */
export interface Used {
  contract: StepContract
  inputs: Record<string, InputSpec>
  outputs: Record<string, OutputSpec>
}

export type Resolve = (ref: { kind: string; name: string }) => Used | undefined

export function checkWorkflow(spec: WorkflowSpec, resolve: Resolve): Finding[] {
  const f: Finding[] = []
  const bad = (path: string, message: string, code = 'invalid_workflow') => f.push({ severity: 'error', code, path, message })

  const steps = new Map<string, Step>()
  for (const [i, s] of spec.steps.entries()) {
    if (steps.has(s.id)) bad(`/spec/steps/${i}/id`, `duplicate step id ${s.id}`)
    steps.set(s.id, s)
  }
  const used = new Map<string, Used>()
  for (const [i, s] of spec.steps.entries()) {
    const u = resolve(s.uses)
    if (!u) bad(`/spec/steps/${i}/uses`, `${s.uses.kind} ${s.uses.name} does not resolve or has no stepContract`)
    else used.set(s.id, u)
  }

  // graph
  const inDegree = new Map<string, number>([...steps.keys()].map((k) => [k, 0]))
  const fromCount = new Map<string, number>([...steps.keys()].map((k) => [k, 0]))
  const edges = new Map<string, Set<string>>([...steps.keys()].map((k) => [k, new Set()]))
  const tids = new Set<string>()
  for (const [i, t] of spec.transitions.entries()) {
    const path = `/spec/transitions/${i}`
    if (tids.has(t.id)) bad(`${path}/id`, `duplicate transition id ${t.id}`)
    tids.add(t.id)
    for (const fr of t.from) {
      if (!steps.has(fr.stepRef)) bad(`${path}/from`, `unknown step ${fr.stepRef}`)
      else fromCount.set(fr.stepRef, (fromCount.get(fr.stepRef) ?? 0) + 1)
    }
    if (t.join?.strategy === 'quorum' && (t.join.count ?? 0) > t.from.length) bad(`${path}/join`, `quorum count ${t.join.count} > ${t.from.length} from entries`)
    const stepTargets = t.to.filter((x) => 'stepRef' in x)
    const terminals = t.to.filter((x) => 'terminal' in x)
    if ((t.dispatch ?? 'all') === 'all' && terminals.length > 0 && (stepTargets.length > 0 || terminals.length > 1))
      bad(`${path}/to`, 'dispatch all: steps only, or one terminal')
    for (const x of stepTargets as { stepRef: string }[]) {
      if (!steps.has(x.stepRef)) bad(`${path}/to`, `unknown step ${x.stepRef}`)
      else {
        inDegree.set(x.stepRef, (inDegree.get(x.stepRef) ?? 0) + 1)
        for (const fr of t.from) edges.get(fr.stepRef)?.add(x.stepRef)
      }
    }
  }
  for (const [id, n] of fromCount) if (n !== 1) bad('/spec/transitions', `step ${id} is from of ${n} transitions; exactly one required`)
  const zeroIn = [...inDegree].filter(([, n]) => n === 0).map(([k]) => k).sort()
  if (JSON.stringify(zeroIn) !== JSON.stringify([...spec.entry].sort())) bad('/spec/entry', `entry must equal the zero in-degree set ${zeroIn.join(', ')}`)

  // DAG and predecessor sets
  const preds = new Map<string, Set<string>>()
  const state = new Map<string, 0 | 1 | 2>()
  const visit = (id: string, stack: string[]): void => {
    if (state.get(id) === 2) return
    if (state.get(id) === 1) {
      bad('/spec/transitions', `cycle through ${[...stack, id].join(' -> ')}`)
      return
    }
    state.set(id, 1)
    const p = new Set<string>()
    for (const [from, tos] of edges) if (tos.has(id)) {
      visit(from, [...stack, id])
      p.add(from)
      for (const q of preds.get(from) ?? []) p.add(q)
    }
    preds.set(id, p)
    state.set(id, 2)
  }
  for (const id of steps.keys()) visit(id, [])

  // ports and bindings
  const stepOutputs = (id: string) => used.get(id)?.outputs ?? {}
  const siteFor = (visible: Set<string>, step?: Step) =>
    siteOf({
      inputs: spec.inputs ?? {},
      steps: Object.fromEntries([...visible].map((id) => [id, stepOutputs(id)])),
      ...(step?.repeat ? { state: step.repeat.state, iterationOutputs: stepOutputs(step.id) } : {}),
    })
  const bindingType = (b: Binding, step: Step | undefined, visible: Set<string>, path: string): PortType | 'value' | undefined => {
    if ('literal' in b || 'expression' in b) {
      if ('expression' in b) {
        try {
          siteFor(visible, step).check(b.expression)
        } catch (e) {
          if (e instanceof ExpressionError) bad(path, `expression: ${e.message}`)
          else throw e
        }
      }
      return 'value'
    }
    if ('fromInput' in b) {
      const p = spec.inputs?.[b.fromInput]
      if (!p) bad(path, `unknown input ${b.fromInput}`)
      return p?.type
    }
    if ('fromStep' in b) {
      if (!visible.has(b.fromStep.stepRef)) bad(path, `step ${b.fromStep.stepRef} is not a predecessor`)
      const p = stepOutputs(b.fromStep.stepRef)[b.fromStep.output]
      if (!p && visible.has(b.fromStep.stepRef)) bad(path, `${b.fromStep.stepRef} has no output ${b.fromStep.output}`)
      return p?.type
    }
    if ('fromState' in b) {
      if (!step?.repeat) bad(path, 'fromState outside repeat')
      const p = step?.repeat?.state[b.fromState]
      if (step?.repeat && !p) bad(path, `unknown state ${b.fromState}`)
      return p?.type
    }
    if ('fromIterationOutput' in b) {
      if (!step?.repeat) bad(path, 'fromIterationOutput outside repeat')
      return stepOutputs(step?.id ?? '')[b.fromIterationOutput]?.type
    }
    bad(path, 'fromEvent only in Trigger')
    return undefined
  }
  const checkBindings = (bindings: Record<string, Binding>, consumer: Record<string, InputSpec | OutputSpec>, step: Step | undefined, visible: Set<string>, path: string, requiredCheck: boolean) => {
    for (const [port, b] of Object.entries(bindings)) {
      const spec = consumer[port]
      if (!spec) {
        bad(`${path}/${port}`, `unknown port ${port}`)
        continue
      }
      const t = bindingType(b, step, visible, `${path}/${port}`)
      if (t === 'value') {
        if (spec.type.kind !== 'value') bad(`${path}/${port}`, 'literal and expression feed value ports only')
      } else if (t && !sameType(t, spec.type)) bad(`${path}/${port}`, 'producer type differs from consumer type')
      if (b.onMissing === 'omit' && (!requiredCheck || (spec as InputSpec).required !== false)) bad(`${path}/${port}`, 'onMissing: omit only on optional inputs')
    }
    if (requiredCheck) for (const [port, s] of Object.entries(consumer)) if ((s as InputSpec).required !== false && !bindings[port]) bad(path, `required input ${port} unbound`)
  }
  for (const [i, s] of spec.steps.entries()) {
    const u = used.get(s.id)
    if (!u) continue
    const visible = preds.get(s.id) ?? new Set()
    checkBindings(s.inputs ?? {}, u.inputs, s, visible, `/spec/steps/${i}/inputs`, true)
    if (s.repeat) {
      checkBindings(s.repeat.initial, s.repeat.state, undefined, visible, `/spec/steps/${i}/repeat/initial`, true)
      checkBindings(s.repeat.next, s.repeat.state, s, visible, `/spec/steps/${i}/repeat/next`, true)
      try {
        const t = siteFor(visible, s).check(s.repeat.until)
        if (t !== 'bool') bad(`/spec/steps/${i}/repeat/until`, `until is ${t}, not bool`)
      } catch (e) {
        if (e instanceof ExpressionError) bad(`/spec/steps/${i}/repeat/until`, `until: ${e.message}`)
        else throw e
      }
    }
  }
  const all = new Set(steps.keys())
  const outKeys = Object.keys(spec.outputs ?? {}).sort()
  const bindKeys = Object.keys(spec.outputBindings ?? {}).sort()
  if (JSON.stringify(outKeys) !== JSON.stringify(bindKeys)) bad('/spec/outputBindings', 'keys must equal outputs keys')
  checkBindings(spec.outputBindings ?? {}, spec.outputs ?? {}, undefined, all, '/spec/outputBindings', false)
  for (const [i, t] of spec.transitions.entries()) {
    const visible = new Set<string>()
    for (const fr of t.from) {
      visible.add(fr.stepRef)
      for (const p of preds.get(fr.stepRef) ?? []) visible.add(p)
    }
    for (const [j, x] of t.to.entries())
      if (x.when) {
        try {
          const ty = siteFor(visible).check(x.when)
          if (ty !== 'bool') bad(`/spec/transitions/${i}/to/${j}/when`, `when is ${ty}, not bool`)
        } catch (e) {
          if (e instanceof ExpressionError) bad(`/spec/transitions/${i}/to/${j}/when`, `when: ${e.message}`)
          else throw e
        }
      }
  }
  return f
}

/** Reads a stepContract path like `spec.inputs` on a definition. */
export const contractPorts = (def: Record<string, unknown>, path: string) => (readPath(def, path) ?? {}) as Record<string, InputSpec & OutputSpec>
