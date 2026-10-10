// Handler of the composition kinds (21-composition.md): validate through the expansion, expand for the snapshot walk, never reconcile.
import type { Finding, HandlerImpl, ReconcileResult, ValidateResult } from '../../handler/types.js'
import type { Resource } from '../../resource/types.js'
import type { HandlerDeps } from '../deps.js'
import { gateHandler, validatorHandler } from '../gate/handler.js'
import { workflowHandler } from '../workflow/handler.js'
import { expandApproval, expandPipeline, expandReviewLoop, type IsGate, type Ports } from './expand.js'
import type { Approval, Pipeline, ReviewLoop } from './types.js'
import type { InputSpec, OutputSpec } from '../ports/types.js'

export function compositionHandler(deps: HandlerDeps): HandlerImpl {
  const isGate: IsGate = (ref) => deps.kinds.byKind(ref.kind)?.definition.spec.stepContract?.runKind.kind === 'GateRun'
  /** Ports of a live definition, a composition read through its expansion (every step kind keeps them at spec.inputs/outputs). */
  const ports = (ns: string | undefined): Ports => (ref) => {
    const kd = deps.kinds.byKind(ref.kind)?.definition
    const live = deps.getResource(ref.kind, ns, ref.name)
    const def = live && kd?.spec.expansion && deps.expand ? deps.expand(live)[0] : live
    const spec = def?.spec as { inputs?: Record<string, InputSpec>; outputs?: Record<string, OutputSpec> } | undefined
    return spec ? { inputs: spec.inputs ?? {}, outputs: spec.outputs ?? {} } : undefined
  }

  /** ReviewLoop rules the expansion cannot express (21-composition.md). */
  const loopFindings = (r: ReviewLoop): Finding[] => {
    const f: Finding[] = []
    const bad = (path: string, message: string) => f.push({ severity: 'error', code: 'invalid_loop', path, message })
    const p = ports(r.metadata.namespace)(r.spec.produce.uses)
    if (!p) bad('/spec/produce/uses', `${r.spec.produce.uses.kind} ${r.spec.produce.uses.name} not found`)
    else {
      if (!p.outputs[r.spec.subject]) bad('/spec/subject', `${r.spec.subject} is not an output of ${r.spec.produce.uses.name}`)
      for (const [field, port] of [['previous', r.spec.previous], ['feedback', r.spec.feedback]] as const) {
        if (!port) continue
        const i = p.inputs[port]
        if (!i) bad(`/spec/${field}`, `${port} is not an input of ${r.spec.produce.uses.name}`)
        else if (i.required !== false) bad(`/spec/${field}`, `${port} must be an optional input (required: false): round 1 has nothing to feed back`)
      }
    }
    if (!isGate(r.spec.review.uses)) bad('/spec/review/uses', `${r.spec.review.uses.kind} ${r.spec.review.uses.name} does not run as a GateRun`)
    return f
  }

  const expand = (resource: Resource): Resource[] => {
    switch (resource.kind) {
      case 'Pipeline':
        return [expandPipeline(resource as unknown as Pipeline, isGate) as unknown as Resource]
      case 'Approval':
        return expandApproval(resource as unknown as Approval) as unknown as Resource[]
      case 'ReviewLoop':
        return expandReviewLoop(resource as unknown as ReviewLoop, ports(resource.metadata.namespace)) as unknown as Resource[]
      default:
        throw new Error(`${resource.kind} has no expansion`)
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
      return (impls[r.kind]?.validate(r).findings ?? []).map((f) => ({ ...f, message: `${label}: ${f.message}`, ...(f.path && composition.kind === 'Pipeline' ? { path: f.path.replace(/^\/spec\/steps\//, '/spec/phases/') } : {}) })) // a phase is a step: the path points at what the user wrote
    })
  }

  return {
    validate(resource: Resource): ValidateResult {
      try {
        if (resource.kind === 'ReviewLoop') {
          const own = loopFindings(resource as unknown as ReviewLoop)
          if (own.length) return { findings: own } // the expansion would only repeat them in other words
        }
        return { findings: check(resource, expand(resource)) }
      } catch (e) {
        return { findings: [{ severity: 'error', code: 'expansion', message: (e as Error).message }] }
      }
    },
    expand: (resource: Resource) => ({ resources: expand(resource) }),
    reconcile(): ReconcileResult {
      return { actions: [] } // a composition never runs; its expansion does
    },
  }
}
