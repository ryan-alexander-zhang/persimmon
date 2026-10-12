import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdapterRegistry } from '../../adapter/registry.js'
import { KindRegistry } from '../../kind-definition/registry.js'
import type { Context, ReconcileInput, ReconcileResult } from '../../handler/types.js'
import type { Action, Event } from '../../reconcile/types.js'
import type { ObjectRef, Resource } from '../../resource/types.js'
import type { Closure } from '../../snapshot/walk.js'
import type { HandlerDeps } from '../deps.js'
import { workflowHandler } from './handler.js'
import type { WorkflowRun } from './types.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const base = example('snapshot-closure') as Closure
const gateKd = example('kind-definition-gate')
const prd = { kind: 'artifact', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } }
const report = { kind: 'artifact', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport' } }
const taskLike = (name: string, inputs: Record<string, unknown>, outputs: Record<string, unknown>) => ({
  apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name, namespace: 'demo' },
  spec: { inputs, outputs, executorRef: { kind: 'Executor', name: 'claude-agent' }, action: { instructions: 'x' }, timeout: '1h', sideEffects: 'none' },
})
const text = { kind: 'value', schema: { type: 'string' } }
// a repeat step that walks a list input: the body input and `next` read the repeat state, `until` counts iterations
const listLoop = {
  apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'per-item', namespace: 'demo' },
  spec: {
    inputs: { items: { type: { kind: 'value', schema: { type: 'array', items: { type: 'string' } } } } },
    outputs: { last: { type: text } },
    outputBindings: { last: { fromStep: { stepRef: 'each', output: 'echo' } } },
    entry: ['each'],
    steps: [{
      id: 'each', uses: { kind: 'Task', name: 'handle-item' }, timeout: '1h',
      inputs: { item: { expression: 'state.items[state.index - 1]' } },
      repeat: {
        state: { index: { type: { kind: 'value', schema: { type: 'integer' } } }, items: { type: { kind: 'value', schema: { type: 'array', items: { type: 'string' } } } } },
        initial: { index: { literal: 1 }, items: { fromInput: 'items' } },
        next: { index: { expression: 'state.index + 1' }, items: { fromState: 'items' } },
        until: 'iteration.index >= inputs.items.size()',
        maxIterations: 10,
      },
    }],
    transitions: [{ id: 'done', from: [{ stepRef: 'each', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }],
    timeout: '2h',
  },
}
const closure: Closure = {
  ...base,
  resources: [
    ...base.resources,
    gateKd,
    example('workflow-review-loop'),
    example('workflow-fan-in'),
    { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'prd-review-round', namespace: 'demo' }, spec: { inputs: { prd: { type: prd }, research: { type: report } }, outputs: { prd: { type: prd }, accepted: { type: { kind: 'value', schema: { type: 'boolean' } } } }, outputBindings: {}, entry: ['x'], steps: [], transitions: [], timeout: '1h' } },
    taskLike('handle-item', { item: { type: text } }, { echo: { type: text } }),
    listLoop,
    taskLike('security-review', { prd: { type: prd } }, { report: { type: report } }),
    taskLike('product-review', { prd: { type: prd } }, { report: { type: report } }),
    { apiVersion: 'persimmon.ai/v1', kind: 'Gate', metadata: { name: 'prd-approval-gate', namespace: 'demo' }, spec: { inputs: { prd: { type: prd }, security: { type: report, required: false }, product: { type: report, required: false } }, outputs: { result: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/GateResult' } } } }, validators: [], timeout: '1h' } },
  ],
}
const prdRef = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'checkout-v2', revision: 3 }
const reportRef = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport', namespace: 'demo', id: 'research-checkout-v2', revision: 1 }
const repo = example('resource-refs').externalResourceRef

describe('workflow Handler', () => {
  let clock: number
  let handler: ReturnType<typeof workflowHandler>
  beforeEach(() => {
    clock = Date.parse('2026-09-21T09:00:00Z')
    const kinds = new KindRegistry()
    for (const kd of closure.resources.filter((r) => r.kind === 'KindDefinition')) kinds.register(kd)
    const deps: HandlerDeps = { kinds, adapters: new AdapterRegistry({ resolve: () => undefined }), now: () => new Date(clock), closure: () => closure, callback: () => undefined, getResource: () => undefined, getByUid: () => undefined, random: () => 0 }
    handler = workflowHandler(deps)
  })

  const run = (workflow: string, inputs: Record<string, unknown>, name = 'r1'): WorkflowRun =>
    ({ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name, namespace: 'demo', uid: `uid-${name}`, creationTimestamp: '2026-09-21T09:00:00Z', snapshot: { uri: 'snapshot://x', digest: 'sha256:x' } }, spec: { workflowRef: { kind: 'Workflow', name: workflow }, inputs, timeout: '2h', origin: { kind: 'manual' } } }) as unknown as WorkflowRun
  const input = (r: WorkflowRun, event: Omit<Event, 'sequence'>, children: Context['children'] = []): ReconcileInput => ({ resource: r as unknown as Resource, event: { sequence: 1, ...event } as Event, context: { children, timers: [] }, engine: { endpoint: 'x', token: 't' } })
  const apply = (r: WorkflowRun, res: ReconcileResult): WorkflowRun => ({ ...r, status: JSON.parse(JSON.stringify({ ...(r.status ?? {}), ...(res.statusPatch ?? {}) })) })
  const created = (res: ReconcileResult) => res.actions.filter((a): a is Extract<Action, { type: 'createResource' }> => a.type === 'createResource').map((a) => a.resource)
  const childFinished = (r: WorkflowRun, step: string, value: string, status: Record<string, unknown>) => {
    const ref = (r.status!.steps[step]!.runRef as ObjectRef)
    return input(r, { type: 'ChildFinished', dedupeKey: `child/${ref.name}`, payload: { ref: { ...ref, uid: 'c' }, value } }, [{ ref, terminal: true, status }])
  }
  const clean = (x: unknown) => JSON.parse(JSON.stringify(x))

  it('drives the linear prd-create run like the design io example', () => {
    let r = run('prd-create', { repository: { kind: 'externalResource', ref: repo } }, 'prd-create-001')
    let res = handler.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Running', steps: { research: { phase: 'Pending', runRef: { kind: 'TaskRun', name: 'prd-create-001-research' } }, 'write-prd': { phase: 'Pending' } } })
    expect(clean(res.statusPatch).steps['write-prd'].runRef).toBeUndefined()
    const [research] = created(res)
    expect(research!.spec).toEqual({ taskRef: { kind: 'Task', name: 'research' }, address: { workflowRunRef: { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: 'prd-create-001' }, stepRef: 'research', iterationPath: '', logicalExecutionId: 'prd-create-001//research' }, deadline: '2026-09-21T09:25:00Z', inputs: { repository: { kind: 'externalResource', ref: repo } } })
    expect(res.actions.at(-1)).toEqual({ type: 'setTimer', key: 'deadline', at: '2026-09-21T11:00:00Z' })
    // no run timeout: the Workflow's own (prd-create: 2h) sets the deadline
    const noTimeout = run('prd-create', { repository: { kind: 'externalResource', ref: repo } }, 'r2')
    delete (noTimeout.spec as { timeout?: string }).timeout
    const res2 = handler.reconcile(input(noTimeout, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(res2.actions.at(-1)).toEqual({ type: 'setTimer', key: 'deadline', at: '2026-09-21T11:00:00Z' })
    r = apply(r, res)

    clock = Date.parse('2026-09-21T10:00:00Z')
    res = handler.reconcile(childFinished(r, 'research', 'Succeeded', { phase: 'Succeeded', outputs: { report: { kind: 'artifact', ref: reportRef } } })) as ReconcileResult
    const io = example('handler-reconcile-io').output
    expect(clean(res.statusPatch).steps).toEqual(io.statusPatch.steps)
    expect(created(res)[0]!.spec).toEqual({ ...io.actions[0].resource.spec, deadline: '2026-09-21T10:35:00Z' })
    r = apply(r, res)

    res = handler.reconcile(childFinished(r, 'write-prd', 'Succeeded', { phase: 'Succeeded', outputs: { prd: { kind: 'artifact', ref: prdRef } } })) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { prd: { kind: 'artifact', ref: prdRef } }, steps: { 'write-prd': { phase: 'Succeeded' } } })
    expect(res.actions).toEqual([{ type: 'clearTimer', key: 'deadline' }])
  })

  it('fails with unconsumed_failure, and a listed failure routes to a Failed terminal with its reason', () => {
    let r = run('prd-create', { repository: { kind: 'externalResource', ref: repo } })
    r = apply(r, handler.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const res = handler.reconcile(childFinished(r, 'research', 'Failed', { phase: 'Failed', error: { code: 'timeout', message: 't', retryable: true } })) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'timeout', message: 'step research: t' }, steps: { research: { phase: 'Failed', error: { code: 'timeout' } }, 'write-prd': { phase: 'Skipped' } } }) // the unrouted failure, not no_progress

    let loop = run('prd-with-review', { research: { kind: 'artifact', ref: reportRef } })
    loop = apply(loop, handler.reconcile(input(loop, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const failed = handler.reconcile(childFinished(loop, 'draft', 'Failed', { phase: 'Failed', error: { code: 'x', message: 'y', retryable: false } })) as ReconcileResult
    expect(clean(failed.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'draft_failed' }, reason: 'draft_failed', steps: { review: { phase: 'Skipped' } } })
  })

  it('a repeat body run addresses its steps by its own name: no doubled iteration', () => {
    const body = run('prd-create', { repository: { kind: 'externalResource', ref: repo } }, 'loop-review-1')
    body.spec = { ...body.spec, origin: { kind: 'parent' }, parent: { workflowRunRef: { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: 'loop' }, stepRef: 'review', iterationPath: 'review[1]' } } as WorkflowRun['spec']
    const [research] = created(handler.reconcile(input(body, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    expect(research!.metadata.name).toBe('loop-review-1-research')
    expect((research!.spec as { address: unknown }).address).toMatchObject({ stepRef: 'research', iterationPath: 'review[1]', logicalExecutionId: 'loop-review-1//research' })
  })

  it('repeats a body Workflow with state until accepted', () => {
    let r = run('prd-with-review', { research: { kind: 'artifact', ref: reportRef } }, 'loop')
    r = apply(r, handler.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    let res = handler.reconcile(childFinished(r, 'draft', 'Succeeded', { phase: 'Succeeded', outputs: { prd: { kind: 'artifact', ref: prdRef } } })) as ReconcileResult
    const [body] = created(res)
    expect(body!.kind).toBe('WorkflowRun')
    expect(body!.metadata.name).toBe('loop-review-1')
    expect(body!.spec).toMatchObject({ workflowRef: { kind: 'Workflow', name: 'prd-review-round' }, inputs: { prd: { kind: 'artifact', ref: prdRef }, research: { kind: 'artifact', ref: reportRef } }, origin: { kind: 'parent' }, parent: { stepRef: 'review', iterationPath: 'review[1]' } })
    expect(clean(res.statusPatch).steps.review).toMatchObject({ phase: 'Pending', iteration: 1, deadline: '2026-09-21T11:00:00Z' }) // min(run 2h, step 6h)
    expect((body!.spec as { timeout: string }).timeout).toBe('7200000ms')
    r = apply(r, res)

    clock += 3_600_000
    const prd4 = { ...prdRef, revision: 4 }
    res = handler.reconcile(childFinished(r, 'review', 'Succeeded', { phase: 'Succeeded', outputs: { prd: { kind: 'artifact', ref: prd4 }, accepted: { kind: 'value', value: false } } })) as ReconcileResult
    const [second] = created(res)
    expect(second!.metadata.name).toBe('loop-review-2')
    expect((second!.spec as { inputs: { prd: unknown } }).inputs.prd).toEqual({ kind: 'artifact', ref: prd4 })
    expect(clean(res.statusPatch).steps.review).toMatchObject({ iteration: 2, deadline: '2026-09-21T11:00:00Z' }) // the step timeout bounds the loop: the second round gets what is left
    expect((second!.spec as { timeout: string }).timeout).toBe('3600000ms')
    r = apply(r, res)

    const prd5 = { ...prdRef, revision: 5 }
    res = handler.reconcile(childFinished(r, 'review', 'Succeeded', { phase: 'Succeeded', outputs: { prd: { kind: 'artifact', ref: prd5 }, accepted: { kind: 'value', value: true } } })) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { prd: { kind: 'artifact', ref: prd5 }, accepted: { kind: 'value', value: true } } })
  })

  it('a repeat step walks a list: state in the body input and in next', () => {
    let r = run('per-item', { items: { kind: 'value', value: ['a', 'b', 'c'] } }, 'li')
    let res = handler.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    const seen: unknown[] = []
    for (const expected of ['a', 'b', 'c']) {
      const [child] = created(res)
      expect(child!.metadata.name).toBe(`li-each-${seen.length + 1}`)
      seen.push((child!.spec as { inputs: { item: { value: unknown } } }).inputs.item.value)
      expect(clean(res.statusPatch).steps.each).toMatchObject({ iteration: seen.length, state: { index: { kind: 'value', value: seen.length } } })
      r = apply(r, res)
      res = handler.reconcile(childFinished(r, 'each', 'Succeeded', { phase: 'Succeeded', outputs: { echo: { kind: 'value', value: expected } } })) as ReconcileResult
    }
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { last: { kind: 'value', value: 'c' } } })
  })

  it('quorum join with dispatch first and onMissing inputs', () => {
    let r = run('prd-approval', { prd: { kind: 'artifact', ref: prdRef } }, 'appr')
    let res = handler.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(created(res).map((c) => c.metadata.name)).toEqual(['appr-security-review', 'appr-product-review'])
    r = apply(r, res)
    res = handler.reconcile(childFinished(r, 'security-review', 'Succeeded', { phase: 'Succeeded', outputs: { report: { kind: 'artifact', ref: reportRef } } })) as ReconcileResult
    const [gate] = created(res)
    expect(gate!.kind).toBe('GateRun')
    expect((gate!.spec as { inputs: Record<string, unknown> }).inputs).toEqual({ prd: { kind: 'artifact', ref: prdRef }, security: { kind: 'artifact', ref: reportRef } })
    r = apply(r, res)
    res = handler.reconcile(childFinished(r, 'product-review', 'Failed', { phase: 'Failed', error: { code: 'x', message: 'y', retryable: false } })) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Running', steps: { 'product-review': { phase: 'Failed' }, approval: { phase: 'Pending', runRef: { kind: 'GateRun' } } } })
    r = apply(r, res)
    res = handler.reconcile(childFinished(r, 'approval', 'Succeeded', { phase: 'Succeeded', outputs: { result: { kind: 'value', value: { passed: true, results: {} } } } })) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { approved: { kind: 'value', value: true } } })
  })

  it('timeout cancels activated children; cancel is immediate', () => {
    let r = run('prd-create', { repository: { kind: 'externalResource', ref: repo } })
    r = apply(r, handler.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const t = handler.reconcile(input(r, { type: 'TimerFired', dedupeKey: 'x', payload: { key: 'deadline', at: 'x' } })) as ReconcileResult
    expect(clean(t.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'timeout' }, steps: { research: { phase: 'Cancelled' } } })
    expect(t.actions.map((a) => a.type)).toEqual(['cancelResource', 'clearTimer'])
    const c = handler.reconcile(input(r, { type: 'CancelRequested', dedupeKey: 'cancel' })) as ReconcileResult
    expect(clean(c.statusPatch)).toMatchObject({ phase: 'Cancelled', steps: { research: { phase: 'Cancelled' } } })
    expect(handler.reconcile(input(apply(r, c), { type: 'TimerFired', dedupeKey: 'y', payload: { key: 'deadline', at: 'x' } }))).toEqual({ actions: [] })
  })

  it('validate runs the static checker against the live store', () => {
    expect(handler.validate(example('workflow-prd-create')).findings.map((f) => f.message)).toEqual(['Task research does not resolve or has no stepContract', 'Task write-prd does not resolve or has no stepContract', 'write-prd has no output prd'])
  })
})
