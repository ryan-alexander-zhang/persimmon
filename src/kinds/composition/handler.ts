// Handler of the composition kinds (21-composition.md): validate through the expansion, expand for the snapshot walk, never reconcile.
import type { Finding, HandlerImpl, ReconcileResult, ValidateResult } from '../../handler/types.js'
import type { Resource } from '../../resource/types.js'
import type { HandlerDeps } from '../deps.js'
import { gateHandler, validatorHandler } from '../gate/handler.js'
import { workflowHandler } from '../workflow/handler.js'
import { expandApproval, expandPipeline, type IsGate } from './expand.js'
import type { Approval, Pipeline } from './types.js'

export function compositionHandler(deps: HandlerDeps): HandlerImpl {
  const isGate: IsGate = (ref) => deps.kinds.byKind(ref.kind)?.definition.spec.stepContract?.runKind.kind === 'GateRun'

  const expand = (resource: Resource): Resource[] => {
    switch (resource.kind) {
      case 'Pipeline':
        return [expandPipeline(resource as unknown as Pipeline, isGate) as unknown as Resource]
      case 'Approval':
        return expandApproval(resource as unknown as Approval) as unknown as Resource[]
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
      return (impls[r.kind]?.validate(r).findings ?? []).map((f) => ({ ...f, message: `${label}: ${f.message}` }))
    })
  }

  return {
    validate(resource: Resource): ValidateResult {
      try {
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
