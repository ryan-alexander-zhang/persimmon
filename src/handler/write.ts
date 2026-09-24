// Write path (00-resource.md): authorization ─▶ envelope ─▶ KindDefinition schema ─▶ Handler validate ─▶ store + audit.
import { isDeepStrictEqual } from 'node:util'
import type { KindRegistry } from '../kind-definition/registry.js'
import { engineActor, makeEvent } from '../outbox/event.js'
import { validateEnvelope } from '../resource/envelope.js'
import type { Actor, AuditRecord, Resource, Snapshot } from '../resource/types.js'
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
  const { store, kinds, handlers } = engine
  const resource = validateEnvelope(input)
  if (resource.status !== undefined) throw new WriteError(`${resource.kind} ${resource.metadata.name}: status is Handler-written`)
  const kd = kinds.get(resource.apiVersion, resource.kind).definition
  if (kd.spec.scope !== 'Global' && !resource.metadata.namespace) resource.metadata.namespace = engine.defaultNamespace
  kinds.validateResource(resource)

  const findings = await handlers.lookup(resource.apiVersion, resource.kind)?.impl?.validate(resource).findings
  const errors = (findings ?? []).filter((f) => f.severity === 'error')
  if (errors.length) throw new WriteError(`${resource.kind} ${resource.metadata.name}: ${errors.map((f) => f.message).join('; ')}`, findings)

  const key = { kind: resource.kind, namespace: resource.metadata.namespace, name: resource.metadata.name }
  const existing = store.resources.get(key)
  if (existing) {
    if (isDeepStrictEqual(existing.spec, resource.spec)) return { resource: existing, created: false }
    throw new WriteError(`${resource.kind} ${resource.metadata.name} exists with a different spec`)
  }

  return store.transaction(() => {
    if (o.owned && o.owner) {
      const ow = o.owner
      resource.metadata.ownerReferences = [
        { apiVersion: ow.apiVersion, kind: ow.kind, ...(ow.metadata.namespace ? { namespace: ow.metadata.namespace } : {}), name: ow.metadata.name, uid: ow.metadata.uid as string },
      ]
    }
    const snapshot = snapshotFor(engine, resource, kd.spec.snapshotOnCreate ?? false, o)
    if (snapshot) resource.metadata.snapshot = snapshot

    const stored = store.resources.put(resource)
    const time = engine.now().toISOString()
    store.audit.append(audit(stored, o.actor, time, 'create'))
    if (kd.spec.handlerRef) store.runLog.append(stored.metadata.uid as string, { type: 'Created', dedupeKey: 'created', ...(o.causationChain ? { causationChain: o.causationChain } : {}) })
    if (!kd.spec.revisioned)
      store.outbox.enqueue(
        makeEvent({
          type: 'resource.created',
          time,
          subject: { apiVersion: stored.apiVersion, kind: stored.kind, ...(stored.metadata.namespace ? { namespace: stored.metadata.namespace } : {}), name: stored.metadata.name, uid: stored.metadata.uid as string },
          ...(o.producer ? { producer: o.producer } : {}),
          ordinal: o.ordinal ?? 0,
          actor: o.actor,
          causationChain: o.causationChain ?? [],
          payload: {},
        }),
      )
    return { resource: stored, created: true }
  })
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
