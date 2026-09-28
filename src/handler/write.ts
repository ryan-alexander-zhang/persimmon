// Write path (00-resource.md): authorization ─▶ envelope ─▶ KindDefinition schema ─▶ Handler validate ─▶ store + audit.
import { isDeepStrictEqual } from 'node:util'
import type { KindRegistry } from '../kind-definition/registry.js'
import { engineActor, makeEvent } from '../outbox/event.js'
import { validateEnvelope } from '../resource/envelope.js'
import type { Actor, AuditRecord, Resource, Snapshot } from '../resource/types.js'
import { canonicalBytes, digestOf } from '../snapshot/canonical.js'
import { storeClosure } from '../snapshot/snapshot.js'
import { type Resolver, resolveClosure } from '../snapshot/walk.js'
import type { Store } from '../store/store.js'
import type { HandlerRegistry } from './registry.js'
import type { Finding } from './types.js'

export class WriteError extends Error {
  constructor(
    message: string,
    readonly findings: Finding[] = [],
  ) {
    super(message)
  }
}

export interface Engine {
  store: Store
  kinds: KindRegistry
  handlers: HandlerRegistry
  /** Needed for Adapter-implemented Handlers' validate; absent in the checker. */
  adapters?: { call(id: string, op: string, payload: Record<string, unknown>): Promise<{ state: string; result?: Record<string, unknown> }> }
  resolver: Resolver
  defaultNamespace: string
  now: () => Date
}

export interface CreateOptions {
  actor: Actor
  /** The creating Resource; `owned` adds the ownerReference (03-reconcile.md createResource). */
  owner?: Resource
  owned?: boolean
  /** `inherit` copies the owner's snapshot; `new` resolves a closure; absent follows `snapshotOnCreate`. */
  snapshot?: 'inherit' | 'new'
  causationChain?: string[]
  /** RunLog producer for the resource.created event; absent for API writes. */
  producer?: { uid: string; sequence: number }
  ordinal?: number
}

/** Stores a new Resource, or returns the existing one when its spec is equal (idempotent createResource). */
export async function createResource(engine: Engine, input: unknown, o: CreateOptions): Promise<{ resource: Resource; created: boolean }> {
  const prepared = await prepareCreate(engine, input)
  return engine.store.transaction(() => storeCreate(engine, prepared, o))
}

/** Stages before the store: envelope, kind schema, Handler validate. Async because an Adapter Handler answers over the wire. */
export async function prepareCreate(engine: Engine, input: unknown): Promise<Resource> {
  const { kinds, handlers, adapters } = engine
  const resource = validateEnvelope(input)
  if (resource.status !== undefined) throw new WriteError(`${resource.kind} ${resource.metadata.name}: status is Handler-written`)
  const kd = kinds.get(resource.apiVersion, resource.kind).definition
  // scope Any without a Namespace is Global (00-resource.md); the CLI fills defaultNamespace for its own docs (08-store.md)
  if (kd.spec.scope === 'Namespaced' && !resource.metadata.namespace) resource.metadata.namespace = engine.defaultNamespace
  kinds.validateResource(resource)

  const bound = handlers.lookup(resource.apiVersion, resource.kind)
  let findings: Finding[] = []
  if (bound?.impl) findings = bound.impl.validate(resource).findings
  else if (bound && adapters && 'adapter' in bound.handler.spec.implementation) {
    const out = await adapters.call(bound.handler.spec.implementation.adapter.id, 'validate', { resource })
    if (out.state !== 'succeeded') throw new WriteError(`${resource.kind} ${resource.metadata.name}: Handler validate ${out.state}`)
    findings = (out.result as { findings?: Finding[] }).findings ?? []
  }
  const errors = findings.filter((f) => f.severity === 'error')
  if (errors.length) throw new WriteError(`${resource.kind} ${resource.metadata.name}: ${errors.map((f) => f.message).join('; ')}`, findings)
  return resource
}

/** The store part; runs inside the caller's transaction. */
export function storeCreate(engine: Engine, prepared: Resource, o: CreateOptions): { resource: Resource; created: boolean } {
  const { store, kinds } = engine
  const resource = structuredClone(prepared)
  const kd = kinds.get(resource.apiVersion, resource.kind).definition
  const key = { kind: resource.kind, namespace: resource.metadata.namespace, name: resource.metadata.name }
  const existing = store.resources.get(key)
  if (existing) {
    const content = (r: Resource) => (r.spec as { content?: unknown }).content
    if (kd.spec.revisioned ? isDeepStrictEqual(content(existing), content(resource)) : isDeepStrictEqual(existing.spec, resource.spec)) return { resource: existing, created: false } // a revision is its content; provenance is stamped
    throw new WriteError(`${resource.kind} ${resource.metadata.name} exists with a different spec`)
  }

  {
    if (o.owned && o.owner) {
      const ow = o.owner
      resource.metadata.ownerReferences = [
        { apiVersion: ow.apiVersion, kind: ow.kind, ...(ow.metadata.namespace ? { namespace: ow.metadata.namespace } : {}), name: ow.metadata.name, uid: ow.metadata.uid as string },
      ]
    }
    const snapshot = snapshotFor(engine, resource, kd.spec.snapshotOnCreate ?? false, o)
    if (snapshot) resource.metadata.snapshot = snapshot
    const identity = kd.spec.revisioned ? stampRevision(engine, resource, o.actor) : undefined

    const stored = store.resources.put(resource)
    const time = engine.now().toISOString()
    store.audit.append(audit(stored, o.actor, time, 'create'))
    if (kd.spec.handlerRef) store.runLog.append(stored.metadata.uid as string, { type: 'Created', dedupeKey: 'created', ...(o.causationChain ? { causationChain: o.causationChain } : {}) })
    const common = { time, ...(o.producer ? { producer: o.producer } : {}), ordinal: o.ordinal ?? 0, actor: o.actor, causationChain: o.causationChain ?? [] }
    store.outbox.enqueue(
      identity
        ? makeEvent({ ...common, type: 'artifact.published', subject: { apiVersion: stored.apiVersion, kind: stored.kind, namespace: stored.metadata.namespace as string, id: identity.id, revision: identity.revision }, payload: { contentDigest: (stored.status as { contentDigest: string }).contentDigest } })
        : makeEvent({ ...common, type: 'resource.created', subject: { apiVersion: stored.apiVersion, kind: stored.kind, ...(stored.metadata.namespace ? { namespace: stored.metadata.namespace } : {}), name: stored.metadata.name, uid: stored.metadata.uid as string }, payload: {} }),
    )
    return { resource: stored, created: true }
  }
}

/** A revision written by hand (`persimmon create spec.yaml`) gets what a publish gets: the next revision number checked, provenance with the writer as actor, the content digest (05-revisioned-kind.md). */
function stampRevision(engine: Engine, resource: Resource, actor: Actor): { id: string; revision: number } {
  const spec = resource.spec as { identity?: { id: string; revision: number }; content: unknown; provenance?: unknown }
  const identity = spec.identity
  if (!identity) throw new WriteError(`${resource.kind} ${resource.metadata.name}: spec.identity required`)
  if (resource.metadata.name !== `${identity.id}.r${identity.revision}`) throw new WriteError(`${resource.kind} ${resource.metadata.name}: name must be ${identity.id}.r${identity.revision}`)
  const next = engine.store.resources.reserveRevision(resource.kind, resource.metadata.namespace as string, identity.id) // rolled back with the transaction on error
  if (next !== identity.revision) throw new WriteError(`${resource.kind} ${identity.id}: revision ${identity.revision} is not the next one (${next})`)
  spec.provenance ??= { producerRef: { apiVersion: resource.apiVersion, kind: resource.kind, namespace: resource.metadata.namespace, name: resource.metadata.name }, inputs: [], actor } // self-authored: the revision is its own producer
  resource.status = { contentDigest: digestOf(canonicalBytes(spec.content)), representations: [] }
  return identity
}

function snapshotFor(engine: Engine, resource: Resource, snapshotOnCreate: boolean, o: CreateOptions): Snapshot | undefined {
  const mode = o.snapshot ?? (o.owner ? 'inherit' : snapshotOnCreate ? 'new' : undefined)
  if (mode === 'inherit') {
    if (!o.owner) throw new WriteError(`${resource.kind} ${resource.metadata.name}: snapshot inherit without an owner`)
    if (!o.owner.metadata.snapshot) throw new WriteError(`${o.owner.kind} ${o.owner.metadata.name} has no snapshot to inherit`)
    return o.owner.metadata.snapshot
  }
  if (mode === 'new') return storeClosure(resolveClosure(resource, engine.resolver), engine.store.snapshots)
  return undefined
}

export function audit(r: Resource, actor: Actor, time: string, change: AuditRecord['change']): AuditRecord {
  return {
    actor,
    time,
    kind: r.kind,
    ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}),
    name: r.metadata.name,
    uid: r.metadata.uid as string,
    generation: r.metadata.generation ?? 1,
    change,
  }
}

export { engineActor }
