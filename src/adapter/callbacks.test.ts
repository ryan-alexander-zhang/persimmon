import { readFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HandlerRegistry } from '../handler/registry.js'
import type { HandlerImpl } from '../handler/types.js'
import { KindRegistry } from '../kind-definition/registry.js'
import { commit, reconcileScope } from '../reconcile/apply.js'
import type { Actor, Resource } from '../resource/types.js'
import { liveResolver } from '../snapshot/resolver.js'
import { storeClosure } from '../snapshot/snapshot.js'
import type { Closure } from '../snapshot/walk.js'
import { SqliteStore } from '../store/sqlite.js'
import { memoryBlobs } from '../store/test-util.js'
import { type CallbackEngine, callback, CallbackError } from './callbacks.js'
import { AdapterRegistry } from './registry.js'
import { callbackServer, listenUnix } from './server.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const closure = example('snapshot-closure') as Closure
const fresh = ({ status: _s, ...r }: Resource): Resource => ({ ...r, metadata: { name: r.metadata.name, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) } })
const noop: HandlerImpl = { validate: () => ({ findings: [] }), reconcile: () => ({ actions: [] }) }

describe('engine callbacks', () => {
  let store: SqliteStore
  let engine: CallbackEngine
  let run: Resource
  let signals: { uid: string; eventId: string; actor: Actor }[]
  beforeEach(() => {
    store = new SqliteStore(':memory:', { blobs: memoryBlobs() })
    const kinds = new KindRegistry()
    for (const n of ['workflow', 'task', 'prompt', 'workflowrun', 'productrequirement', 'researchreport']) kinds.register(example(`kind-definition-${n}`))
    for (const kd of closure.resources.filter((r) => r.kind === 'KindDefinition' && /^(executors|skills|taskruns)\./.test(r.metadata.name))) kinds.register(kd)
    const handlers = new HandlerRegistry(new Map([['workflow', noop]]))
    handlers.register(example('handler-workflow'))
    const adapters = new AdapterRegistry({ resolve: () => undefined })
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) store.resources.put(fresh(r as Resource))
    signals = []
    engine = {
      store, kinds, handlers, adapters, resolver: liveResolver(kinds, store, adapters), defaultNamespace: 'default', now: () => new Date('2026-09-21T10:00:00Z'),
      maxCausationDepth: 32, defaultCallDeadlineMs: 60_000,
      signal: (uid, eventId, actor) => signals.push({ uid, eventId, actor }),
    }
    const snapshot = storeClosure(closure, store.snapshots)
    run = store.resources.put({ ...fresh(example('resource-namespaced')), metadata: { ...fresh(example('resource-namespaced')).metadata, snapshot } })
    store.runLog.append(run.metadata.uid!, { type: 'Created', dedupeKey: 'created' })
  })
  afterEach(() => store.close())

  const reconcileToken = () => store.tokens.issue({ kind: 'reconcile', uid: run.metadata.uid, sequence: 1 })

  it('reads in the caller Namespace then Global, and answers schemas from the snapshot', () => {
    const t = reconcileToken()
    expect((callback(engine, t, 'getResource', { apiVersion: 'persimmon.ai/v1', kind: 'Task', name: 'write-prd' }) as Resource).metadata.namespace).toBe('demo')
    expect((callback(engine, t, 'list', { apiVersion: 'persimmon.ai/v1', kind: 'Task' }) as Resource[]).map((r) => r.metadata.name)).toEqual(['research', 'write-prd'])
    expect(() => callback(engine, t, 'getResource', { apiVersion: 'persimmon.ai/v1', kind: 'Task', name: 'nope' })).toThrow(CallbackError)
    const schema = callback(engine, t, 'getKindSchema', { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' }) as { name: string; schema: { required: string[] } }
    expect(schema).toEqual({ name: 'v1', schema: { type: 'object', required: ['title'] } }) // the abbreviated snapshot copy, not the live one
    expect(() => callback(engine, t, 'getKindSchema', { apiVersion: 'x.io/v1', kind: 'Nope' })).toThrow(/not in the caller's snapshot/)
  })

  it('confines list and getArtifact to the caller Namespace plus Global', () => {
    const t = reconcileToken()
    const other = { ...fresh(example('revisioned-instance')), metadata: { name: 'checkout-v2.r3', namespace: 'ops' } }
    store.resources.put(other)
    const own = store.resources.put(fresh(example('revisioned-instance')))
    expect((callback(engine, t, 'list', { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'ops' }) as Resource[]).map((r) => r.metadata.uid)).toEqual([own.metadata.uid])
    expect(() => callback(engine, t, 'getArtifact', { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'ops', id: 'checkout-v2', revision: 3 })).toThrow(/another Namespace/)
    expect(() => callback(engine, t, 'getBlob', { digest: 'sha256:../../etc/passwd' })).toThrow(/64 hex/)
    expect(store.blobs.get('blob://../x')).toBeUndefined()
  })

  it('refuses unknown tokens and out-of-scope callbacks', () => {
    expect(() => callback(engine, 'nope', 'log', { text: 'x' })).toThrow(/unknown or expired/)
    expect(() => callback(engine, reconcileToken(), 'signal', {})).toThrow(/not allowed for a reconcile token/)
    const adapterToken = store.tokens.issue({ kind: 'adapter', id: 'review-ui/v1' })
    expect(() => callback(engine, adapterToken, 'getResource', {})).toThrow(/not allowed for a adapter token/)
    expect(() => callback(engine, adapterToken, 'signal', { ref: { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: run.metadata.name }, eventId: 'e1' })).toThrow(/without actor/)
  })

  it('signal appends to the target with the asserted Actor', () => {
    const adapterToken = store.tokens.issue({ kind: 'adapter', id: 'review-ui/v1' })
    const args = example('adapter-callbacks').at(-1).args
    args.ref = { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: run.metadata.name }
    callback(engine, adapterToken, 'signal', args)
    expect(signals).toEqual([{ uid: run.metadata.uid, eventId: 'complete-8f1c2d', actor: { kind: 'user', id: 'ryan' } }])
  })

  it('putBlob then publishArtifact with a call token stages under the Publication scope; log lands on the call entry', async () => {
    // an acked reconcile whose result carried the call
    await commit(engine as never, {
      resource: run, event: { type: 'Created', sequence: 1, dedupeKey: 'created' }, actor: { kind: 'handler', id: 'workflow' }, handler: engine.handlers!.get(run.apiVersion, run.kind), causationChain: [],
      result: { statusPatch: { phase: 'Running' }, actions: [{ type: 'callAdapter', adapterId: 'claude-code/v1', op: 'execute', payload: {}, idempotencyKey: 'k/1' }] },
    }).catch(() => undefined) // claude-code/v1 is not registered here; stage the call directly instead
    store.runLog.ack(run.metadata.uid!, 1, { actions: [{ type: 'callAdapter', adapterId: 'x/v1', op: 'execute', payload: {}, idempotencyKey: 'k/1' }] }, '2026-09-21T10:00:00Z')
    const callToken = store.tokens.issue({ kind: 'call', uid: run.metadata.uid, idempotencyKey: 'k/1' })
    const put = callback(engine, callToken, 'putBlob', { bytes: Buffer.from('# Checkout v2').toString('base64'), mediaType: 'text/markdown' }) as { digest: string }
    expect(callback(engine, callToken, 'getBlob', { digest: put.digest })).toEqual({ bytes: Buffer.from('# Checkout v2').toString('base64'), mediaType: 'text/markdown' })
    const req = example('adapter-callbacks').find((c: { callback: string }) => c.callback === 'publishArtifact').args
    req.representations[0].digest = put.digest
    const ref = callback(engine, callToken, 'publishArtifact', req)
    expect(ref).toEqual({ apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'checkout-v2', revision: 1 })
    expect(store.resources.staged(run.metadata.uid!)).toMatchObject([{ scope: 'k/1', state: 'staged' }])
    expect(() => callback(engine, callToken, 'getArtifact', ref as Record<string, unknown>)).toThrow(/revision 1/) // not committed yet
    callback(engine, callToken, 'log', { text: '3 requirements drafted' })
    expect(store.runLog.logs(run.metadata.uid!, 1)).toEqual(['3 requirements drafted'])
  })

  // who produced an artifact (18-artifact.md): the Adapter of a call, the actor of the Signal a reconcile serves, else the Handler
  it('publishArtifact names its producer: the Adapter of a call, a Signal\'s actor, else the Handler', () => {
    const req = () => {
      const r = structuredClone(example('reconcile-actions')[2])
      r.representations[0].digest = store.blobs.put(Buffer.from('r'), 'text/markdown').digest
      return r
    }
    const actorOf = (token: string, key: string) => {
      callback(engine, token, 'publishArtifact', req())
      return (store.resources.commitScope({ uid: run.metadata.uid!, key }).at(-1)!.spec as { provenance: { actor: unknown } }).provenance.actor
    }
    expect(actorOf(store.tokens.issue({ kind: 'call', uid: run.metadata.uid, idempotencyKey: 'k/2', adapterId: 'claude-code/v1' }), 'k/2')).toEqual({ kind: 'service', id: 'claude-code/v1' })
    expect(actorOf(store.tokens.issue({ kind: 'reconcile', uid: run.metadata.uid, sequence: 7, actor: { kind: 'user', id: 'local' } }), reconcileScope(run.metadata.uid!, 7).key)).toEqual({ kind: 'user', id: 'local' })
    expect(actorOf(store.tokens.issue({ kind: 'reconcile', uid: run.metadata.uid, sequence: 8 }), reconcileScope(run.metadata.uid!, 8).key)).toEqual({ kind: 'handler', id: 'workflow' })
  })

  it('publishArtifact with a reconcile token joins that reconcile scope', () => {
    const t = reconcileToken()
    const req = example('reconcile-actions')[2]
    const blob = store.blobs.put(Buffer.from('r'), 'text/markdown')
    req.representations[0].digest = blob.digest
    callback(engine, t, 'publishArtifact', req)
    expect(store.resources.staged(run.metadata.uid!)[0]?.scope).toBe(reconcileScope(run.metadata.uid!, 1).key)
  })

  it('serves over a unix socket', async () => {
    const server = callbackServer(engine)
    const sock = join(tmpdir(), `persimmon-${process.pid}.sock`)
    await listenUnix(server, `unix://${sock}`)
    try {
      const post = (path: string, token: string, body: unknown) =>
        new Promise<{ status: number; body: { result?: unknown; error?: { code: string } } }>((resolve, reject) => {
          const r = request({ socketPath: sock, path, method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } }, (res) => {
            let data = ''
            res.on('data', (c: Buffer) => (data += c.toString()))
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }))
          })
          r.on('error', reject)
          r.end(JSON.stringify(body))
        })
      const ok = await post('/callbacks/getResource', reconcileToken(), { apiVersion: 'persimmon.ai/v1', kind: 'Task', name: 'research' })
      expect(ok.status).toBe(200)
      expect((ok.body.result as Resource).metadata.name).toBe('research')
      expect((await post('/callbacks/getResource', 'bad', {})).status).toBe(401)
      expect((await post('/callbacks/getResource', '', {})).status).toBe(401)
      expect((await post('/callbacks/signal', reconcileToken(), {})).status).toBe(403)
      expect((await post('/nope', reconcileToken(), {})).status).toBe(400)
    } finally {
      await new Promise((r) => server.close(r))
    }
  })
})
