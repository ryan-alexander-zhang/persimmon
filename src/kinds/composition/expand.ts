// Expansions of the composition kinds (21-composition.md): pure functions of the spec.
import type { Resource } from '../../resource/types.js'
import type { Target, Transition, Workflow } from '../workflow/types.js'
import type { Gate, Validator } from '../gate/types.js'
import type { Approval, Pipeline, ReviewLoop } from './types.js'
import type { InputSpec, OutputSpec, PortType } from '../ports/types.js'
import type { Step } from '../workflow/types.js'

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

/** The ports of a step's `uses`, live or from the closure; undefined when it cannot be found. */
export type Ports = (ref: { kind: string; name: string }) => { inputs: Record<string, InputSpec>; outputs: Record<string, OutputSpec> } | undefined

const gateResult: PortType = { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/GateResult' } }

/**
 * ReviewLoop → Workflow of the same name (one `rounds` repeat step) plus the body Workflow `<name>-round` (produce → review).
 * The subject's type is read from `produce`'s definition: the loop names the port, the definition owns the type.
 */
export function expandReviewLoop(r: ReviewLoop, ports: Ports): [Workflow, Workflow] {
  const { inputs = {}, produce, review, subject, previous, feedback, maxRounds = 3, timeout } = r.spec
  const produced = ports(produce.uses)
  if (!produced) throw new Error(`produce: ${produce.uses.kind} ${produce.uses.name} not found`)
  const subjectType = produced.outputs[subject]?.type
  if (!subjectType) throw new Error(`subject ${subject} is not an output of ${produce.uses.kind} ${produce.uses.name}`)
  const carried: Record<string, InputSpec> = { ...(previous ? { previous: { type: subjectType, required: false } } : {}), ...(feedback ? { feedback: { type: gateResult, required: false } } : {}) }
  const produceStep: Step = {
    id: 'produce',
    uses: produce.uses,
    inputs: { ...produce.inputs, ...(previous ? { [previous]: { fromInput: 'previous', onMissing: 'omit' } } : {}), ...(feedback ? { [feedback]: { fromInput: 'feedback', onMissing: 'omit' } } : {}) },
    timeout: produce.timeout,
  }
  const reviewStep: Step = { id: 'review', uses: review.uses, ...(review.inputs ? { inputs: review.inputs } : {}), timeout: review.timeout }
  const body: Workflow = {
    apiVersion: r.apiVersion,
    kind: 'Workflow',
    metadata: meta(r as unknown as Resource, '-round'),
    spec: {
      inputs: { ...inputs, ...carried },
      outputs: { [subject]: { type: subjectType }, verdict: { type: gateResult }, passed: { type: { kind: 'value', schema: { type: 'boolean' } } } },
      outputBindings: { [subject]: { fromStep: { stepRef: 'produce', output: subject } }, verdict: { fromStep: { stepRef: 'review', output: 'result' } }, passed: { expression: 'steps.review.outputs.result.passed' } },
      entry: ['produce'],
      steps: [produceStep, reviewStep],
      transitions: [
        { id: 'after-produce', from: [{ stepRef: 'produce', outcomes: ['Succeeded'] }], to: [{ stepRef: 'review' }] },
        { id: 'after-review', from: [{ stepRef: 'review', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] },
      ],
      timeout,
    },
  }
  const outer: Workflow = {
    apiVersion: r.apiVersion,
    kind: 'Workflow',
    metadata: meta(r as unknown as Resource),
    spec: {
      // a run may ask for fewer rounds than the ceiling, never more
      inputs: { ...inputs, maxRounds: { type: { kind: 'value', schema: { type: 'integer', minimum: 1 } }, required: false, default: { kind: 'value', value: maxRounds } } },
      outputs: { [subject]: { type: subjectType }, passed: { type: { kind: 'value', schema: { type: 'boolean' } } }, rounds: { type: { kind: 'value', schema: { type: 'integer' } } } },
      outputBindings: { [subject]: { fromStep: { stepRef: 'rounds', output: subject } }, passed: { fromStep: { stepRef: 'rounds', output: 'passed' } }, rounds: { expression: 'steps.rounds.iterations' } },
      entry: ['rounds'],
      steps: [
        {
          id: 'rounds',
          uses: { kind: 'Workflow', name: body.metadata.name },
          inputs: { ...Object.fromEntries(Object.keys(inputs).map((p) => [p, { fromInput: p }])), ...Object.fromEntries(Object.keys(carried).map((p) => [p, { fromState: p, onMissing: 'omit' as const }])) },
          timeout,
          repeat: {
            state: carried,
            initial: {},
            next: { ...(previous ? { previous: { fromIterationOutput: subject } } : {}), ...(feedback ? { feedback: { fromIterationOutput: 'verdict' } } : {}) },
            until: `iteration.outputs.passed || iteration.index >= (inputs.maxRounds < ${maxRounds} ? inputs.maxRounds : ${maxRounds})`,
            maxIterations: maxRounds,
          },
        },
      ],
      transitions: [{ id: 'after-rounds', from: [{ stepRef: 'rounds', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }],
      timeout,
    },
  }
  return [outer, body]
}

/** Name and Namespace only: an expansion carries nothing else of the composition's metadata. */
function meta(r: Resource, suffix = ''): Resource['metadata'] {
  return { name: `${r.metadata.name}${suffix}`, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) }
}
