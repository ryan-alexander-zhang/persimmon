import { describe, expect, it } from 'vitest'
import { expandPipeline } from './expand.js'
import type { Pipeline } from './types.js'

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

  it('a gate phase in the middle routes to the next phase on passed', () => {
    const p: Pipeline = { ...pipeline, spec: { ...pipeline.spec, phases: [pipeline.spec.phases[2]!, pipeline.spec.phases[0]!] } }
    const wf = expandPipeline(p, (ref) => ref.kind === 'Gate')
    expect(wf.spec.transitions[0]).toEqual({ id: 'after-approve', from: [{ stepRef: 'approve', outcomes: ['Succeeded'] }], to: [{ stepRef: 'research', when: 'steps.approve.outputs.result.passed' }, { terminal: 'Failed', reason: 'approve_rejected' }], dispatch: 'first' })
    expect(wf.spec.transitions[1]).toEqual({ id: 'after-research', from: [{ stepRef: 'research', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] })
  })
})
