import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AdapterRegistry, describe as describeAdapter } from '../adapter/registry.js'
import type { Adapter } from '../adapter/types.js'
import { HandlerRegistry } from '../handler/registry.js'
import type { HandlerImpl, ReconcileInput } from '../handler/types.js'
import { KindRegistry } from '../kind-definition/registry.js'
import type { Resource } from '../resource/types.js'
import { liveResolver } from '../snapshot/resolver.js'
import type { Closure } from '../snapshot/walk.js'
import { SqliteStore } from '../store/sqlite.js'
import { memoryBlobs } from '../store/test-util.js'
import { appendEvent, drain, type Engine, pumpTimers, reconcileOnce, recoverCalls } from './dispatch.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const closure = example('snapshot-closure') as Closure
const fresh = ({ status: _s, ...r }: Resource): Resource => ({ ...r, metadata: { name: r.metadata.name, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) } })
const fakeAdapter: Adapter = {
  apiVersion: 'persimmon.ai/v1', kind: 'Adapter', metadata: { name: 'fake-v1' },
  spec: { id: 'fake/v1', roles: ['executor'], transport: 'stdio', command: ['node', 'test/fixtures/fake-adapter.mjs'] },
}

describe('dispatcher', () => {
  let store: SqliteStore
  let engine: Engine
  let clock: number
  let impl: HandlerImpl
  let seen: ReconcileInput[]
  let errors: string[]
  beforeEach(async () => {
    clock = Date.parse('2026-09-21T09:00:00Z')
    seen = []
    errors = []
    store = new SqliteStore(':memory:', { blobs: memoryBlobs(), now: () => new Date(clock) })
    const kinds = new KindRegistry()
    for (const n of ['workflow', 'task', 'prompt', 'workflowrun', 'productrequirement', 'researchreport']) kinds.register(example(`kind-definition-${n}`))
    for (const kd of closure.resources.filter((r) => r.kind === 'KindDefinition' && /^(executors|skills|taskruns)\./.test(r.metadata.name))) kinds.register(kd)
    impl = { validate: () => ({ findings: [] }), reconcile: () => ({ actions: [] }) }
    const handlers = new HandlerRegistry(new Map([['workflow', { validate: (r) => impl.validate(r), reconcile: (i) => { seen.push(i); return impl.reconcile(i) } }]]))
    handlers.register(example('handler-workflow'))
    const adapters = new AdapterRegistry({ resolve: () => undefined })
    adapters.register(await describeAdapter(fakeAdapter, { resolve: () => undefined }, () => new Date(clock)))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) store.resources.put(fresh(r as Resource))
    engine = {
      store, kinds, handlers, adapters, resolver: liveResolver(kinds, store, adapters), defaultNamespace: 'default', now: () => new Date(clock),
      maxCausationDepth: 32, defaultCallDeadlineMs: 60_000, endpoint: 'unix://test.sock', cwd: '/proj', credentials: { resolve: () => undefined }, maxReconcileAttempts: 3, leaseTtlMs: 30_000, retryBaseMs: 0, holder: 'test', inFlight: new Map(),
      onError: (_uid, event, error) => errors.push(`${event.type}: ${error.message}`),
    }
  })
  afterEach(() => store.close())

  const startRun = () => {
    const r = store.resources.put({ ...fresh(example('resource-namespaced')), metadata: { ...fresh(example('resource-namespaced')).metadata, snapshot: example('resource-namespaced').metadata.snapshot } })
    appendEvent(engine, r.metadata.uid!, { type: 'Created', dedupeKey: 'created' })
    return r
  }

  it('delivers Created, fires a timer, reaches a terminal value', async () => {
    impl.reconcile = (i) =>
      i.event.type === 'Created'
        ? { statusPatch: { phase: 'Running' }, actions: [{ type: 'setTimer', key: 'deadline', at: '2026-09-21T09:05:00Z' }] }
        : { statusPatch: { phase: 'Failed', error: { code: 'timeout', message: 'deadline', retryable: false } }, actions: [] }
    const r = startRun()
    await drain(engine)
    expect(store.resources.getByUid(r.metadata.uid!)?.status?.phase).toBe('Running')
    expect(seen[0]?.context).toEqual({ children: [], timers: [], staged: [], snapshot: r.metadata.snapshot })
    expect(seen[0]?.engine.endpoint).toBe('unix://test.sock')
    expect(pumpTimers(engine)).toBe(0)
    clock += 5 * 60_000
    await drain(engine)
    const done = store.resources.getByUid(r.metadata.uid!)!
    expect(errors).toEqual([])
    expect(done.status?.phase).toBe('Failed')
    expect(seen[1]?.event).toMatchObject({ type: 'TimerFired', payload: { key: 'deadline', at: '2026-09-21T09:05:00Z' } })
    expect(seen[1]?.context.timers).toEqual([]) // fired, so no longer pending
    expect(store.runLog.listOpen()).toEqual([])
    expect(store.audit.read(r.metadata.uid!).map((a) => a.change)).toEqual(['status', 'status'])
  })

  it('retries, stalls after maxReconcileAttempts, and resumes on a new Event', async () => {
    let calls = 0
    impl.reconcile = () => {
      calls++
      throw new Error('boom')
    }
    const r = startRun()
    await drain(engine)
    expect(calls).toBe(3)
    const stalled = store.resources.getByUid(r.metadata.uid!)!
    expect(stalled.metadata.stalled).toEqual({ attempts: 3, lastError: 'boom' })
    expect(errors).toEqual(['Created: boom', 'Created: boom', 'Created: boom'])
    expect(store.audit.read(r.metadata.uid!).map((a) => a.change)).toEqual(['metadata'])
    await drain(engine)
    expect(calls).toBe(3) // stopped delivering
    impl.reconcile = () => ({ statusPatch: { phase: 'Running' }, actions: [] })
    appendEvent(engine, r.metadata.uid!, { type: 'Signal', dedupeKey: 'signal/e1', payload: { source: 'api', eventId: 'e1' } })
    expect(store.resources.getByUid(r.metadata.uid!)?.metadata.stalled).toBeUndefined()
    await drain(engine)
    expect(seen.map((i) => i.event.type)).toEqual(['Created', 'Created', 'Created', 'Created', 'Signal'])
    expect(store.runLog.listOpen()).toEqual([])
  })

  it('dispatches callAdapter and delivers AdapterFinished; recovery marks open calls unknown', async () => {
    impl.reconcile = (i) => {
      if (i.event.type === 'Created') return { statusPatch: { phase: 'Running' }, actions: [{ type: 'callAdapter', adapterId: 'fake/v1', op: 'execute', payload: { attempt: 1 }, idempotencyKey: 'k/1' }] }
      if (i.event.type === 'AdapterFinished') return { statusPatch: { phase: i.event.payload.state === 'succeeded' ? 'Succeeded' : 'Failed', ...(i.event.payload.state === 'unknown' ? { error: { code: 'unknown_result', message: 'x', retryable: false } } : {}) }, actions: [] }
      return { actions: [] }
    }
    const r = startRun()
    await drain(engine)
    expect(errors).toEqual([])
    expect(store.resources.getByUid(r.metadata.uid!)?.status?.phase).toBe('Succeeded')
    const finished = seen.find((i) => i.event.type === 'AdapterFinished')!.event as { payload: { result: { echo: unknown; env: { token: unknown } } } }
    expect(finished.payload.result.echo).toMatchObject({ attempt: 1, engine: { endpoint: 'unix://test.sock', token: expect.any(String) } })
    expect(store.runLog.outstandingCalls()).toEqual([])
    expect(store.tokens.verify(finished.payload.result.echo!['engine' as never]['token'])).toBeUndefined()
    expect(store.runLog.logs(r.metadata.uid!, 1)).toEqual(['working']) // the fake's stream log line, on the entry that issued the call

    // a second run whose call never answered before restart
    seen = []
    const r2 = store.resources.put({ ...fresh(example('resource-namespaced')), metadata: { name: 'prd-create-002', namespace: 'demo', snapshot: r.metadata.snapshot! } })
    appendEvent(engine, r2.metadata.uid!, { type: 'Created', dedupeKey: 'created' })
    const entry = store.runLog.listOpen()[0]!
    await reconcileOnce(engine, r2.metadata.uid!, entry.entry)
    expect(store.runLog.outstandingCalls()).toHaveLength(1)
    expect(recoverCalls(engine)).toBe(1)
    await drain(engine)
    expect(store.resources.getByUid(r2.metadata.uid!)?.status?.phase).toBe('Failed')
  })

  it('a call past its deadline answers unknown with the reason', async () => {
    impl.reconcile = (i) => {
      if (i.event.type === 'Created') return { statusPatch: { phase: 'Running' }, actions: [{ type: 'callAdapter', adapterId: 'fake/v1', op: 'hang', payload: {}, idempotencyKey: 'k/1', deadline: new Date(clock + 200).toISOString() }] }
      if (i.event.type === 'AdapterFinished') return { statusPatch: { phase: 'Failed', error: { code: 'unknown_result', message: `no recorded answer: ${(i.event.payload as { reason?: string }).reason}`, retryable: false } }, actions: [] }
      return { actions: [] }
    }
    const r = startRun()
    await drain(engine)
    expect(store.resources.getByUid(r.metadata.uid!)?.status?.error?.message).toBe('no recorded answer: deadline')
  })

  it('a Signal reconcile\'s token carries its actor and dies with the reconcile', async () => {
    const r = startRun()
    await drain(engine)
    appendEvent(engine, r.metadata.uid!, { type: 'Signal', dedupeKey: 'signal/s1', payload: { source: 'api', eventId: 's1' } }, { kind: 'user', id: 'local' })
    await drain(engine)
    const token = seen.at(-1)!.engine.token
    expect(seen.at(-1)!.event.type).toBe('Signal')
    expect(store.tokens.verify(token)).toBeUndefined() // revoked by the scope it was issued with, actor and all
  })

  it('a lost lease refuses the commit and the Event is redelivered', async () => {
    let calls = 0
    impl.reconcile = () => {
      calls++
      store.leases.release(r.metadata.uid!, 'test') // someone else took it while we were reconciling
      store.leases.acquire(r.metadata.uid!, 'intruder', 60_000)
      return { statusPatch: { phase: 'Running' }, actions: [] }
    }
    const r = startRun()
    const entry = store.runLog.listOpen()[0]!
    expect(await reconcileOnce(engine, r.metadata.uid!, entry.entry)).toBe('failed')
    expect(errors).toEqual(['Created: lease lost'])
    expect(store.resources.getByUid(r.metadata.uid!)?.status).toBeUndefined()
    expect(store.runLog.listOpen()).toHaveLength(1)
    expect(calls).toBe(1)
  })

  it('a ChildFinished on a stalled Resource clears stalled', async () => {
    impl.reconcile = () => {
      throw new Error('boom')
    }
    const r = startRun()
    await drain(engine)
    expect(store.resources.getByUid(r.metadata.uid!)?.metadata.stalled).toBeDefined()
    impl.reconcile = () => ({ statusPatch: { phase: 'Running' }, actions: [] })
    appendEvent(engine, r.metadata.uid!, { type: 'ChildFinished', dedupeKey: 'child/x', payload: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'demo', name: 'c', uid: 'x' }, value: 'Succeeded' } })
    expect(store.resources.getByUid(r.metadata.uid!)?.metadata.stalled).toBeUndefined()
    await drain(engine)
    expect(store.runLog.listOpen()).toEqual([])
  })

  it('a deleted Resource acks its open Events; a leased Resource is skipped', async () => {
    const r = startRun()
    store.leases.acquire(r.metadata.uid!, 'someone-else', 60_000)
    await drain(engine)
    expect(seen).toEqual([])
    store.leases.release(r.metadata.uid!, 'someone-else')
    store.resources.delete(r.metadata.uid!)
    await drain(engine)
    expect(store.runLog.listOpen()).toEqual([])
  })
})
