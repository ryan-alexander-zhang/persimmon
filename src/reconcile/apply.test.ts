import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AdapterRegistry } from '../adapter/registry.js'
import { HandlerRegistry } from '../handler/registry.js'
import type { HandlerImpl } from '../handler/types.js'
import { KindRegistry } from '../kind-definition/registry.js'
import type { OutboxEvent } from '../outbox/event.js'
import type { Resource } from '../resource/types.js'
import { liveResolver } from '../snapshot/resolver.js'
import { storeClosure } from '../snapshot/snapshot.js'
import type { Closure } from '../snapshot/walk.js'
import { SqliteStore } from '../store/sqlite.js'
import { memoryBlobs } from '../store/test-util.js'
import { type Commit, commit, type Engine } from './apply.js'
import { CommitError } from './status.js'
import type { Action, Event } from './types.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const closure = example('snapshot-closure') as Closure
const fresh = ({ status: _s, ...r }: Resource): Resource => ({ ...r, metadata: { name: r.metadata.name, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) } })
const noop: HandlerImpl = { validate: () => ({ findings: [] }), reconcile: () => ({ actions: [] }) }
const handlerActor = { kind: 'handler' as const, id: 'task' }

describe('commit', () => {
  let store: SqliteStore
  let engine: Engine
  let owner: Resource
  let child: Resource
  beforeEach(() => {
    store = new SqliteStore(':memory:', { blobs: memoryBlobs() })
    const kinds = new KindRegistry()
    for (const n of ['workflow', 'task', 'prompt', 'workflowrun', 'productrequirement', 'researchreport']) kinds.register(example(`kind-definition-${n}`))
    for (const kd of closure.resources.filter((r) => r.kind === 'KindDefinition' && /^(executors|skills|taskruns)\./.test(r.metadata.name))) kinds.register(kd)
    const handlers = new HandlerRegistry(new Map([['workflow', noop], ['task', noop]]))
    handlers.register(example('handler-workflow'))
    handlers.register({ apiVersion: 'persimmon.ai/v1', kind: 'Handler', metadata: { name: 'task' }, spec: { kinds: [{ group: 'persimmon.ai', kind: 'Task', versions: ['v1'] }, { group: 'persimmon.ai', kind: 'TaskRun', versions: ['v1'] }], implementation: { builtin: 'task' } } })
    const adapters = new AdapterRegistry({ resolve: () => undefined })
    adapters.register(example('adapter-claude-code'))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) store.resources.put(fresh(r as Resource))
    engine = { store, kinds, handlers, adapters, resolver: liveResolver(kinds, store, adapters), defaultNamespace: 'default', now: () => new Date('2026-09-21T10:00:00Z'), maxCausationDepth: 32, defaultCallDeadlineMs: 3_600_000 }
    const snapshot = storeClosure(closure, store.snapshots) // the closure the runs' snapshot names, so a publish reads its frozen schema
    owner = store.resources.put({ ...fresh(example('resource-namespaced')), metadata: { ...fresh(example('resource-namespaced')).metadata, snapshot } })
    const c = fresh(example('resource-child'))
    c.metadata.ownerReferences = [{ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: owner.metadata.name, uid: owner.metadata.uid! }]
    c.metadata.snapshot = owner.metadata.snapshot!
    child = store.resources.put(c)
    store.runLog.append(child.metadata.uid!, { type: 'Created', dedupeKey: 'created' })
  })
  afterEach(() => store.close())

  const commitOf = (resource: Resource, event: Event, result: Commit['result']): Commit => ({
    resource, event, result, actor: handlerActor, handler: engine.handlers.get(resource.apiVersion, resource.kind), causationChain: [],
  })
  const outbox = () => store.outbox.claim(50, 't', 1000) as unknown as OutboxEvent[]

  it('replays the design RunLog to Succeeded: timers, scopes, ChildFinished, resource.finished', async () => {
    const log = example('reconcile-runlog') as { entries: { event: Event; result: Commit['result'] }[] }
    const uid = child.metadata.uid!
    let r = child
    // what the adapter staged under attempt 2 before the last entry commits it
    const scope2 = { uid, key: 'prd-create-001//research/2' }
    for (const [i, e] of log.entries.entries()) {
      const seq = i === 0 ? 1 : store.runLog.append(uid, { type: e.event.type, dedupeKey: e.event.dedupeKey, ...(e.event.payload ? { payload: e.event.payload } : {}) } as never)
      expect(seq).toBe(e.event.sequence)
      if (e.event.type === 'TimerFired') store.timers.clear(uid, (e.event.payload as { key: string }).key) // the timer pump does this
      if (e.event.sequence === 4) {
        const rev = fresh(example('revisioned-instance'))
        rev.kind = 'ResearchReport'
        rev.metadata.name = 'research-checkout-v2.r1'
        rev.spec = { ...rev.spec, identity: { id: 'research-checkout-v2', revision: 1 } }
        store.resources.stage({ ...rev, status: { contentDigest: 'sha256:' + 'c'.repeat(64), representations: [] } }, scope2)
      }
      r = await commit(engine, commitOf(r, e.event, e.result))
    }
    expect(r.status?.phase).toBe('Succeeded')
    expect(store.runLog.read(uid).every((e) => e.appliedAt)).toBe(true)
    expect(store.timers.due('2099-01-01T00:00:00Z')).toEqual([])
    expect(store.resources.get({ kind: 'ResearchReport', namespace: 'demo', name: 'research-checkout-v2.r1' })).toBeDefined()
    expect(store.runLog.outstandingCalls()).toEqual([]) // AdapterFinished for attempt 2 closed the call
    const ownerLog = store.runLog.read(owner.metadata.uid!)
    expect(ownerLog.map((e) => e.event.type)).toEqual(['ChildFinished'])
    expect(ownerLog[0]!.event.payload).toEqual({ ref: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'demo', name: child.metadata.name, uid }, value: 'Succeeded' })
    const events = outbox()
    expect(events.map((e) => e.type)).toEqual(['artifact.published', 'resource.finished'])
    expect(events[1]).toMatchObject({ producer: { uid, sequence: 4 }, ordinal: 1, payload: { value: 'Succeeded' }, actor: handlerActor })
    expect(store.audit.read(uid).map((a) => a.change)).toEqual(['status', 'status', 'status', 'status'])
  })

  it('createResource makes an owned child with the inherited snapshot; cancelResource signals it', async () => {
    const wrOwner = store.resources.getByUid(owner.metadata.uid!)!
    store.runLog.append(wrOwner.metadata.uid!, { type: 'Created', dedupeKey: 'created' })
    const io = example('handler-reconcile-io')
    const create = io.output.actions[0] as Action
    const r = await commit(engine, { ...commitOf(wrOwner, { type: 'Created', sequence: 1, dedupeKey: 'created' }, { statusPatch: io.output.statusPatch, actions: [create] }), causationChain: ['sha256:a'] })
    expect((r.status as { steps: Record<string, unknown> }).steps['write-prd']).toBeDefined()
    const made = store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: 'prd-create-001-write-prd' })!
    expect(made.metadata.ownerReferences?.[0]?.uid).toBe(wrOwner.metadata.uid)
    expect(made.metadata.snapshot).toEqual(wrOwner.metadata.snapshot)
    expect(store.runLog.read(made.metadata.uid!)[0]?.event).toMatchObject({ type: 'Created', causationChain: ['sha256:a'] })
    expect(outbox()[0]).toMatchObject({ type: 'resource.created', producer: { uid: wrOwner.metadata.uid, sequence: 1 }, actor: { kind: 'handler', id: 'workflow' } })

    const cancel: Action = { type: 'cancelResource', ref: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'demo', name: made.metadata.name } }
    store.runLog.append(wrOwner.metadata.uid!, { type: 'CancelRequested', dedupeKey: 'cancel' })
    await commit(engine, commitOf(r, { type: 'CancelRequested', sequence: 2, dedupeKey: 'cancel' }, { actions: [cancel] }))
    expect(store.runLog.read(made.metadata.uid!).map((e) => e.event.type)).toEqual(['Created', 'CancelRequested'])
  })

  it('publishArtifact inside a reconcile stages, commits and emits artifact.published', async () => {
    const blob = store.blobs.put(Buffer.from('# research'), 'text/markdown')
    const publish = { ...(example('reconcile-actions')[2] as Action), representations: [{ name: 'markdown', mediaType: 'text/markdown', digest: blob.digest }] }
    await commit(engine, commitOf(child, { type: 'Created', sequence: 1, dedupeKey: 'created' }, { actions: [publish] }))
    const rev = store.resources.get({ kind: 'ResearchReport', namespace: 'demo', name: 'research-checkout-v2.r1' })!
    expect(rev.spec).toMatchObject({ identity: { id: 'research-checkout-v2', revision: 1 }, provenance: { producerRef: { uid: child.metadata.uid }, inputs: [], actor: handlerActor } })
    expect((rev.status as { contentDigest: string }).contentDigest).toMatch(/^sha256:/)
    expect(outbox()[0]).toMatchObject({ type: 'artifact.published', subject: { id: 'research-checkout-v2', revision: 1 } })
    expect(store.audit.read(rev.metadata.uid!)[0]?.change).toBe('create')
  })

  it('a publish validates against the schema the producer\'s snapshot froze, not the live one', async () => {
    const narrowed = example('kind-definition-researchreport')
    narrowed.spec.versions[0].schema.required = [...narrowed.spec.versions[0].schema.required, 'nope']
    engine.kinds.register(narrowed, { replace: true, committed: () => [] }) // the live schema now refuses what the run's closure allows
    const blob = store.blobs.put(Buffer.from('# research'), 'text/markdown')
    const publish = { ...(example('reconcile-actions')[2] as Action), representations: [{ name: 'markdown', mediaType: 'text/markdown', digest: blob.digest }] }
    await commit(engine, commitOf(child, { type: 'Created', sequence: 1, dedupeKey: 'created' }, { actions: [publish] }))
    expect(store.resources.get({ kind: 'ResearchReport', namespace: 'demo', name: 'research-checkout-v2.r1' })).toBeDefined()
    const bare = { ...child, metadata: { ...child.metadata, snapshot: undefined } } as Resource // no snapshot: the live schema
    await expect(commit(engine, commitOf(bare, { type: 'Created', sequence: 2, dedupeKey: 'created-2' }, { actions: [publish] }))).rejects.toThrow(/nope/)
  })

  it('reaching a terminal value abandons every open Publication scope', async () => {
    const uid = child.metadata.uid!
    const rev = fresh(example('revisioned-instance'))
    store.resources.stage({ ...rev, status: { contentDigest: 'sha256:' + 'c'.repeat(64), representations: [] } }, { uid, key: 'attempt/9' })
    await commit(engine, commitOf(child, { type: 'Created', sequence: 1, dedupeKey: 'created' }, { statusPatch: { phase: 'Cancelled' }, actions: [] }))
    expect(store.resources.staged(uid)).toMatchObject([{ scope: 'attempt/9', state: 'abandoned' }])
  })

  it('refuses reserved emitEvent types and invalid content; nothing is acked', async () => {
    const ev: Event = { type: 'Created', sequence: 1, dedupeKey: 'created' }
    await expect(commit(engine, commitOf(child, ev, { actions: [{ type: 'emitEvent', eventType: 'resource.custom', payload: {} }] }))).rejects.toThrow(CommitError)
    const bad = { ...(example('reconcile-actions')[2] as Action), content: {} } as Action
    await expect(commit(engine, commitOf(child, ev, { actions: [bad] }))).rejects.toThrow(/content/)
    await expect(commit(engine, commitOf(child, ev, { actions: [{ type: 'callAdapter', adapterId: 'gone/v1', op: 'execute', payload: {}, idempotencyKey: 'k' }] }))).rejects.toThrow(/not registered/)
    expect(store.runLog.listOpen()).toHaveLength(1)
    expect(outbox()).toEqual([])
  })
})
