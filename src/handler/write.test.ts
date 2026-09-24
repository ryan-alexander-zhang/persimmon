import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AdapterRegistry } from '../adapter/registry.js'
import type { Adapter } from '../adapter/types.js'
import { KindRegistry } from '../kind-definition/registry.js'
import type { Resource } from '../resource/types.js'
import { liveResolver } from '../snapshot/resolver.js'
import type { Closure } from '../snapshot/walk.js'
import { SqliteStore } from '../store/sqlite.js'
import { memoryBlobs } from '../store/test-util.js'
import { HandlerRegistry } from './registry.js'
import type { HandlerImpl } from './types.js'
import { createResource, type Engine, WriteError } from './write.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const closure = example('snapshot-closure') as Closure
const fresh = ({ status: _s, ...r }: Resource): Resource => ({ ...r, metadata: { name: r.metadata.name, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) } })
const actor = { kind: 'user' as const, id: 'local' }

describe('createResource', () => {
  let store: SqliteStore
  let engine: Engine
  let validated: string[]
  beforeEach(() => {
    store = new SqliteStore(':memory:', { blobs: memoryBlobs() })
    const kinds = new KindRegistry()
    for (const n of ['workflow', 'task', 'prompt', 'workflowrun', 'productrequirement', 'researchreport', 'trigger']) kinds.register(example(`kind-definition-${n}`))
    for (const kd of closure.resources.filter((r) => r.kind === 'KindDefinition' && /^(executors|skills|taskruns)\./.test(r.metadata.name))) kinds.register(kd)
    validated = []
    const workflow: HandlerImpl = {
      validate: (r) => {
        validated.push(r.metadata.name)
        return { findings: r.spec.timeout === '0s' ? [{ severity: 'error', message: 'timeout must be positive', path: '/spec/timeout' }] : [] }
      },
      reconcile: () => ({ actions: [] }),
    }
    const handlers = new HandlerRegistry(new Map([['workflow', workflow]]))
    handlers.register(example('handler-workflow'))
    const adapters = new AdapterRegistry({ resolve: () => undefined })
    const claude = example('adapter-claude-code') as Adapter
    adapters.register(claude)
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) store.resources.put(fresh(r as Resource))
    engine = { store, kinds, handlers, resolver: liveResolver(kinds, store, adapters), defaultNamespace: 'default', now: () => new Date('2026-09-21T09:00:00Z') }
  })
  afterEach(() => store.close())

  const run = () => fresh(example('resource-namespaced'))

  it('stores a root run with a resolved snapshot, audit, Created and resource.created', async () => {
    const { resource, created } = await createResource(engine, run(), { actor })
    expect(created).toBe(true)
    expect(resource.metadata.snapshot?.uri).toMatch(/^snapshot:\/\/[a-f0-9]{64}$/)
    expect(validated).toEqual(['prd-create-001'])
    expect(store.audit.read(resource.metadata.uid!)).toMatchObject([{ change: 'create', actor, generation: 1 }])
    expect(store.runLog.read(resource.metadata.uid!).map((e) => e.event.type)).toEqual(['Created'])
    const [ev] = store.outbox.claim(10, 't', 1000) as unknown as { type: string; subject: { uid: string }; actor: unknown }[]
    expect(ev).toMatchObject({ type: 'resource.created', subject: { uid: resource.metadata.uid }, actor })
  })

  it('is idempotent on an equal spec and refuses a different one', async () => {
    const a = await createResource(engine, run(), { actor })
    const b = await createResource(engine, run(), { actor })
    expect(b.created).toBe(false)
    expect(b.resource.metadata.uid).toBe(a.resource.metadata.uid)
    const other = run()
    ;(other.spec as { timeout: string }).timeout = '1h'
    await expect(createResource(engine, other, { actor })).rejects.toThrow(/different spec/)
  })

  it('rejects status, schema violations and Handler findings before storing', async () => {
    await expect(createResource(engine, { ...run(), status: { phase: 'Running' } }, { actor })).rejects.toThrow(/Handler-written/)
    const bad = run()
    delete (bad.spec as { origin?: unknown }).origin
    await expect(createResource(engine, bad, { actor })).rejects.toThrow(/spec:/)
    const zero = run()
    ;(zero.spec as { timeout: string }).timeout = '0s'
    const err = await createResource(engine, zero, { actor }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WriteError)
    expect((err as WriteError).findings[0]?.path).toBe('/spec/timeout')
    expect(store.resources.list('WorkflowRun')).toEqual([])
  })

  it('children inherit the owner snapshot and get one ownerReference; snapshot new resolves their own', async () => {
    const owner = (await createResource(engine, run(), { actor })).resource
    const child = fresh(example('resource-child'))
    const { resource: c } = await createResource(engine, child, { actor, owner, owned: true, causationChain: ['sha256:1'] })
    expect(c.metadata.snapshot).toEqual(owner.metadata.snapshot)
    expect(c.metadata.ownerReferences).toEqual([{ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: 'prd-create-001', uid: owner.metadata.uid }])
    expect(store.runLog.read(c.metadata.uid!)[0]?.event.causationChain).toEqual(['sha256:1'])
    const ownerless = fresh(example('resource-child'))
    ownerless.metadata.name = 'free'
    const { resource: f } = await createResource(engine, ownerless, { actor, owner, owned: false, snapshot: 'inherit' })
    expect(f.metadata.ownerReferences).toBeUndefined()
    const bare = run()
    delete bare.metadata.snapshot
    const noSnap = { ...owner, metadata: { ...owner.metadata, snapshot: undefined } } as Resource
    await expect(createResource(engine, { ...ownerless, metadata: { ...ownerless.metadata, name: 'g' } }, { actor, owner: noSnap, owned: true })).rejects.toThrow(/no snapshot to inherit/)
  })

  it('scope Any without a Namespace is Global and skips Created for a kind without a Handler', async () => {
    const prompt = fresh(closure.resources.find((r) => r.kind === 'Prompt') as Resource)
    prompt.metadata.name = 'another'
    delete prompt.metadata.namespace
    const { resource } = await createResource(engine, prompt, { actor })
    expect(resource.metadata.namespace).toBeUndefined()
    expect(resource.metadata.snapshot).toBeUndefined()
    expect(store.runLog.read(resource.metadata.uid!)).toEqual([])
  })
})
