import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdapterRegistry } from '../../adapter/registry.js'
import { validator as schemaOf } from '../../resource/ajv.js'
import { KindRegistry } from '../../kind-definition/registry.js'
import type { ReconcileInput, ReconcileResult } from '../../handler/types.js'
import type { Event } from '../../reconcile/types.js'
import type { Resource } from '../../resource/types.js'
import type { Closure } from '../../snapshot/walk.js'
import type { HandlerDeps } from '../deps.js'
import { taskHandler } from './handler.js'
import { backoffMs, shouldRetry } from './retry.js'
import type { RetryPolicy, TaskRun, TaskSpec } from './types.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const closure = example('snapshot-closure') as Closure
const fullPrd = example('kind-definition-productrequirement')
closure.resources = closure.resources.map((r) => (r.metadata.name === fullPrd.metadata.name ? fullPrd : r))

describe('retry policy', () => {
  const policy = example('task-write-prd').spec.retryPolicy as RetryPolicy
  it('follows retryOn, abortOn, retryable and the hard non-retryable codes', () => {
    expect(shouldRetry(policy, 1, { code: 'rate_limit', message: '', retryable: false }, 'none')).toBe(true)
    expect(shouldRetry(policy, 3, { code: 'rate_limit', message: '', retryable: true }, 'none')).toBe(false)
    expect(shouldRetry(policy, 1, { code: 'permission_denied', message: '', retryable: true }, 'none')).toBe(false)
    expect(shouldRetry({ ...policy, retryOn: ['schema_violation'] }, 1, { code: 'schema_violation', message: '', retryable: true }, 'none')).toBe(false)
    expect(shouldRetry(policy, 1, { code: 'other', message: '', retryable: true }, 'none')).toBe(true)
    expect(shouldRetry(policy, 1, { code: 'other', message: '', retryable: false }, 'none')).toBe(false)
    expect(shouldRetry(policy, 1, { code: 'unknown_result', message: '', retryable: true }, 'idempotent')).toBe(true) // re-execution is safe
    expect(shouldRetry(policy, 1, { code: 'unknown_result', message: '', retryable: true }, 'nonIdempotent')).toBe(false)
    expect(shouldRetry(undefined, 1, { code: 'rate_limit', message: '', retryable: true }, 'none')).toBe(false)
  })
  it('computes backoff', () => {
    expect(backoffMs({ ...policy, backoff: { strategy: 'exponential', initial: '30s', max: '5m' } }, 1, () => 0)).toBe(30_000)
    expect(backoffMs({ ...policy, backoff: { strategy: 'exponential', initial: '30s', max: '5m' } }, 5, () => 0)).toBe(300_000)
    expect(backoffMs({ ...policy, backoff: { strategy: 'linear', initial: '10s', max: '5m' } }, 3, () => 0)).toBe(30_000)
    expect(backoffMs({ ...policy, backoff: { strategy: 'fixed', initial: '10s', max: '5m', jitter: 'full' } }, 3, () => 0.5)).toBe(5_000)
  })
})

describe('task Handler', () => {
  let clock: number
  let deps: HandlerDeps
  let handler: ReturnType<typeof taskHandler>
  let published: Record<string, unknown>[]
  beforeEach(() => {
    clock = Date.parse('2026-09-21T09:00:01Z')
    published = []
    const kinds = new KindRegistry()
    const adapters = new AdapterRegistry({ resolve: () => undefined })
    adapters.register(example('adapter-claude-code'))
    adapters.register(example('adapter-review-ui'))
    deps = {
      kinds, adapters, now: () => new Date(clock), closure: () => closure, random: () => 0,
      callback: (_t, name, args) => {
        published.push(args)
        return { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: (args as { id: string }).id, revision: 7 }
      },
      getResource: () => undefined, getByUid: () => undefined,
    }
    handler = taskHandler(deps)
  })

  const base = (): TaskRun => {
    const r = example('resource-child') as Resource
    return { ...r, status: undefined } as unknown as TaskRun
  }
  const input = (run: TaskRun, event: Omit<Event, 'sequence'> & { sequence?: number }, staged: ReconcileInput['context']['staged'] = []): ReconcileInput => ({
    resource: run as unknown as Resource,
    event: { sequence: 1, ...event } as Event,
    context: { children: [], timers: [], staged },
    engine: { endpoint: 'unix://x', token: 'rt' },
  })
  const apply = (run: TaskRun, r: ReconcileResult): TaskRun => ({ ...run, status: { ...(run.status ?? {}), ...(r.statusPatch ?? {}) } as TaskRun['status'] })
  const clean = (s: unknown) => JSON.parse(JSON.stringify(s))

  it('replays the design RunLog: execute, rate limit, backoff, second attempt, success', () => {
    const log = example('reconcile-runlog')
    let run = base()
    // Created
    let r = handler.reconcile(input(run, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Running', attempts: [{ index: 1, state: 'running', idempotencyKey: 'prd-create-002//research/1' }] })
    expect(r.actions.map((a) => a.type)).toEqual(['callAdapter', 'setTimer', 'setTimer'])
    const call = r.actions[0] as { op: string; adapterId: string; idempotencyKey: string; deadline: string; payload: Record<string, unknown> }
    expect(call).toMatchObject({ op: 'execute', adapterId: 'claude-code/v1', idempotencyKey: 'prd-create-002//research/1', deadline: '2026-09-21T09:20:01Z' })
    expect(call.payload).toMatchObject({ task: { instructions: 'Research the checkout v2 problem space.', sideEffects: 'none' }, executor: { type: 'agent' }, taskRun: { attempt: 1 } })
    expect(call.payload).not.toHaveProperty('credentials')
    expect(clean(r.statusPatch).context).toEqual(call.payload.context) // the resolved list the Adapter saw is recorded on the TaskRun (12-task.md)
    expect(r.actions[2]).toEqual({ type: 'setTimer', key: 'deadline', at: run.spec.deadline })
    run = apply(run, r)

    // attempt 1 fails with rate_limit: abandon, backoff (exponential 30s, jitter full with random 0 → 0s in our fake; the design shows 30s)
    clock = Date.parse('2026-09-21T09:05:00Z')
    const failed = { ...log.entries[1].event, payload: { ...log.entries[1].event.payload, idempotencyKey: 'prd-create-002//research/1' } }
    r = handler.reconcile(input(run, failed)) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Waiting', waitingReason: 'retryBackoff', attempts: [{ index: 1, state: 'failed', error: { code: 'rate_limit' } }] })
    expect(r.actions.map((a) => a.type)).toEqual(['abandonScope', 'clearTimer', 'setTimer'])
    expect(r.actions[0]).toEqual({ type: 'abandonScope', key: 'prd-create-002//research/1' })
    run = apply(run, r)

    // backoff fires: attempt 2
    clock = Date.parse('2026-09-21T09:05:31Z')
    r = handler.reconcile(input(run, { type: 'TimerFired', dedupeKey: 'timer/backoff/x', payload: { key: 'backoff', at: '2026-09-21T09:05:30Z' } })) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Running', attempts: [{ index: 1, state: 'failed' }, { index: 2, state: 'running', idempotencyKey: 'prd-create-002//research/2' }] })
    expect(r.actions.map((a) => a.type)).toEqual(['callAdapter', 'setTimer']) // no second deadline timer
    run = apply(run, r)

    // attempt 2 succeeds with the staged report
    clock = Date.parse('2026-09-21T10:00:00Z')
    const reportRef = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport', namespace: 'demo', id: 'research-checkout-v2', revision: 1 }
    const finished = { ...log.entries[3].event, payload: { ...log.entries[3].event.payload, idempotencyKey: 'prd-create-002//research/2' } }
    r = handler.reconcile(input(run, finished, [{ ref: reportRef, scope: 'prd-create-002//research/2' }])) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { report: { kind: 'artifact', ref: reportRef } }, attempts: [{ state: 'failed' }, { state: 'succeeded' }] })
    expect(r.actions).toEqual([{ type: 'commitScope', key: 'prd-create-002//research/2' }, { type: 'clearTimer', key: 'attempt' }, { type: 'clearTimer', key: 'deadline' }])
    run = apply(run, r)
    expect(handler.reconcile(input(run, { type: 'TimerFired', dedupeKey: 'x', payload: { key: 'deadline', at: 'x' } }))).toEqual({ actions: [] })
  })

  it('every Event after a terminal phase is a no-op', () => {
    const done = { ...base(), status: { phase: 'Succeeded', attempts: [], outputs: {} } } as unknown as TaskRun
    for (const ev of [{ type: 'AdapterFinished', dedupeKey: 'a', payload: { idempotencyKey: 'k', state: 'unknown' } }, { type: 'TimerFired', dedupeKey: 't', payload: { key: 'deadline', at: 'x' } }, { type: 'CancelRequested', dedupeKey: 'c' }] as const)
      expect(handler.reconcile(input(done, ev as never))).toEqual({ actions: [] })
  })

  it('the deadline closes the running attempt as failed', () => {
    let run = base()
    run = apply(run, handler.reconcile(input(run, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const dead = handler.reconcile(input(run, { type: 'TimerFired', dedupeKey: 'd', payload: { key: 'deadline', at: run.spec.deadline } })) as ReconcileResult
    expect(clean(dead.statusPatch).attempts).toMatchObject([{ index: 1, state: 'failed', error: { code: 'timeout' } }])
  })

  it('an unstaged or mistyped result is schema_violation and is not retried', () => {
    let run = base()
    run = apply(run, handler.reconcile(input(run, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const reportRef = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport', namespace: 'demo', id: 'research-checkout-v2', revision: 1 }
    const result = { protocol: 'persimmon.result/v1', outputs: { report: { kind: 'artifact', ref: reportRef } } }
    const ev = { type: 'AdapterFinished' as const, dedupeKey: 'a', payload: { idempotencyKey: 'prd-create-002//research/1', state: 'succeeded' as const, result } }
    const r = handler.reconcile(input(run, ev, [])) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'schema_violation' }, attempts: [{ state: 'failed', finishedAt: '2026-09-21T09:00:01Z' }] }) // no answer time: delivery time
    const answered = handler.reconcile(input(run, { ...ev, payload: { ...ev.payload, finishedAt: '2026-09-21T08:59:30.500Z' } }, [])) as ReconcileResult
    expect(clean(answered.statusPatch).attempts[0].finishedAt).toBe('2026-09-21T08:59:30Z') // the adapter's answer time, delivered later
    const wrong = handler.reconcile(input(run, { ...ev, payload: { ...ev.payload, result: { protocol: 'persimmon.result/v1', outputs: {} } } }, [])) as ReconcileResult
    expect(clean(wrong.statusPatch).error.message).toMatch(/report: output missing/)
  })

  it('unknown answers query when supported; the deadline cancels and fails with timeout', () => {
    let run = base()
    run = apply(run, handler.reconcile(input(run, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const r = handler.reconcile(input(run, { type: 'AdapterFinished', dedupeKey: 'a', sequence: 2, payload: { idempotencyKey: 'prd-create-002//research/1', state: 'unknown' } })) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Waiting', waitingReason: 'adapter', attempts: [{ state: 'unknown' }] })
    expect(r.actions[0]).toMatchObject({ type: 'callAdapter', op: 'query', idempotencyKey: 'prd-create-002//research/1/query/2', payload: { idempotencyKey: 'prd-create-002//research/1' } })
    run = apply(run, r)
    const running = handler.reconcile(input(run, { type: 'AdapterFinished', dedupeKey: 'b', sequence: 3, payload: { idempotencyKey: 'prd-create-002//research/1/query/2', state: 'succeeded', result: { state: 'running' } } })) as ReconcileResult
    expect(running.actions).toEqual([{ type: 'setTimer', key: 'query', at: new Date(clock + 30_000).toISOString().replace('.000Z', 'Z') }])
    const dead = handler.reconcile(input(run, { type: 'TimerFired', dedupeKey: 'c', sequence: 4, payload: { key: 'deadline', at: run.spec.deadline } })) as ReconcileResult
    expect(clean(dead.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'timeout' } })
    expect(dead.actions.map((a) => a.type)).toEqual(['callAdapter', 'abandonScope', 'clearTimer', 'clearTimer'])
    expect(dead.actions[0]).toMatchObject({ op: 'cancel' })
  })

  it('human Executor: Waiting on ack, completes from a Signal with the Actor and published content', () => {
    const run = base()
    run.spec.taskRef = { kind: 'Task', name: 'approve-prd' }
    run.spec.inputs = { prd: { kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'checkout-v2', revision: 3 } } }
    const approve = example('task-approve-prd')
    const reviewers = example('executor-product-reviewers')
    const humanClosure: Closure = { ...closure, resources: [...closure.resources, approve, reviewers] }
    deps.closure = () => humanClosure
    let r = handler.reconcile(input(run, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Waiting', waitingReason: 'human' })
    expect(r.actions[0]).toMatchObject({ type: 'callAdapter', adapterId: 'review-ui/v1', op: 'execute' })
    const shown = (r.actions[0] as { payload: { task: { outputs: { result: { type: { schema: Record<string, unknown> } } } } } }).payload.task.outputs.result.type.schema
    expect(shown).toMatchObject({ type: 'object', required: ['passed', 'findings', 'evidence'] }) // the well-known $ref arrives inlined for the form
    expect(JSON.stringify(shown)).not.toContain('$ref')
    let state = apply(run, r)
    r = handler.reconcile(input(state, { type: 'AdapterFinished', dedupeKey: 'a', payload: { idempotencyKey: 'prd-create-002//research/1', state: 'succeeded', result: { accepted: true } } })) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Waiting', waitingReason: 'human', attempts: [{ acknowledged: true }] })
    state = apply(state, r)
    const completion = { taskResult: { protocol: 'persimmon.result/v1', outputs: { result: { kind: 'value', value: { passed: true, findings: [], evidence: [] } } } }, publish: [] }
    const sig = input(state, { type: 'Signal', dedupeKey: 's', payload: { source: 'adapter', eventId: 'complete-1', payload: completion } })
    sig.context.actor = { kind: 'user', id: 'ryan' }
    r = handler.reconcile(sig) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Succeeded', actor: { kind: 'user', id: 'ryan' }, outputs: { result: { kind: 'value' } } })
    expect(r.actions[0]).toEqual({ type: 'commitScope', key: 'prd-create-002//research/1' })
  })

  it('human completion publishes content through the callback and fills the output from the returned ref', () => {
    const run = base()
    run.spec.taskRef = { kind: 'Task', name: 'write-prd' }
    run.spec.inputs = { research: { kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport', namespace: 'demo', id: 'research-checkout-v2', revision: 1 } } }
    const humanClosure: Closure = { ...closure, resources: closure.resources.map((r) => (r.kind === 'Executor' ? { ...r, spec: { ...r.spec, type: 'human', adapter: 'review-ui/v1' } } : r)) }
    deps.closure = () => humanClosure
    let state = apply(run, handler.reconcile(input(run, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const request = { kind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' }, id: 'checkout-v2', content: { title: 'x', problem: 'y', requirements: [] }, representations: [] }
    const completion = { taskResult: { protocol: 'persimmon.result/v1', outputs: {} }, publish: [{ port: 'prd', request }] }
    const r = handler.reconcile(input(state, { type: 'Signal', dedupeKey: 's', payload: { source: 'adapter', eventId: 'c', payload: completion } })) as ReconcileResult
    expect(published).toEqual([request])
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { prd: { kind: 'artifact', ref: { id: 'checkout-v2', revision: 7 } } } })
    // a ref the signal carries as an output, published nowhere, is not staged: schema_violation
    const smuggled = { taskResult: { protocol: 'persimmon.result/v1', outputs: { prd: { kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'checkout-v2', revision: 3 } } } }, publish: [] }
    const bad = handler.reconcile(input(state, { type: 'Signal', dedupeKey: 's2', payload: { source: 'adapter', eventId: 'c2', payload: smuggled } })) as ReconcileResult
    expect(clean(bad.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'schema_violation', message: 'artifact checkout-v2 revision 3 not staged in this attempt' } })
    state = apply(state, r)
    expect(handler.reconcile(input(state, { type: 'CancelRequested', dedupeKey: 'cancel' }))).toEqual({ actions: [] })
  })

  it('an output that chooses its id: resolved at start, handed to the Adapter, enforced on the published ref', () => {
    const research = closure.resources.find((r) => r.kind === 'Task' && (r.spec as { action: { instructions: string } }).action.instructions.startsWith('Research'))!
    const withId = (id: unknown): Closure => ({ ...closure, resources: closure.resources.map((r) => (r === research ? { ...r, spec: { ...r.spec, outputs: { report: { ...(r.spec as TaskSpec).outputs!.report, id } } } } : r)) })
    deps.closure = () => withId({ literal: 'research-checkout-v2' })
    let run = base()
    const r = handler.reconcile(input(run, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect((r.actions[0] as { payload: { task: { outputIds: unknown } } }).payload.task.outputIds).toEqual({ report: 'research-checkout-v2' })
    run = apply(run, r)
    const ref = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport', namespace: 'demo', id: 'research-checkout-v2', revision: 2 }
    const finished = (id: string) => ({ type: 'AdapterFinished' as const, dedupeKey: 'a', payload: { idempotencyKey: 'prd-create-002//research/1', state: 'succeeded' as const, result: { protocol: 'persimmon.result/v1', outputs: { report: { kind: 'artifact', ref: { ...ref, id } } } } } })
    const other = handler.reconcile(input(run, finished('prd-create-002-research-report'), [{ ref: { ...ref, id: 'prd-create-002-research-report' }, scope: 'prd-create-002//research/1' }])) as ReconcileResult
    expect(clean(other.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'schema_violation', message: 'report: published prd-create-002-research-report, not the chosen id research-checkout-v2' } })
    const ok = handler.reconcile(input(run, finished('research-checkout-v2'), [{ ref, scope: 'prd-create-002//research/1' }])) as ReconcileResult
    expect(clean(ok.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { report: { ref: { id: 'research-checkout-v2', revision: 2 } } } })
    // an artifacts output: the prefix is handed over, every item is <prefix>-<n> in order
    const prd = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' }
    deps.closure = () => ({ ...closure, resources: closure.resources.map((r) => (r === research ? { ...r, spec: { ...r.spec, outputs: { ...(r.spec as TaskSpec).outputs, many: { type: { kind: 'artifacts', artifactKind: prd }, id: { literal: 'checkout-adr' } } } } } : r)) })
    let runM = base()
    const rm = handler.reconcile(input(runM, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect((rm.actions[0] as { payload: { task: { outputIds: unknown } } }).payload.task.outputIds).toEqual({ many: 'checkout-adr' })
    expect(Object.keys((rm.actions[0] as { payload: { task: { outputSchemas: object } } }).payload.task.outputSchemas)).toEqual(['report', 'many']) // the item schema rides along for the list port
    runM = apply(runM, rm)
    const refsOf = (ids: string[]) => ids.map((id) => ({ ...prd, namespace: 'demo', id, revision: 1 }))
    const report = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport', namespace: 'demo', id: 'prd-create-002-research-report', revision: 1 }
    const finishedMany = (ids: string[]) => ({ type: 'AdapterFinished' as const, dedupeKey: 'm', payload: { idempotencyKey: 'prd-create-002//research/1', state: 'succeeded' as const, result: { protocol: 'persimmon.result/v1', outputs: { report: { kind: 'artifact', ref: report }, many: { kind: 'artifacts', refs: refsOf(ids) } } } } })
    const stagedMany = (ids: string[]) => [{ ref: report, scope: 'prd-create-002//research/1' }, ...refsOf(ids).map((ref) => ({ ref, scope: 'prd-create-002//research/1' }))]
    const wrong = handler.reconcile(input(runM, finishedMany(['checkout-adr-1', 'checkout-adr-3']), stagedMany(['checkout-adr-1', 'checkout-adr-3']))) as ReconcileResult
    expect(clean(wrong.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'schema_violation', message: 'many[1]: published checkout-adr-3, not the chosen id checkout-adr-2' } })
    const okM = handler.reconcile(input(runM, finishedMany(['checkout-adr-1', 'checkout-adr-2']), stagedMany(['checkout-adr-1', 'checkout-adr-2']))) as ReconcileResult
    expect(clean(okM.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { many: { kind: 'artifacts', refs: [{ id: 'checkout-adr-1' }, { id: 'checkout-adr-2' }] } } })
    // a value that is no Id fails the attempt before any call
    deps.closure = () => withId({ expression: 'inputs.repository.id' })
    const bad = handler.reconcile(input(base(), { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(bad.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'invalid_input', message: 'report: id "github.com/persimmon-ai/demo" is not an Id' } })
    // a CEL runtime error (a key the bound input lacks) fails the attempt the same way, never escapes reconcile
    deps.closure = () => withId({ expression: 'inputs.repository.locator.nope' })
    const thrown = handler.reconcile(input(base(), { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(thrown.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'invalid_input', message: expect.stringMatching(/^report: id expression: /) } })
  })

  it('validate checks an output id: artifact port, inputs only, a string', () => {
    const task = example('task-write-prd')
    const check = (id: unknown, port = 'prd') => {
      const t = structuredClone(task)
      t.spec.outputs[port] = { ...(t.spec.outputs[port] ?? { type: { kind: 'value', schema: { type: 'integer' } } }), id }
      return handler.validate(t).findings.map((f) => f.message)
    }
    expect(check({ expression: "inputs.research.id + '-prd'" })).toEqual([])
    expect(check({ literal: 'checkout-v2' })).toEqual([])
    expect(check({ fromInput: 'maxRequirements' })).toEqual(['prd: id fromInput maxRequirements is not a string value input'])
    expect(check({ expression: 'inputs.maxRequirements + 1' })).toEqual(['prd: id expression is int, not string'])
    expect(check({ expression: 'inputs.nope' })).toEqual([expect.stringMatching(/^prd: id expression: /)])
    expect(check({ literal: 7 })).toEqual(['prd: id literal is not a string'])
    expect(check({ fromInput: 'research' })).toEqual(['prd: id fromInput research is not a string value input'])
    expect(check({ fromStep: { stepRef: 'x', output: 'y' } })).toEqual(['prd: id reads inputs only'])
    expect(check({ literal: 'x' }, 'count')).toEqual(['count: only an artifact or artifacts output chooses its id'])
  })

  it('cancel is immediate and validate catches context and retry policy mistakes', () => {
    let run = base()
    run = apply(run, handler.reconcile(input(run, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult)
    const r = handler.reconcile(input(run, { type: 'CancelRequested', dedupeKey: 'cancel', sequence: 2 })) as ReconcileResult
    expect(clean(r.statusPatch)).toMatchObject({ phase: 'Cancelled' })
    expect(r.actions.map((a) => a.type)).toEqual(['callAdapter', 'abandonScope', 'clearTimer', 'clearTimer', 'clearTimer'])
    const task = example('task-write-prd')
    task.spec.retryPolicy.retryOn.push('invalid_input')
    task.spec.action.context.push({ kind: 'file', input: 'research', path: 'x' })
    task.spec.action.workspace = { input: 'research' }
    task.spec.outputs.many = { type: { kind: 'artifacts', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } }
    const findings = handler.validate(task).findings
    expect(findings.map((f) => f.message)).toEqual(['invalid_input in both retryOn and abortOn', 'invalid_input is never retried', 'many: an artifacts output names its id prefix', 'research is not an externalResource port', 'research is not an externalResource port'])
  })

  it('action.workspace reaches the execute payload: a path as given, an input through its locator.path', () => {
    const task = closure.resources.find((r) => r.kind === 'Task' && (r.spec as { action: { instructions: string } }).action.instructions.startsWith('Research'))!.spec as unknown as TaskSpec
    const call = (run = base()) => handler.reconcile(input(run, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    const payload = (run?: TaskRun) => (call(run).actions[0] as { payload: Record<string, unknown> }).payload
    task.action.workspace = { path: 'app' }
    const withWorkspace = payload()
    expect(withWorkspace.workspace).toBe('app')
    const complete = (p: Record<string, unknown>) => ({ ...p, credentials: {}, engine: { endpoint: 'unix://x', token: 't' } }) // the dispatcher adds these
    expect(schemaOf('adapter-roles.yaml', '/$defs/ExecutePayload')(complete(withWorkspace))).toBe(true) // the payload is the documented shape, no extra keys
    expect(schemaOf('adapter-roles.yaml', '/$defs/ExecutePayload')(example('adapter-roles-execute'))).toBe(true) // 19-adapter-roles.md example
    task.action.workspace = { input: 'repository' } // the fixture's repository is remote: no locator.path
    expect(clean(call().statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'invalid_input', message: 'workspace input repository has no locator.path' } })
    const local = base()
    ;(local.spec.inputs.repository as { ref: { locator: Record<string, unknown> } }).ref.locator = { path: '/work/demo' }
    expect(payload(local).workspace).toBe('/work/demo')
    delete task.action.workspace
  })
})
