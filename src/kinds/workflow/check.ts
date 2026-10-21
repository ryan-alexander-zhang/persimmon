// Static rules of 11-workflow.md and the port rules of 10-ports.md, on one Workflow against its closure.
import type { Finding } from '../../handler/types.js'
import { ExpressionError } from '../../expression/site.js'
import { readPath } from '../../reconcile/merge-patch.js'
import { optional, requiredFindings, sameType, siteOf } from '../ports/ports.js'
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
  const f: Finding[] = requiredFindings(spec.inputs)
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
  const siteFor = (visible: Set<string>, step?: Step, withState = true) =>
    siteOf({
      inputs: spec.inputs ?? {},
      steps: Object.fromEntries([...visible].map((id) => [id, stepOutputs(id)])),
      ...(step?.repeat ? { ...(withState ? { state: step.repeat.state } : {}), iterationOutputs: stepOutputs(step.id) } : {}), // `until` reads iteration and inputs, not state (11-workflow.md)
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
    if ('fromArtifact' in b) {
      try {
        const type = siteFor(visible, step).check(b.fromArtifact.id)
        if (type !== 'string') bad(path, `fromArtifact id is ${type}, not string`)
      } catch (e) {
        if (e instanceof ExpressionError) bad(path, `fromArtifact id: ${e.message}`)
        else throw e
      }
      return { kind: 'artifact', artifactKind: b.fromArtifact.kind }
    }
    if ('first' in b) {
      // every alternative is checked as a binding of its own and all agree on the type; a predecessor one path skips may be absent here by design
      const types = b.first.map((alt, i) => {
        if (alt.onMissing) bad(`${path}/first/${i}`, 'onMissing inside first; put it on first')
        return bindingType(alt, step, visible, `${path}/first/${i}`)
      })
      const t0 = types.find((t) => t !== undefined)
      for (const [i, t] of types.entries()) if (t && t0 && !(t === 'value' ? t0 === 'value' : t0 !== 'value' && sameType(t, t0))) bad(`${path}/first/${i}`, 'alternatives differ in type')
      return t0
    }
    if ('fromQuery' in b) {
      try {
        const type = siteFor(visible, step).extend({ content: {} }).check(b.fromQuery.where) // `content` is the revision tested, dyn: its fields show at bind
        if (type !== 'bool' && type !== 'dyn') bad(path, `fromQuery where is ${type}, not bool`)
      } catch (e) {
        if (e instanceof ExpressionError) bad(path, `fromQuery where: ${e.message}`)
        else throw e
      }
      return { kind: 'artifacts', artifactKind: b.fromQuery.kind }
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
      if (b.onMissing === 'omit' && (!requiredCheck || !optional(spec as InputSpec))) bad(`${path}/${port}`, 'onMissing: omit only on optional inputs')
    }
    if (requiredCheck) for (const [port, s] of Object.entries(consumer)) if (!optional(s as InputSpec) && !bindings[port]) bad(path, `required input ${port} unbound`)
  }
  for (const [i, s] of spec.steps.entries()) {
    const u = used.get(s.id)
    if (!u) continue
    const visible = preds.get(s.id) ?? new Set()
    checkBindings(s.inputs ?? {}, u.inputs, s, visible, `/spec/steps/${i}/inputs`, true)
    if (s.memo) {
      for (const port of s.memo.ignore ?? []) if (!u.inputs[port]) bad(`/spec/steps/${i}/memo/ignore`, `${port}: not an input of ${s.uses.kind} ${s.uses.name}`)
      if (s.memo.when)
        try {
          const t = siteOf({ outputs: u.outputs }).check(s.memo.when)
          if (t !== 'bool') bad(`/spec/steps/${i}/memo/when`, `when is ${t}, not bool`)
        } catch (e) {
          if (e instanceof ExpressionError) bad(`/spec/steps/${i}/memo/when`, `when: ${e.message}`)
          else throw e
        }
    }
    if (s.repeat) {
      for (const [v, st] of Object.entries(s.repeat.state)) if (typeof st.required === 'object') bad(`/spec/steps/${i}/repeat/state/${v}/required`, `${v}: a state var is required or not; nothing evaluates an expression there`)
      checkBindings(s.repeat.initial, s.repeat.state, undefined, visible, `/spec/steps/${i}/repeat/initial`, true)
      checkBindings(s.repeat.next, s.repeat.state, s, visible, `/spec/steps/${i}/repeat/next`, true)
      try {
        const t = siteFor(visible, s, false).check(s.repeat.until)
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
