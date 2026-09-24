// Engine callbacks (07-adapter.md): what an Adapter may ask of the engine, gated by its token.
import type { KindRegistry } from '../kind-definition/registry.js'
import type { HandlerRegistry } from '../handler/registry.js'
import { type Engine as CommitEngine, reconcileScope, stageRevision } from '../reconcile/apply.js'
import type { Actor, ObjectRef, Resource, RevisionRef } from '../resource/types.js'
import { readClosure } from '../snapshot/snapshot.js'
import type { PublishRequest } from '../reconcile/types.js'

export class CallbackError extends Error {
  constructor(
    readonly code: 'unauthorized' | 'forbidden' | 'not_found' | 'invalid_input',
    message: string,
  ) {
    super(message)
  }
}

export type TokenScope =
  | { kind: 'reconcile'; uid: string; sequence: number }
  | { kind: 'call'; uid: string; idempotencyKey: string }
  | { kind: 'adapter'; id: string }

export interface CallbackEngine extends Omit<CommitEngine, 'handlers'> {
  handlers?: HandlerRegistry
  /** Appends a Signal to a Resource; the dispatcher's appendEvent. */
  signal(uid: string, eventId: string, actor: Actor, payload: Record<string, unknown> | undefined): void
}

const allowed: Record<TokenScope['kind'], ReadonlySet<string>> = {
  reconcile: new Set(['getResource', 'list', 'getArtifact', 'getBlob', 'putBlob', 'publishArtifact', 'getKindSchema', 'log']),
  call: new Set(['getResource', 'list', 'getArtifact', 'getBlob', 'putBlob', 'publishArtifact', 'getKindSchema', 'log']),
  adapter: new Set(['signal', 'putBlob']),
}

/** Verifies the token, checks the callback against its scope, runs it. */
export function callback(engine: CallbackEngine, token: string, name: string, args: Record<string, unknown>): unknown {
  const scope = engine.store.tokens.verify(token) as TokenScope | undefined
  if (!scope) throw new CallbackError('unauthorized', 'unknown or expired token')
  if (!allowed[scope.kind].has(name)) throw new CallbackError('forbidden', `${name} not allowed for a ${scope.kind} token`)
  const caller = 'uid' in scope ? engine.store.resources.getByUid(scope.uid) : undefined
  const ns = caller?.metadata.namespace
  const { store } = engine
  const inNs = (kind: string, name: string): Resource | undefined =>
    (ns ? store.resources.get({ kind, namespace: ns, name }) : undefined) ?? store.resources.get({ kind, name })

  switch (name) {
    case 'getResource': {
      const ref = args as unknown as ObjectRef
      const r = inNs(ref.kind, ref.name)
      if (!r) throw new CallbackError('not_found', `${ref.kind} ${ref.name}`)
      return r
    }
    case 'list': {
      // confined to the caller's Namespace, then Global (07-adapter.md); a supplied namespace is ignored
      const a = args as { kind: string; labels?: Record<string, string> }
      const own = ns ? store.resources.list(a.kind, ns, a.labels) : []
      return [...own, ...store.resources.list(a.kind, '', a.labels)]
    }
    case 'getArtifact': {
      const ref = args as unknown as RevisionRef
      if (ns && ref.namespace !== ns) throw new CallbackError('forbidden', `${ref.kind} ${ref.id} is in another Namespace`)
      const r = store.resources.get({ kind: ref.kind, namespace: ref.namespace, name: `${ref.id}.r${ref.revision}` })
      if (!r) throw new CallbackError('not_found', `${ref.kind} ${ref.id} revision ${ref.revision}`)
      return r
    }
    case 'getBlob': {
      const digest = String(args.digest)
      if (!/^sha256:[0-9a-f]{64}$/.test(digest)) throw new CallbackError('invalid_input', 'digest must be sha256:<64 hex>')
      const b = store.blobs.get(`blob://${digest.slice(7)}`)
      if (!b) throw new CallbackError('not_found', `blob ${String(args.digest)}`)
      return { bytes: Buffer.from(b.bytes).toString('base64'), mediaType: b.mediaType }
    }
    case 'putBlob':
      return store.blobs.put(Buffer.from(args.bytes as string, 'base64'), args.mediaType as string)
    case 'publishArtifact': {
      if (!caller) throw new CallbackError('forbidden', 'publishArtifact needs a reconcile or call token')
      const owner = engine.handlers?.lookup(caller.apiVersion, caller.kind)?.handler.metadata.name
      const actor: Actor = { kind: 'handler', id: owner ?? 'engine' }
      const publication = scope.kind === 'call' ? { uid: scope.uid, key: scope.idempotencyKey } : reconcileScope((scope as { uid: string }).uid, (scope as { sequence: number }).sequence)
      return stageRevision(engine as CommitEngine, args as unknown as PublishRequest, caller, publication, actor, engine.now().toISOString())
    }
    case 'getKindSchema': {
      const a = args as { apiVersion: string; kind: string }
      return kindSchema(engine.kinds, caller, a.apiVersion, a.kind, engine)
    }
    case 'log': {
      const sequence = scope.kind === 'reconcile' ? scope.sequence : callSequence(engine, scope as { uid: string; idempotencyKey: string })
      store.runLog.log((scope as { uid: string }).uid, sequence, args.text as string)
      return undefined
    }
    case 'signal': {
      const a = args as { ref: ObjectRef; eventId: string; actor?: Actor; payload?: Record<string, unknown> }
      if (!a.actor) throw new CallbackError('invalid_input', 'signal without actor')
      const target = store.resources.get({ kind: a.ref.kind, namespace: a.ref.namespace, name: a.ref.name })
      if (!target) throw new CallbackError('not_found', `${a.ref.kind} ${a.ref.name}`)
      engine.signal(target.metadata.uid as string, a.eventId, a.actor, a.payload)
      return undefined
    }
    default:
      throw new CallbackError('invalid_input', `unknown callback ${name}`)
  }
}

/** From the caller's snapshot when it has one, else the live registration. */
function kindSchema(kinds: KindRegistry, caller: Resource | undefined, apiVersion: string, kind: string, engine: CallbackEngine): { name: string; schema: unknown } {
  const version = apiVersion.split('/')[1] as string
  if (caller?.metadata.snapshot) {
    const closure = readClosure(caller.metadata.snapshot, engine.store.snapshots)
    const kd = closure.resources.find((r) => r.kind === 'KindDefinition' && `${(r.spec as { group: string }).group}/${version}` === apiVersion && (r.spec as { names: { kind: string } }).names.kind === kind)
    if (!kd) throw new CallbackError('not_found', `${apiVersion} ${kind} not in the caller's snapshot`)
    const v = (kd.spec as { versions: { name: string; schema: unknown }[] }).versions.find((v) => v.name === version)
    if (!v) throw new CallbackError('not_found', `${apiVersion} ${kind}: no version ${version}`)
    return { name: v.name, schema: v.schema }
  }
  const c = kinds.lookup(apiVersion, kind)
  if (!c) throw new CallbackError('not_found', `${apiVersion} ${kind} not registered`)
  return { name: c.version.name, schema: c.version.schema }
}

function callSequence(engine: CallbackEngine, scope: { uid: string; idempotencyKey: string }): number {
  const call = engine.store.runLog.outstandingCalls().find((c) => c.uid === scope.uid && c.action.idempotencyKey === scope.idempotencyKey)
  if (!call) throw new CallbackError('forbidden', 'call is no longer open')
  return call.sequence
}
