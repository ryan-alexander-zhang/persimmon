// Expansions of the composition kinds (21-composition.md): pure functions of the spec.
import type { Resource } from '../../resource/types.js'
import type { Target, Transition, Workflow } from '../workflow/types.js'
import type { Pipeline } from './types.js'

/** Whether a step's `uses` runs as a GateRun (Gate, Approval): its phase routes on `passed`. */
export type IsGate = (ref: { kind: string; name: string }) => boolean

/** Pipeline → Workflow of the same name: phases as steps, transitions implied by order, gate phases reject with `<id>_rejected`. */
export function expandPipeline(p: Pipeline, isGate: IsGate): Workflow {
  const { phases, ...rest } = p.spec
  const transitions: Transition[] = phases.map((phase, i) => {
    const next: Target = i + 1 < phases.length ? { stepRef: phases[i + 1]!.id } : { terminal: 'Succeeded' }
    const t: Transition = { id: `after-${phase.id}`, from: [{ stepRef: phase.id, outcomes: ['Succeeded'] }], to: [next] }
    if (isGate(phase.uses)) {
      t.to = [{ ...next, when: `steps.${phase.id}.outputs.result.passed` }, { terminal: 'Failed', reason: `${phase.id}_rejected` }]
      t.dispatch = 'first'
    }
    return t
  })
  return { apiVersion: p.apiVersion, kind: 'Workflow', metadata: meta(p as unknown as Resource), spec: { ...rest, entry: [phases[0]!.id], steps: phases, transitions } }
}

/** Name and Namespace only: an expansion carries nothing else of the composition's metadata. */
function meta(r: Resource, suffix = ''): Resource['metadata'] {
  return { name: `${r.metadata.name}${suffix}`, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) }
}
