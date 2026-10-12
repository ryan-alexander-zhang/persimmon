import { describe, expect, it } from 'vitest'
import { expandApproval, expandPipeline, expandReviewLoop } from './expand.js'
import type { Approval, Pipeline, ReviewLoop } from './types.js'

const pipeline: Pipeline = {
  apiVersion: 'persimmon.ai/v1',
  kind: 'Pipeline',
  metadata: { name: 'prd-pipeline', namespace: 'demo' },
  spec: {
    inputs: { repository: { type: { kind: 'externalResource', provider: 'git', type: 'repository' } } },
    outputs: { prd: { type: { kind: 'artifact', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } } },
    outputBindings: { prd: { fromStep: { stepRef: 'write-prd', output: 'prd' } } },
    phases: [
      { id: 'research', uses: { kind: 'Task', name: 'research' }, inputs: { repository: { fromInput: 'repository' } }, timeout: '25m' },
      { id: 'write-prd', uses: { kind: 'Task', name: 'write-prd' }, inputs: { research: { fromStep: { stepRef: 'research', output: 'report' } } }, timeout: '35m' },
      { id: 'approve', uses: { kind: 'Gate', name: 'prd-approval-gate' }, inputs: { prd: { fromStep: { stepRef: 'write-prd', output: 'prd' } } }, timeout: '72h' },
    ],
    timeout: '80h',
  },
}

describe('expandPipeline', () => {
  it('phases become steps in order; transitions are implied; a gate phase routes on passed', () => {
    const wf = expandPipeline(pipeline, (ref) => ref.kind === 'Gate')
    expect(wf.kind).toBe('Workflow')
    expect(wf.metadata).toEqual({ name: 'prd-pipeline', namespace: 'demo' })
    expect(wf.spec.entry).toEqual(['research'])
    expect(wf.spec.steps).toEqual(pipeline.spec.phases)
    expect(wf.spec.inputs).toEqual(pipeline.spec.inputs)
    expect(wf.spec.outputBindings).toEqual(pipeline.spec.outputBindings)
    expect(wf.spec.timeout).toBe('80h')
    expect(wf.spec.transitions).toEqual([
      { id: 'after-research', from: [{ stepRef: 'research', outcomes: ['Succeeded'] }], to: [{ stepRef: 'write-prd' }] },
      { id: 'after-write-prd', from: [{ stepRef: 'write-prd', outcomes: ['Succeeded'] }], to: [{ stepRef: 'approve' }] },
      { id: 'after-approve', from: [{ stepRef: 'approve', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded', when: 'steps.approve.outputs.result.passed' }, { terminal: 'Failed', reason: 'approve_rejected' }], dispatch: 'first' },
    ])
    expect((wf.spec as Record<string, unknown>).phases).toBeUndefined()
  })

  it('a ReviewLoop phase routes on its own passed, so an exhausted loop never feeds the next phase', () => {
    const p: Pipeline = { ...pipeline, spec: { ...pipeline.spec, phases: [{ id: 'big-storm', uses: { kind: 'ReviewLoop', name: 'storm-x' }, timeout: '1h' }, { id: 'derive', uses: { kind: 'Workflow', name: 'derive-all' }, timeout: '1h' }] } }
    const wf = expandPipeline(p, () => false)
    expect(wf.spec.transitions[0]).toEqual({ id: 'after-big-storm', from: [{ stepRef: 'big-storm', outcomes: ['Succeeded'] }], to: [{ stepRef: 'derive', when: "steps['big-storm'].outputs.passed" }, { terminal: 'Failed', reason: 'big_storm_rejected' }], dispatch: 'first' })
    expect(wf.spec.transitions[1]).toEqual({ id: 'after-derive', from: [{ stepRef: 'derive', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] })
  })

  it('a gate phase in the middle routes to the next phase on passed', () => {
    const p: Pipeline = { ...pipeline, spec: { ...pipeline.spec, phases: [pipeline.spec.phases[2]!, pipeline.spec.phases[0]!] } }
    const wf = expandPipeline(p, (ref) => ref.kind === 'Gate')
    expect(wf.spec.transitions[0]).toEqual({ id: 'after-approve', from: [{ stepRef: 'approve', outcomes: ['Succeeded'] }], to: [{ stepRef: 'research', when: 'steps.approve.outputs.result.passed' }, { terminal: 'Failed', reason: 'approve_rejected' }], dispatch: 'first' })
    expect(wf.spec.transitions[1]).toEqual({ id: 'after-research', from: [{ stepRef: 'research', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] })
  })
})

describe('expandApproval', () => {
  const prd = { type: { kind: 'artifact' as const, artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } }
  const approval: Approval = {
    apiVersion: 'persimmon.ai/v1',
    kind: 'Approval',
    metadata: { name: 'prd-approval', namespace: 'demo' },
    spec: {
      inputs: { prd },
      approvers: [
        { name: 'human', uses: { kind: 'Task', name: 'approve-prd' } },
        { name: 'security', uses: { kind: 'Task', name: 'security-review' }, inputs: { document: 'prd' }, resultOutput: 'verdict' },
      ],
      policy: { strategy: 'quorum', count: 1 },
      timeout: '72h',
    },
  }

  it('one Gate of the same name, one task Validator per approver, ports mapped', () => {
    const [gate, ...validators] = expandApproval(approval)
    expect(gate.kind).toBe('Gate')
    expect(gate.metadata).toEqual({ name: 'prd-approval', namespace: 'demo' })
    expect(gate.spec).toEqual({
      inputs: { prd },
      outputs: { result: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/GateResult' } } } },
      validators: [
        { name: 'human', ref: { kind: 'Validator', name: 'prd-approval-human' }, inputs: { prd: { fromInput: 'prd' } } },
        { name: 'security', ref: { kind: 'Validator', name: 'prd-approval-security' }, inputs: { document: { fromInput: 'prd' } } },
      ],
      policy: { strategy: 'quorum', count: 1 },
      timeout: '72h',
    })
    expect(validators.map((v) => [v.kind, v.metadata.name])).toEqual([['Validator', 'prd-approval-human'], ['Validator', 'prd-approval-security']])
    expect(validators[0]!.spec).toEqual({ inputs: { prd }, evaluator: { type: 'task', taskRef: { kind: 'Task', name: 'approve-prd' }, resultOutput: 'result' }, timeout: '72h' })
    expect(validators[1]!.spec).toEqual({ inputs: { document: prd }, evaluator: { type: 'task', taskRef: { kind: 'Task', name: 'security-review' }, resultOutput: 'verdict' }, timeout: '72h' })
  })
})

describe('expandReviewLoop', () => {
  const prd = { type: { kind: 'artifact' as const, artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } }
  const report = { type: { kind: 'artifact' as const, artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport' } } }
  const gateResult = { kind: 'value' as const, schema: { $ref: 'persimmon.ai/v1#/GateResult' } }
  const loop: ReviewLoop = {
    apiVersion: 'persimmon.ai/v1',
    kind: 'ReviewLoop',
    metadata: { name: 'prd-with-review', namespace: 'demo' },
    spec: {
      inputs: { research: report },
      produce: { uses: { kind: 'Task', name: 'write-prd' }, inputs: { research: { fromInput: 'research' } }, timeout: '35m' },
      review: { uses: { kind: 'Gate', name: 'prd-approval-gate' }, inputs: { prd: { fromStep: { stepRef: 'produce', output: 'prd' } } }, timeout: '72h' },
      subject: 'prd',
      previous: 'last',
      feedback: 'verdict',
      maxRounds: 3,
      timeout: '24h',
    },
  }
  const notes = { type: { kind: 'value' as const, schema: { type: 'array' } } }
  const ports = () => ({ inputs: { research: report, last: { ...prd, required: false }, verdict: { type: gateResult, required: false } }, outputs: { prd, notes } })

  it('an outer Workflow with one repeat step over the round body; every produce output surfaces; previous and feedback carried as state', () => {
    const [outer, body] = expandReviewLoop(loop, ports)
    expect([outer.metadata.name, body.metadata.name]).toEqual(['prd-with-review', 'prd-with-review-round'])
    expect(body.spec).toEqual({
      inputs: { research: report, previous: { ...prd, required: false }, feedback: { type: gateResult, required: false } },
      outputs: { prd, notes, verdict: { type: gateResult }, passed: { type: { kind: 'value', schema: { type: 'boolean' } } } },
      outputBindings: { prd: { fromStep: { stepRef: 'produce', output: 'prd' } }, notes: { fromStep: { stepRef: 'produce', output: 'notes' } }, verdict: { fromStep: { stepRef: 'review', output: 'result' } }, passed: { expression: 'steps.review.outputs.result.passed' } },
      entry: ['produce'],
      steps: [
        { id: 'produce', uses: { kind: 'Task', name: 'write-prd' }, inputs: { research: { fromInput: 'research' }, last: { fromInput: 'previous', onMissing: 'omit' }, verdict: { fromInput: 'feedback', onMissing: 'omit' } }, timeout: '35m' },
        { id: 'review', uses: { kind: 'Gate', name: 'prd-approval-gate' }, inputs: { prd: { fromStep: { stepRef: 'produce', output: 'prd' } } }, timeout: '72h' },
      ],
      transitions: [
        { id: 'after-produce', from: [{ stepRef: 'produce', outcomes: ['Succeeded'] }], to: [{ stepRef: 'review' }] },
        { id: 'after-review', from: [{ stepRef: 'review', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] },
      ],
      timeout: '24h',
    })
    const maxRounds = { type: { kind: 'value', schema: { type: 'integer', minimum: 1 } }, required: false, default: { kind: 'value', value: 3 } } // a run may ask for fewer rounds
    expect(outer.spec).toEqual({
      inputs: { research: report, maxRounds },
      outputs: { prd, notes, passed: { type: { kind: 'value', schema: { type: 'boolean' } } }, rounds: { type: { kind: 'value', schema: { type: 'integer' } } } },
      outputBindings: { prd: { fromStep: { stepRef: 'rounds', output: 'prd' } }, notes: { fromStep: { stepRef: 'rounds', output: 'notes' } }, passed: { fromStep: { stepRef: 'rounds', output: 'passed' } }, rounds: { expression: 'steps.rounds.iterations' } },
      entry: ['rounds'],
      steps: [{
        id: 'rounds',
        uses: { kind: 'Workflow', name: 'prd-with-review-round' },
        inputs: { research: { fromInput: 'research' }, previous: { fromState: 'previous', onMissing: 'omit' }, feedback: { fromState: 'feedback', onMissing: 'omit' } },
        timeout: '24h',
        repeat: { state: { previous: { ...prd, required: false }, feedback: { type: gateResult, required: false } }, initial: {}, next: { previous: { fromIterationOutput: 'prd' }, feedback: { fromIterationOutput: 'verdict' } }, until: 'iteration.outputs.passed || iteration.index >= (inputs.maxRounds < 3 ? inputs.maxRounds : 3)', maxIterations: 3 },
      }],
      transitions: [{ id: 'after-rounds', from: [{ stepRef: 'rounds', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }],
      timeout: '24h',
    })
  })

  it('without previous and feedback the loop carries no state; maxRounds defaults to 3', () => {
    const { previous: _p, feedback: _f, maxRounds: _m, ...rest } = loop.spec
    const [outer, body] = expandReviewLoop({ ...loop, spec: rest }, ports)
    expect(body.spec.inputs).toEqual({ research: report })
    expect(outer.spec.steps[0]!.repeat).toEqual({ state: {}, initial: {}, next: {}, until: 'iteration.outputs.passed || iteration.index >= (inputs.maxRounds < 3 ? inputs.maxRounds : 3)', maxIterations: 3 })
    expect(outer.spec.steps[0]!.inputs).toEqual({ research: { fromInput: 'research' } })
  })

  it('names the missing produce or subject', () => {
    expect(() => expandReviewLoop(loop, () => undefined)).toThrow(/produce: Task write-prd not found/)
    expect(() => expandReviewLoop({ ...loop, spec: { ...loop.spec, subject: 'nope' } }, ports)).toThrow(/subject nope is not an output/)
  })

  it("a produce output named like one of the loop's own is shadowed, never surfaced", () => {
    const clashing = () => ({ inputs: {}, outputs: { prd, rounds: { type: { kind: 'value' as const, schema: { type: 'string' } } } } })
    const [outer, body] = expandReviewLoop(loop, clashing)
    expect(outer.spec.outputs!.rounds).toEqual({ type: { kind: 'value', schema: { type: 'integer' } } }) // the loop's round count, not the produce port
    expect(outer.spec.outputBindings!.rounds).toEqual({ expression: 'steps.rounds.iterations' })
    expect(body.spec.outputs).toEqual({ prd, verdict: { type: gateResult }, passed: { type: { kind: 'value', schema: { type: 'boolean' } } } })
  })
})
