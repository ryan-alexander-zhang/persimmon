// Expansions of the composition kinds (21-composition.md): pure functions of the spec.
import type { Resource } from '../../resource/types.js'
import type { Target, Transition, Workflow } from '../workflow/types.js'
import type { Gate, Validator } from '../gate/types.js'
import type { Approval, Pipeline } from './types.js'

/** Whether a step's `uses` runs as a GateRun (Gate, Approval): its phase routes on `passed`. */
export type IsGate = (ref: { kind: string; name: string }) => boolean

/** Pipeline → Workflow of the same name: phases as steps, transitions implied by order, gate phases reject with `<id>_rejected`. */
export function expandPipeline(p: Pipeline, isGate: IsGate): Workflow {
  const { phases, inputs, outputs, outputBindings, timeout } = p.spec
  const transitions: Transition[] = phases.map((phase, i) => {
    const next: Target = i + 1 < phases.length ? { stepRef: phases[i + 1]!.id } : { terminal: 'Succeeded' }
    const t: Transition = { id: `after-${phase.id}`, from: [{ stepRef: phase.id, outcomes: ['Succeeded'] }], to: [next] }
    if (isGate(phase.uses)) {
      t.to = [{ ...next, when: `steps.${phase.id}.outputs.result.passed` }, { terminal: 'Failed', reason: `${phase.id}_rejected` }]
      t.dispatch = 'first'
    }
    return t
  })
  return { apiVersion: p.apiVersion, kind: 'Workflow', metadata: meta(p as unknown as Resource), spec: { ...(inputs ? { inputs } : {}), ...(outputs ? { outputs } : {}), ...(outputBindings ? { outputBindings } : {}), entry: [phases[0]!.id], steps: phases, transitions, timeout } }
}

/** Approval → Gate of the same name plus one Validator `<name>-<approver>` per approver, each a `task` evaluator over the approver's Task. */
export function expandApproval(a: Approval): [Gate, ...Validator[]] {
  const { approvers, inputs, policy, timeout } = a.spec
  const validators = approvers.map((ap): Validator => {
    const mapping = ap.inputs ?? Object.fromEntries(Object.keys(inputs).map((p) => [p, p]))
    const vInputs = Object.fromEntries(Object.entries(mapping).map(([taskPort, port]) => [taskPort, inputs[port]!]))
    return { apiVersion: a.apiVersion, kind: 'Validator', metadata: meta(a as unknown as Resource, `-${ap.name}`), spec: { inputs: vInputs, evaluator: { type: 'task', taskRef: ap.uses, resultOutput: ap.resultOutput ?? 'result' }, timeout } }
  })
  const gate: Gate = {
    apiVersion: a.apiVersion,
    kind: 'Gate',
    metadata: meta(a as unknown as Resource),
    spec: {
      inputs,
      outputs: { result: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/GateResult' } } } },
      validators: approvers.map((ap, i) => ({
        name: ap.name,
        ref: { kind: 'Validator', name: validators[i]!.metadata.name },
        inputs: Object.fromEntries(Object.entries(ap.inputs ?? Object.fromEntries(Object.keys(inputs).map((p) => [p, p]))).map(([taskPort, port]) => [taskPort, { fromInput: port }])),
      })),
      ...(policy ? { policy } : {}),
      timeout,
    },
  }
  return [gate, ...validators]
}

/** Name and Namespace only: an expansion carries nothing else of the composition's metadata. */
function meta(r: Resource, suffix = ''): Resource['metadata'] {
  return { name: `${r.metadata.name}${suffix}`, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) }
}
