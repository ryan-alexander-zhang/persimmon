// Handler of the composition kinds (21-composition.md): validate through the expansion, expand for the snapshot walk, never reconcile.
import type { Finding, HandlerImpl, ReconcileResult, ValidateResult } from '../../handler/types.js'
import type { Resource } from '../../resource/types.js'
import type { HandlerDeps } from '../deps.js'
import { workflowHandler } from '../workflow/handler.js'
import { expandPipeline, type IsGate } from './expand.js'
import type { Pipeline } from './types.js'

export function compositionHandler(deps: HandlerDeps): HandlerImpl {
  const workflow = workflowHandler(deps)
  const isGate: IsGate = (ref) => deps.kinds.byKind(ref.kind)?.definition.spec.stepContract?.runKind.kind === 'GateRun'

  const expand = (resource: Resource): Resource[] => {
    switch (resource.kind) {
      case 'Pipeline':
        return [expandPipeline(resource as unknown as Pipeline, isGate) as unknown as Resource]
      default:
        throw new Error(`${resource.kind} has no expansion`)
    }
  }

  /** The expansion's own rules: its kind's schema, no live definition of that kind and name in the scope, then its Handler's validate. */
  const check = (composition: Resource, expanded: Resource): Finding[] => {
    const label = `${expanded.kind}/${expanded.metadata.name}`
    const taken = deps.getResource(expanded.kind, composition.metadata.namespace, expanded.metadata.name)
    if (taken && taken.metadata.namespace === composition.metadata.namespace) return [{ severity: 'error', code: 'name_taken', message: `${label}: a ${expanded.kind} of that name exists; the expansion of ${composition.kind} ${composition.metadata.name} needs it` }]
    try {
      deps.kinds.validateResource(expanded)
    } catch (e) {
      return [{ severity: 'error', code: 'expansion', message: `${label}: ${(e as Error).message}` }]
    }
    const impl = expanded.kind === 'Workflow' ? workflow : undefined
    return (impl?.validate(expanded).findings ?? []).map((f) => ({ ...f, message: `${label}: ${f.message}` }))
  }

  return {
    validate(resource: Resource): ValidateResult {
      try {
        return { findings: expand(resource).flatMap((r) => check(resource, r)) }
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
