// Commit of one reconcile result (03-reconcile.md, Commit and callAdapter sections).
import type { AdapterRegistry } from '../adapter/registry.js'
import { canonicalBytes, digestOf } from '../snapshot/canonical.js'
import type { Bound } from '../handler/registry.js'
import type { ReconcileResult } from '../handler/types.js'
import { audit, type CreateOptions, type Engine as WriteEngine, prepareCreate, storeCreate, WriteError } from '../handler/write.js'
import { engineActor, makeEvent, reservedPrefixes, type Subject } from '../outbox/event.js'
import type { Actor, ObjectRef, Resource, RevisionRef } from '../resource/types.js'
import type { Store } from '../store/store.js'
import { frozenKindVersion, readClosure } from '../snapshot/snapshot.js'
import { appendEvent } from './events.js'
import { applyStatusPatch, CommitError, terminalValue } from './status.js'
import type { Action, Event, PublishRequest } from './types.js'

export interface Engine extends WriteEngine {
  adapters: AdapterRegistry
  maxCausationDepth: number
  defaultCallDeadlineMs: number
}

export interface Commit {
  resource: Resource
  event: Event
  result: ReconcileResult
  /** Actor of the triggering Event; the Handler's own Actor otherwise. */
  actor: Actor
  handler: Bound
  causationChain: string[]
}

/** Commit steps 1–4 in one Store transaction; returns the Resource as stored. */
export async function commit(engine: Engine, c: Commit): Promise<Resource> {
  const { store, kinds } = engine
  const kd = kinds.get(c.resource.apiVersion, c.resource.kind).definition
  const uid = c.resource.metadata.uid as string
  const time = engine.now().toISOString()
  const handlerActor: Actor = { kind: 'handler', id: c.handler.handler.metadata.name }
  const writer = c.actor
  const producer = { uid, sequence: c.event.sequence }
  const subject = refOf(c.resource)
  let ordinal = 0
  const emit = (type: string, s: Subject, payload: Record<string, unknown>, actor: Actor = writer) =>
    store.outbox.enqueue(makeEvent({ type, time, subject: s, producer, ordinal: ordinal++, actor, causationChain: c.causationChain, payload }))

  const patched = applyStatusPatch(c.resource, c.result.statusPatch, kinds)

  // Validation of created Resources may ask an Adapter Handler, so it runs before the transaction; the store part runs inside.
  const creates: { prepared: Resource; options: CreateOptions }[] = []
  for (const a of c.result.actions) {
    if (a.type !== 'createResource') continue
    creates.push({
      prepared: await prepareCreate(engine, a.resource),
      options: { actor: handlerActor, owner: c.resource, owned: a.owned ?? true, ...(a.snapshot ? { snapshot: a.snapshot } : {}), causationChain: c.causationChain, producer, ordinal: ordinal++ },
    })
  }

  return store.transaction(() => {
    let stored = c.resource
    if (c.result.statusPatch) {
      stored = store.resources.put(patched)
      store.audit.append(audit(stored, handlerActor, time, 'status'))
    }

    for (const { prepared, options } of creates) storeCreate(engine, prepared, options)
    for (const a of c.result.actions) {
      switch (a.type) {
        case 'createResource':
          break // stored above, in this transaction
        case 'cancelResource': {
          const child = store.resources.get({ kind: a.ref.kind, namespace: a.ref.namespace, name: a.ref.name })
          if (!child) throw new CommitError(`cancelResource: ${a.ref.kind} ${a.ref.name} not found`)
          appendEvent(engine, child.metadata.uid as string, { type: 'CancelRequested', dedupeKey: 'cancel', payload: {}, causationChain: c.causationChain })
          break
        }
        case 'publishArtifact':
          stageRevision(engine, a, stored, reconcileScope(uid, c.event.sequence), writer)
          break
        case 'commitScope':
          for (const r of store.resources.commitScope({ uid, key: a.key })) commitRevision(store, r, writer, time, emit)
          break
        case 'abandonScope':
          store.resources.abandonScope({ uid, key: a.key })
          break
        case 'emitEvent':
          if (reservedPrefixes.some((p) => a.eventType.startsWith(p))) throw new CommitError(`emitEvent: ${a.eventType} is reserved`)
          emit(a.eventType, subject, a.payload)
          break
        case 'setTimer':
          store.timers.set(uid, a.key, a.at)
          break
        case 'clearTimer':
          store.timers.clear(uid, a.key)
          break
        case 'callAdapter':
          engine.adapters.require(a.adapterId) // dispatched after commit from the RunLog (outstandingCalls)
          break
      }
    }

    // revisions staged by publishArtifact actions and by callbacks with this reconcile's token
    for (const r of store.resources.commitScope(reconcileScope(uid, c.event.sequence))) commitRevision(store, r, writer, time, emit)

    store.runLog.ack(uid, c.event.sequence, { ...(c.result.statusPatch ? { statusPatch: c.result.statusPatch } : {}), actions: c.result.actions as unknown as Record<string, unknown>[] }, time)

    // Step 4: terminal reached.
    const t = kd.spec.terminal
    if (t && terminalValue(c.resource, t) === undefined) {
      const value = terminalValue(stored, t)
      if (value !== undefined) {
        const owner = stored.metadata.ownerReferences?.[0]
        if (owner?.uid) appendEvent(engine, owner.uid, { type: 'ChildFinished', dedupeKey: `child/${uid}`, payload: { ref: refOf(stored), value }, causationChain: c.causationChain })
        emit('resource.finished', subject, { value })
        for (const s of store.resources.staged(uid)) if (s.state === 'staged') store.resources.abandonScope({ uid, key: s.scope })
      }
    }
    return stored
  })
}

/** Publication scope of one reconcile: what it stages commits with it (05-revisioned-kind.md). */
export const reconcileScope = (uid: string, sequence: number) => ({ uid, key: `reconcile/${sequence}` })

/** Stages a revision from a publish request (05-revisioned-kind.md): engine stamps name, identity, provenance, digests. */
export function stageRevision(engine: Engine, req: PublishRequest, producer: Resource, scope: { uid: string; key: string }, actor: Actor): RevisionRef {
  const { store, kinds } = engine
  const c = kinds.get(req.kind.apiVersion, req.kind.kind)
  if (!c.definition.spec.revisioned) throw new WriteError(`${req.kind.kind} is not revisioned`)
  // the schema the producer's snapshot froze, so a run keeps the contract it started with; live when it has none (05-revisioned-kind.md)
  const frozen = producer.metadata.snapshot && frozenKindVersion(readClosure(producer.metadata.snapshot, store.snapshots), req.kind.apiVersion, req.kind.kind)
  const validate = frozen ? kinds.compile(frozen.schema) : c.spec
  if (!validate(req.content)) throw new WriteError(`${req.kind.kind} content: ${validate.errors?.map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`) // the path, so an agent's answer can be read against it
  for (const r of req.representations) if (!store.blobs.get(`blob://${r.digest.slice(7)}`)) throw new WriteError(`representation ${r.name}: blob ${r.digest} missing`)
  const names = new Set<string>()
  for (const r of req.representations) {
    if (names.has(r.name)) throw new WriteError(`representation ${r.name}: named twice`)
    names.add(r.name)
  }
  const namespace = producer.metadata.namespace
  if (!namespace) throw new WriteError(`${producer.kind} ${producer.metadata.name} is Global; revisioned kinds are Namespaced`)
  const revision = store.resources.reserveRevision(req.kind.kind, namespace, req.id)
  const ref: RevisionRef = { apiVersion: req.kind.apiVersion, kind: req.kind.kind, namespace, id: req.id, revision }
  store.resources.stage(
    {
      apiVersion: req.kind.apiVersion,
      kind: req.kind.kind,
      metadata: { name: `${req.id}.r${revision}`, namespace },
      spec: { identity: { id: req.id, revision }, content: req.content, provenance: { producerRef: refOf(producer), inputs: req.inputs ?? [], actor } },
      status: { contentDigest: digestOf(canonicalBytes(req.content)), representations: req.representations },
    },
    scope,
  )
  return ref
}

function commitRevision(store: Store, r: Resource, actor: Actor, time: string, emit: (type: string, s: Subject, payload: Record<string, unknown>, actor?: Actor) => void): void {
  store.audit.append(audit(r, actor, time, 'create'))
  const id = (r.spec as { identity: { id: string; revision: number } }).identity
  emit('artifact.published', { apiVersion: r.apiVersion, kind: r.kind, namespace: r.metadata.namespace as string, id: id.id, revision: id.revision }, {
    contentDigest: (r.status as { contentDigest: string }).contentDigest,
  })
}

export function refOf(r: Resource): ObjectRef & { uid: string } {
  return { apiVersion: r.apiVersion, kind: r.kind, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}), name: r.metadata.name, uid: r.metadata.uid as string }
}

export { engineActor }
