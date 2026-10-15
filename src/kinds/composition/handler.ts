// Handler of the composition kinds (21-composition.md): validate through the expansion, expand for the snapshot walk, never reconcile.
import type { Finding, HandlerImpl, ReconcileResult, ValidateResult } from '../../handler/types.js'
import type { Resource } from '../../resource/types.js'
import type { HandlerDeps } from '../deps.js'
import { gateHandler, validatorHandler } from '../gate/handler.js'
import { workflowHandler } from '../workflow/handler.js'
import { expandApproval, expandPipeline, expandReviewLoop, type IsGate, type Ports } from './expand.js'
import type { Approval, Pipeline, ReviewLoop } from './types.js'
import type { InputSpec, OutputSpec } from '../ports/types.js'
import { optional } from '../ports/ports.js'

export function compositionHandler(deps: HandlerDeps): HandlerImpl {
  const isGate: IsGate = (ref) => deps.kinds.byKind(ref.kind)?.definition.spec.stepContract?.runKind.kind === 'GateRun'
  /** Ports of a live definition, a composition read through its expansion (every step kind keeps them at spec.inputs/outputs). */
  const ports = (ns: string | undefined): Ports => (ref) => {
    const kd = deps.kinds.byKind(ref.kind)?.definition
    const live = deps.getResource(ref.kind, ns, ref.name)
    const def = live && kd?.spec.expansion && deps.expand ? deps.expand(live, ns)[0] : live
    const spec = def?.spec as { inputs?: Record<string, InputSpec>; outputs?: Record<string, OutputSpec> } | undefined
    return spec ? { inputs: spec.inputs ?? {}, outputs: spec.outputs ?? {} } : undefined
  }

  /** Approval rules the expansion cannot express (21-composition.md): every mapped port exists on both sides, every required Task input is mapped. */
  const approvalFindings = (a: Approval, ns: string | undefined): Finding[] => {
    const f: Finding[] = []
    const bad = (path: string, message: string) => f.push({ severity: 'error', code: 'invalid_approval', path, message })
    const seen = new Set<string>()
    for (const [i, ap] of a.spec.approvers.entries()) {
      if (seen.has(ap.name)) bad(`/spec/approvers/${i}/name`, `duplicate approver ${ap.name}`)
      seen.add(ap.name)
      const task = ports(ns)(ap.uses)
      if (!task) {
        bad(`/spec/approvers/${i}/uses`, `Task ${ap.uses.name} not found`)
        continue
      }
      const mapping = ap.inputs ?? Object.fromEntries(Object.keys(a.spec.inputs).map((p) => [p, p]))
      for (const [taskPort, port] of Object.entries(mapping)) {
        if (!task.inputs[taskPort]) bad(`/spec/approvers/${i}/inputs/${taskPort}`, `${taskPort} is not an input of Task ${ap.uses.name}`)
        if (!a.spec.inputs[port]) bad(`/spec/approvers/${i}/inputs/${taskPort}`, `${port} is not an input of this Approval`)
      }
      for (const [taskPort, spec] of Object.entries(task.inputs)) if (!optional(spec) && !(taskPort in mapping)) bad(`/spec/approvers/${i}/inputs`, `required input ${taskPort} of Task ${ap.uses.name} is not mapped`)
    }
    return f
  }

  /** ReviewLoop rules the expansion cannot express (21-composition.md). */
  const loopFindings = (r: ReviewLoop, ns: string | undefined): Finding[] => {
    const f: Finding[] = []
    const bad = (path: string, message: string) => f.push({ severity: 'error', code: 'invalid_loop', path, message })
    const { produce, review, subject, previous, feedback, inputs = {} } = r.spec
    const p = ports(ns)(produce.uses)
    if (!p) bad('/spec/produce/uses', `${produce.uses.kind} ${produce.uses.name} not found`)
    else {
      if (!p.outputs[subject]) bad('/spec/subject', `${subject} is not an output of ${produce.uses.kind} ${produce.uses.name}`)
      for (const [field, port] of [['previous', previous], ['feedback', feedback]] as const) {
        if (!port) continue
        const i = p.inputs[port]
        if (!i) bad(`/spec/${field}`, `${port} is not an input of ${produce.uses.kind} ${produce.uses.name}`)
        else if (i.required !== false) bad(`/spec/${field}`, `${port} must be an optional input (required: false): round 1 has nothing to feed back`)
        if (produce.inputs?.[port]) bad(`/spec/produce/inputs/${port}`, `${port} is fed by the loop (${field}); do not bind it`)
        if (field in inputs) bad(`/spec/inputs/${field}`, `${field} is a name the loop reserves for its state`)
      }
    }
    if (['passed', 'rounds', 'verdict'].includes(subject)) bad('/spec/subject', `${subject} is a name the loop reserves for its own outputs`) // shadowed, so it could never carry the subject
    if ('maxRounds' in inputs) bad('/spec/inputs/maxRounds', 'maxRounds is the input the loop adds itself; set spec.maxRounds for the ceiling')
    if (!deps.kinds.byKind(review.uses.kind)) bad('/spec/review/uses', `unregistered kind ${review.uses.kind}`)
    else if (!isGate(review.uses)) bad('/spec/review/uses', `${review.uses.kind} ${review.uses.name} does not run as a GateRun`)
    return f
  }

  const expanding = new Set<string>() // compositions mid-expansion: a loop whose produce leads back to itself is a cycle, not a stack overflow

  const expand = (resource: Resource, ns = resource.metadata.namespace): Resource[] => {
    const key = `${resource.kind}/${resource.metadata.namespace ?? ''}/${resource.metadata.name}`
    if (expanding.has(key)) throw new Error(`${resource.kind} ${resource.metadata.name} expands through itself`)
    expanding.add(key)
    try {
      switch (resource.kind) {
        case 'Pipeline':
          return [expandPipeline(resource as unknown as Pipeline, isGate) as unknown as Resource]
        case 'Approval':
          return expandApproval(resource as unknown as Approval) as unknown as Resource[]
        case 'ReviewLoop':
          return expandReviewLoop(resource as unknown as ReviewLoop, ports(ns)) as unknown as Resource[]
        default:
          throw new Error(`${resource.kind} has no expansion`)
      }
    } finally {
      expanding.delete(key)
    }
  }

  /** The expansion's own rules: its kind's schema, no live definition of that kind and name in the scope, then its Handler's validate, which sees the sibling expansions as if stored. */
  const check = (composition: Resource, expanded: Resource[]): Finding[] => {
    const siblings: HandlerDeps = { ...deps, getResource: (kind, ns, name) => expanded.find((r) => r.kind === kind && r.metadata.name === name && r.metadata.namespace === ns) ?? deps.getResource(kind, ns, name) }
    const impls: Record<string, HandlerImpl> = { Workflow: workflowHandler(siblings), Gate: gateHandler(siblings), Validator: validatorHandler(siblings) }
    return expanded.flatMap((r) => {
      const label = `${r.kind}/${r.metadata.name}`
      const taken = deps.getResource(r.kind, composition.metadata.namespace, r.metadata.name)
      if (taken && taken.metadata.namespace === composition.metadata.namespace) return [{ severity: 'error' as const, code: 'name_taken', message: `${label}: a ${r.kind} of that name exists; the expansion of ${composition.kind} ${composition.metadata.name} needs it` }]
      try {
        deps.kinds.validateResource(r)
      } catch (e) {
        return [{ severity: 'error' as const, code: 'expansion', message: `${label}: ${(e as Error).message}` }]
      }
      return (impls[r.kind]?.validate(r).findings ?? []).map((f) => ({ ...f, message: `${label}: ${f.message}`, ...(f.path ? { path: rebase(composition, r, f.path) } : {}) }))
    })
  }

  /** A finding on the expansion points at what the user wrote: a Pipeline phase is a step; a ReviewLoop body's steps are `produce` and `review`. */
  const rebase = (composition: Resource, expanded: Resource, path: string): string => {
    if (composition.kind === 'Pipeline') return path.replace(/^\/spec\/steps\//, '/spec/phases/')
    if (composition.kind === 'ReviewLoop') {
      const body = expanded.metadata.name === `${composition.metadata.name}-round`
      if (body && /^\/spec\/steps\/0(\/|$)/.test(path)) return path.replace(/^\/spec\/steps\/0/, '/spec/produce')
      if (body && /^\/spec\/steps\/1(\/|$)/.test(path)) return path.replace(/^\/spec\/steps\/1/, '/spec/review')
      if (!body && /^\/spec\/steps\/0\/repeat(\/|$)/.test(path)) return '/spec/maxRounds'
      if (/^\/spec\/inputs(\/|$)/.test(path)) return path
      return '/spec' // transitions, outputs, bindings: the loop's own, nothing the user wrote by that name
    }
    return path
  }

  return {
    validate(resource: Resource): ValidateResult {
      try {
        const own = resource.kind === 'ReviewLoop' ? loopFindings(resource as unknown as ReviewLoop, resource.metadata.namespace) : resource.kind === 'Approval' ? approvalFindings(resource as unknown as Approval, resource.metadata.namespace) : []
        if (own.length) return { findings: own } // the expansion would only repeat them in other words
        return { findings: check(resource, expand(resource)) }
      } catch (e) {
        return { findings: [{ severity: 'error', code: 'expansion', message: (e as Error).message }] }
      }
    },
    expand: (resource: Resource, namespace?: string) => ({ resources: expand(resource, namespace) }),
    reconcile(): ReconcileResult {
      return { actions: [] } // a composition never runs; its expansion does
    },
  }
}
