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
// a step passed over by a dispatch, `b`, beside the step it leads to, `c`, which the same dispatch could start
const passBy = {
  apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'pass-by', namespace: 'demo' },
  spec: {
    inputs: { flag: { type: { kind: 'value', schema: { type: 'boolean' } } } },
    outputs: {}, outputBindings: {}, entry: ['a'],
    steps: ['a', 'b', 'c'].map((id) => ({ id, uses: { kind: 'Task', name: 'handle-item' }, timeout: '1h', inputs: { item: { literal: id } } })),
    transitions: [
      { id: 'from-a', from: [{ stepRef: 'a', outcomes: ['Succeeded'] }], to: [{ stepRef: 'b', when: 'inputs.flag' }, { stepRef: 'c' }], dispatch: 'first' },
      { id: 'from-b', from: [{ stepRef: 'b', outcomes: ['Succeeded'] }], to: [{ stepRef: 'c' }] },
      { id: 'done', from: [{ stepRef: 'c', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] },
    ],
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
    passBy,
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

  it('a fromArtifact step input binds the latest revision the engine knows', () => {
    const wf = closure.resources.find((r) => r.kind === 'Workflow' && r.metadata.name === 'prd-create')!
    const steps = (wf.spec as { steps: { id: string; inputs: Record<string, unknown> }[] }).steps
    const byId = { ...wf, spec: { ...wf.spec, steps: steps.map((st) => (st.id === 'write-prd' ? { ...st, inputs: { ...st.inputs, research: { fromArtifact: { kind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport' }, id: '"research-" + inputs.repository.id' } } } } : st)) } }
    const altered: Closure = { ...closure, resources: closure.resources.map((r) => (r === wf ? byId : r)) }
    const kinds = new KindRegistry()
    for (const kd of closure.resources.filter((r) => r.kind === 'KindDefinition')) kinds.register(kd)
    const seen: string[] = []
    const h = workflowHandler({ kinds, adapters: new AdapterRegistry({ resolve: () => undefined }), now: () => new Date(clock), closure: () => altered, callback: () => undefined, getResource: () => undefined, getByUid: () => undefined, random: () => 0, latestRevision: (kind, ns, id) => (seen.push(`${kind.kind}/${ns}/${id}`), id === 'research-checkout-v2' ? { ...reportRef, revision: 5 } : undefined) })
    let r = run('prd-create', { repository: { kind: 'externalResource', ref: { ...repo, id: 'checkout-v2' } } }, 'by-id')
    r = apply(r, h.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const res = h.reconcile(childFinished(r, 'research', 'Succeeded', { phase: 'Succeeded', outputs: { report: { kind: 'artifact', ref: reportRef } } })) as ReconcileResult
    expect(created(res)[0]!.spec).toMatchObject({ inputs: { research: { kind: 'artifact', ref: { ...reportRef, revision: 5 } } } }) // r5, not the step's r1
    expect(seen).toEqual(['ResearchReport/demo/research-checkout-v2'])
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

  it('a memo step reuses an earlier run with the same snapshot and inputs, per iteration, and starts a child otherwise', () => {
    const wf = structuredClone(listLoop)
    Object.assign(wf.spec.steps[0]!, { memo: { when: 'outputs.echo != "retry"' } })
    const altered: Closure = { ...closure, resources: closure.resources.map((r) => (r === listLoop ? wf : r)) }
    const kinds = new KindRegistry()
    for (const kd of closure.resources.filter((r) => r.kind === 'KindDefinition')) kinds.register(kd)
    const earlier = (name: string, item: string, echo: string, hour: number, digest = 'sha256:x') => ({ apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', metadata: { name, namespace: 'demo', uid: `uid-${name}`, creationTimestamp: `2026-09-20T0${hour}:00:00Z`, snapshot: { uri: `snapshot://${digest}`, digest } }, spec: { taskRef: { kind: 'Task', name: 'handle-item' }, address: {}, deadline: 'x', inputs: { item: { kind: 'value', value: item } } }, status: { phase: 'Succeeded', outputs: { echo: { kind: 'value', value: echo } } } }) as unknown as Resource
    const runs: Resource[] = [
      earlier('old-a', 'a', 'A0', 1), earlier('new-a', 'a', 'A1', 2), // two for a: the newest wins
      earlier('b-other-snapshot', 'b', 'B', 3, 'sha256:y'), // another snapshot: not the same work
      earlier('c-rejected', 'c', 'retry', 4), // when fails: run again
    ]
    const h = workflowHandler({ kinds, adapters: new AdapterRegistry({ resolve: () => undefined }), now: () => new Date(clock), closure: () => altered, callback: () => undefined, getResource: () => undefined, getByUid: () => undefined, random: () => 0, listResources: (kind) => (kind === 'TaskRun' ? runs : []) })
    let r = run('per-item', { items: { kind: 'value', value: ['a', 'b', 'c'] } }, 'memo')
    let res = h.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    // a: reused, no child; b: a child starts at once, iteration 2
    expect(created(res).map((c) => [c.metadata.name, (c.spec as { inputs: { item: { value: unknown } } }).inputs.item.value])).toEqual([['memo-each-2', 'b']])
    expect(clean(res.statusPatch).steps.each).toMatchObject({ phase: 'Pending', iteration: 2, runRef: { name: 'memo-each-2' } })
    r = apply(r, res)
    res = h.reconcile(childFinished(r, 'each', 'Succeeded', { phase: 'Succeeded', outputs: { echo: { kind: 'value', value: 'B' } } })) as ReconcileResult
    expect(created(res).map((c) => c.metadata.name)).toEqual(['memo-each-3']) // c's earlier run fails `when`
    r = apply(r, res)
    res = h.reconcile(childFinished(r, 'each', 'Succeeded', { phase: 'Succeeded', outputs: { echo: { kind: 'value', value: 'C' } } })) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { last: { kind: 'value', value: 'C' } } })
    // every iteration reused: the step and the run finish in the Created reconcile, the outputs the reused run's
    const all = run('per-item', { items: { kind: 'value', value: ['a'] } }, 'memo2')
    const done = h.reconcile(input(all, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(created(done)).toEqual([])
    expect(clean(done.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { last: { kind: 'value', value: 'A1' } }, steps: { each: { phase: 'Succeeded', reusedFrom: { kind: 'TaskRun', name: 'new-a' }, outputs: { echo: { kind: 'value', value: 'A1' } } } } })
    // ignore: an input left out of the comparison
    Object.assign(wf.spec.steps[0]!, { memo: { ignore: ['item'] } })
    const any = h.reconcile(input(run('per-item', { items: { kind: 'value', value: ['z'] } }, 'memo3'), { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(created(any)).toEqual([])
    expect(clean(any.statusPatch).steps.each.reusedFrom.name).toBe('c-rejected') // the newest of every run of the Task, whatever its item
  })

  it('a parallel repeat runs its iterations side by side, records every result, and one failure stops the rest', () => {
    const wf = structuredClone(listLoop)
    Object.assign(wf.spec.steps[0]!.repeat, { parallel: 2 })
    Object.assign(wf.spec, { outputs: { ...wf.spec.outputs, all: { type: { kind: 'value', schema: { type: 'string' } } } }, outputBindings: { ...wf.spec.outputBindings, all: { expression: 'steps.each.results.map(r, r.echo).join("")' } } })
    const altered: Closure = { ...closure, resources: closure.resources.map((r) => (r === listLoop ? wf : r)) }
    const kinds = new KindRegistry()
    for (const kd of closure.resources.filter((r) => r.kind === 'KindDefinition')) kinds.register(kd)
    const h = workflowHandler({ kinds, adapters: new AdapterRegistry({ resolve: () => undefined }), now: () => new Date(clock), closure: () => altered, callback: () => undefined, getResource: () => undefined, getByUid: () => undefined, random: () => 0 })
    const finish = (r: WorkflowRun, name: string, value: string, status: Record<string, unknown>) => {
      const ref = { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'demo', name }
      return input(r, { type: 'ChildFinished', dedupeKey: `child/${name}`, payload: { ref: { ...ref, uid: 'c' }, value } }, [{ ref, terminal: true, status }])
    }
    const echo = (v: string) => ({ phase: 'Succeeded', outputs: { echo: { kind: 'value', value: v } } })
    let r = run('per-item', { items: { kind: 'value', value: ['a', 'b', 'c'] } }, 'par')
    let res = h.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(created(res).map((c) => [c.metadata.name, (c.spec as { inputs: { item: { value: unknown } } }).inputs.item.value])).toEqual([['par-each-1', 'a'], ['par-each-2', 'b']]) // two at once
    expect(clean(res.statusPatch).steps.each).toMatchObject({ phase: 'Running', iteration: 2, active: [{ iteration: 1 }, { iteration: 2 }] })
    r = apply(r, res)
    res = h.reconcile(finish(r, 'par-each-1', 'Succeeded', echo('A'))) as ReconcileResult
    expect(created(res).map((c) => c.metadata.name)).toEqual(['par-each-3']) // the slot freed starts the third
    expect(clean(res.statusPatch).steps.each).toMatchObject({ results: [{ echo: { kind: 'value', value: 'A' } }], active: [{ iteration: 2 }, { iteration: 3 }] })
    r = apply(r, res)
    res = h.reconcile(finish(r, 'par-each-3', 'Succeeded', echo('C'))) as ReconcileResult // out of order
    expect(created(res)).toEqual([])
    expect(clean(res.statusPatch).phase).toBe('Running')
    r = apply(r, res)
    res = h.reconcile(finish(r, 'par-each-2', 'Succeeded', echo('B'))) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { last: { kind: 'value', value: 'C' }, all: { kind: 'value', value: 'ABC' } }, steps: { each: { phase: 'Succeeded', active: [] } } })
    // one iteration fails: its independent siblings go on, the third still starts, and the step fails with the first error once all have ended
    let f = run('per-item', { items: { kind: 'value', value: ['a', 'b', 'c'] } }, 'parf')
    f = apply(f, h.reconcile(input(f, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    let failed = h.reconcile(finish(f, 'parf-each-2', 'Failed', { phase: 'Failed', error: { code: 'boom', message: 'x', retryable: false } })) as ReconcileResult
    expect(clean(failed.statusPatch)).toMatchObject({ phase: 'Running', steps: { each: { phase: 'Running', error: { code: 'boom' }, active: [{ iteration: 1 }, { iteration: 3 }] } } })
    expect(failed.actions.filter((a) => a.type === 'cancelResource')).toEqual([])
    expect(created(failed).map((c) => c.metadata.name)).toEqual(['parf-each-3'])
    f = apply(f, failed)
    f = apply(f, h.reconcile(finish(f, 'parf-each-1', 'Succeeded', echo('A'))) as ReconcileResult)
    failed = h.reconcile(finish(f, 'parf-each-3', 'Succeeded', echo('C'))) as ReconcileResult
    expect(clean(failed.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'boom' }, steps: { each: { phase: 'Failed', active: [], results: [{ echo: { kind: 'value', value: 'A' } }, null, { echo: { kind: 'value', value: 'C' } }] } } })
  })

  it('a repeat whose initial or next binding fails fails the step invalid_input, not the reconcile', () => {
    const gone = { fromArtifact: { kind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' }, id: '"nope"' } } // no store at the site: absent, no onMissing
    const variant = (repeat: Record<string, unknown>) => {
      const wf = structuredClone(listLoop)
      Object.assign(wf.spec.steps[0]!.repeat, repeat)
      const altered: Closure = { ...closure, resources: closure.resources.map((r) => (r === listLoop ? wf : r)) }
      const kinds = new KindRegistry()
      for (const kd of closure.resources.filter((r) => r.kind === 'KindDefinition')) kinds.register(kd)
      return workflowHandler({ kinds, adapters: new AdapterRegistry({ resolve: () => undefined }), now: () => new Date(clock), closure: () => altered, callback: () => undefined, getResource: () => undefined, getByUid: () => undefined, random: () => 0 })
    }
    const first = variant({ initial: { index: { literal: 1 }, items: gone } })
    const r = run('per-item', { items: { kind: 'value', value: ['a', 'b'] } }, 'bad-initial')
    const res = first.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(created(res)).toEqual([])
    expect(clean(res.statusPatch).steps.each).toMatchObject({ phase: 'Failed', error: { code: 'invalid_input', message: 'step each: items: source absent' } })
    const later = variant({ next: { index: { expression: 'state.index + 1' }, items: gone } })
    let r2 = run('per-item', { items: { kind: 'value', value: ['a', 'b'] } }, 'bad-next')
    r2 = apply(r2, later.reconcile(input(r2, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const res2 = later.reconcile(childFinished(r2, 'each', 'Succeeded', { phase: 'Succeeded', outputs: { echo: { kind: 'value', value: 'a' } } })) as ReconcileResult
    expect(created(res2)).toEqual([])
    expect(clean(res2.statusPatch).steps.each).toMatchObject({ phase: 'Failed', error: { code: 'invalid_input', message: 'step each: items: source absent' } })
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

  it('a step one dispatch passes over stays Pending while another Transition can still start it (11-workflow.md)', () => {
    const drive = (flag: boolean) => {
      let r = run('pass-by', { flag: { kind: 'value', value: flag } }, `pass-${flag}`)
      r = apply(r, handler.reconcile(input(r, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
      let res = handler.reconcile(childFinished(r, 'a', 'Succeeded', { phase: 'Succeeded', outputs: { echo: { kind: 'value', value: 'a' } } })) as ReconcileResult
      const first = created(res).map((c) => c.metadata.name)
      r = apply(r, res)
      const phases = Object.fromEntries(Object.entries(r.status!.steps).map(([k, v]) => [k, v.runRef ? `${v.phase} started` : v.phase]))
      for (const step of first.map((n) => n.replace(`pass-${flag}-`, ''))) {
        res = handler.reconcile(childFinished(r, step, 'Succeeded', { phase: 'Succeeded', outputs: { echo: { kind: 'value', value: step } } })) as ReconcileResult
        r = apply(r, res)
        for (const next of created(res).map((c) => c.metadata.name.replace(`pass-${flag}-`, ''))) {
          res = handler.reconcile(childFinished(r, next, 'Succeeded', { phase: 'Succeeded', outputs: { echo: { kind: 'value', value: next } } })) as ReconcileResult
          r = apply(r, res)
        }
      }
      return { first, phases, end: r.status!.phase, steps: Object.fromEntries(Object.entries(r.status!.steps).map(([k, v]) => [k, v.phase])) }
    }
    expect(drive(true)).toEqual({ first: ['pass-true-b'], phases: { a: 'Succeeded started', b: 'Pending started', c: 'Pending' }, end: 'Succeeded', steps: { a: 'Succeeded', b: 'Succeeded', c: 'Succeeded' } }) // c waits for b
    expect(drive(false)).toEqual({ first: ['pass-false-c'], phases: { a: 'Succeeded started', b: 'Skipped', c: 'Pending started' }, end: 'Succeeded', steps: { a: 'Succeeded', b: 'Skipped', c: 'Succeeded' } })
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
