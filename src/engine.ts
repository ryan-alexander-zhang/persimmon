// Engine bootstrap: config ─▶ Store ─▶ registries ─▶ builtin Handlers ─▶ callbacks server ─▶ dispatcher (ARCHITECTURE.md).
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { callback, type CallbackEngine } from './adapter/callbacks.js'
import { AdapterRegistry, describe as describeAdapter, validateAdapter } from './adapter/registry.js'
import { callbackServer, listenUnix } from './adapter/server.js'
import type { Adapter } from './adapter/types.js'
import { type Config, durationMs } from './config.js'
import { HandlerRegistry } from './handler/registry.js'
import type { HandlerImpl } from './handler/types.js'
import { audit, createResource as createResourceRaw, type CreateOptions } from './handler/write.js'
import { KindRegistry } from './kind-definition/registry.js'
import { coreHandlers, coreKinds, frameworkKinds } from './kinds/core.js'
import type { HandlerDeps } from './kinds/deps.js'
import { executorHandler } from './kinds/executor/handler.js'
import { gateHandler, validatorHandler } from './kinds/gate/handler.js'
import { taskHandler } from './kinds/task/handler.js'
import { triggerHandler } from './kinds/trigger/handler.js'
import { workflowHandler } from './kinds/workflow/handler.js'
import { appendEvent, drain, type Engine as DispatchEngine, recoverCalls } from './reconcile/dispatch.js'
import type { Actor, Resource } from './resource/types.js'
import { readClosure } from './snapshot/snapshot.js'
import { liveResolver } from './snapshot/resolver.js'
import { ConfigCredentialStore } from './store/credentials.js'
import { FileBlobStore } from './store/file-blobs.js'
import { SqliteStore } from './store/sqlite.js'
import type { BlobStore, Store } from './store/store.js'

export const localActor: Actor = { kind: 'user', id: 'local' }

export interface EngineOptions {
  config: Config
  /** Working directory; `.persimmon/` lives under it. */
  cwd?: string
  now?: () => Date
  /** Overrides for tests: in-memory store and blobs. */
  storePath?: string
  blobs?: BlobStore
}

export class Engine {
  readonly store: Store
  readonly kinds = new KindRegistry()
  readonly adapters: AdapterRegistry
  readonly handlers: HandlerRegistry
  readonly credentials: ConfigCredentialStore
  readonly dispatch: DispatchEngine
  readonly endpoint: string
  readonly cwd: string
  #server?: Server
  #started = false

  constructor(o: EngineOptions) {
    const cwd = o.cwd ?? process.cwd()
    this.cwd = cwd
    const now = o.now ?? (() => new Date())
    const sqlite = 'sqlite' in o.config.store ? o.config.store.sqlite : ':memory:'
    this.store = new SqliteStore(o.storePath ?? `${cwd}/${sqlite}`, { blobs: o.blobs ?? new FileBlobStore(`${cwd}/${o.config.blobs}`), now })
    this.credentials = new ConfigCredentialStore(o.config.credentials)
    this.adapters = new AdapterRegistry(this.credentials, cwd)
    this.endpoint = `unix://${cwd}/.persimmon/engine.sock`

    const deps: HandlerDeps = {
      kinds: this.kinds,
      adapters: this.adapters,
      now,
      closure: (s) => readClosure(s, this.store.snapshots),
      callback: (token, name, args) => callback(this.callbackEngine(), token, name, args),
      getResource: (kind, ns, name) => (ns ? this.store.resources.get({ kind, namespace: ns, name }) : undefined) ?? this.store.resources.get({ kind, name }),
      getByUid: (uid) => this.store.resources.getByUid(uid),
      random: Math.random,
    }
    const builtins = new Map<string, HandlerImpl>([
      ['workflow', workflowHandler(deps)],
      ['task', taskHandler(deps)],
      ['executor', executorHandler(deps)],
      ['gate', gateHandler(deps)],
      ['validator', validatorHandler(deps)],
      ['trigger', triggerHandler(deps)],
    ])
    this.handlers = new HandlerRegistry(builtins)
    for (const kd of [...frameworkKinds, ...coreKinds]) this.kinds.register(kd)
    for (const h of coreHandlers) this.handlers.register(h)

    this.dispatch = {
      store: this.store,
      kinds: this.kinds,
      handlers: this.handlers,
      adapters: this.adapters,
      credentials: this.credentials,
      resolver: liveResolver(this.kinds, this.store, this.adapters),
      defaultNamespace: o.config.defaultNamespace,
      now,
      maxCausationDepth: o.config.maxCausationDepth,
      defaultCallDeadlineMs: durationMs(o.config.defaultCallDeadline),
      endpoint: this.endpoint,
      maxReconcileAttempts: o.config.maxReconcileAttempts,
      leaseTtlMs: durationMs(o.config.leaseTtl),
      retryBaseMs: Number(process.env.PERSIMMON_RETRY_BASE_MS ?? 100),
      holder: `${process.pid}-${randomUUID().slice(0, 8)}`,
      onError: (uid, ev, err) => {
        if (process.env.PERSIMMON_DEBUG) process.stderr.write(`reconcile ${uid} ${ev.type}#${ev.sequence}: ${err.stack ?? err.message}\n`)
      },
    }
  }

  callbackEngine(): CallbackEngine {
    return {
      ...this.dispatch,
      signal: (uid, eventId, actor, payload) => this.signal(uid, eventId, actor, payload, 'adapter'),
    }
  }

  /** Loads stored KindDefinitions, Handlers and Adapters; marks open calls unknown (03-reconcile.md). */
  async start(): Promise<void> {
    if (this.#started) return
    this.#started = true
    for (const kd of this.store.resources.list('KindDefinition')) if (!this.kinds.lookup(`${(kd.spec as { group: string }).group}/v1`, (kd.spec as { names: { kind: string } }).names.kind)) this.kinds.register(kd)
    for (const h of this.store.resources.list('Handler')) if (!this.handlers.lookup(`${(h.spec as { kinds: { group: string; kind: string }[] }).kinds[0]!.group}/v1`, (h.spec as { kinds: { kind: string }[] }).kinds[0]!.kind)) this.handlers.register(h)
    for (const a of this.store.resources.list('Adapter')) this.adapters.register(a as unknown as Adapter)
    recoverCalls(this.dispatch)
  }

  /** Serves Engine callbacks on the unix socket; stdio Adapters need it during a drain. */
  async listen(): Promise<void> {
    if (this.#server) return
    this.#server = callbackServer(this.callbackEngine())
    await listenUnix(this.#server, this.endpoint)
  }

  /** API write as the local Actor (00-resource.md write order). Adapters are described on apply. */
  async apply(input: Resource, actor: Actor = localActor): Promise<{ resource: Resource; created: boolean }> {
    if (input.kind === 'KindDefinition') this.kinds.register(input, { replace: true })
    if (input.kind === 'Adapter') {
      const described = await describeAdapter(validateAdapter(input), this.credentials, this.dispatch.now, { cwd: this.cwd })
      const { status: _s, ...bare } = described
      const out = await this.#upsert(bare as unknown as Resource, actor)
      const stored = this.store.resources.put({ ...out.resource, status: described.status as Record<string, unknown> })
      this.adapters.register(stored as unknown as Adapter)
      return { resource: stored, created: out.created }
    }
    const out = await this.#upsert(input, actor)
    if (input.kind === 'Handler') this.handlers.register(out.resource)
    return out
  }

  async #upsert(input: Resource, actor: Actor): Promise<{ resource: Resource; created: boolean }> {
    const existing = this.store.resources.get({ kind: input.kind, namespace: input.metadata.namespace ?? (this.kinds.get(input.apiVersion, input.kind).definition.spec.scope === 'Global' ? undefined : this.dispatch.defaultNamespace), name: input.metadata.name })
    if (!existing) return createResourceRaw(this.dispatch, input, { actor })
    // SpecMutable update: CAS on the stored version, generation bump, SpecUpdated when spec changed
    this.kinds.checkMutability(existing, input)
    this.kinds.validateResource({ ...input, metadata: existing.metadata })
    const next: Resource = { ...existing, spec: input.spec, metadata: { ...existing.metadata, ...(input.metadata.labels ? { labels: input.metadata.labels } : {}), ...(input.metadata.annotations ? { annotations: input.metadata.annotations } : {}) } }
    const stored = this.store.transaction(() => {
      const s = this.store.resources.put(next)
      this.store.audit.append(audit(s, actor, this.dispatch.now().toISOString(), 'spec'))
      if (s.metadata.generation !== existing.metadata.generation && this.kinds.get(s.apiVersion, s.kind).definition.spec.handlerRef)
        appendEvent(this.dispatch, s.metadata.uid as string, { type: 'SpecUpdated', dedupeKey: `spec/${s.metadata.generation}`, payload: { generation: s.metadata.generation as number } })
      return s
    })
    return { resource: stored, created: false }
  }

  create(input: Resource, o: Partial<CreateOptions> = {}): Promise<{ resource: Resource; created: boolean }> {
    return createResourceRaw(this.dispatch, input, { actor: localActor, ...o })
  }

  /** Signal a Resource: API (`persimmon signal`, `complete`) or adapter callback. Audits `change: signal`. */
  signal(uid: string, eventId: string, actor: Actor, payload: Record<string, unknown> | undefined, source: 'api' | 'adapter'): void {
    const r = this.store.resources.getByUid(uid)
    if (!r) throw new Error(`no Resource ${uid}`)
    this.store.transaction(() => {
      appendEvent(this.dispatch, uid, { type: 'Signal', dedupeKey: `signal/${eventId}`, payload: { source, eventId, ...(payload ? { payload } : {}) } }, actor)
      this.store.audit.append(audit(r, actor, this.dispatch.now().toISOString(), 'signal'))
    })
  }

  cancel(uid: string, reason?: string): void {
    appendEvent(this.dispatch, uid, { type: 'CancelRequested', dedupeKey: 'cancel', payload: reason ? { reason } : {} })
  }

  /** Runs until nothing moves (08-store.md: local verbs drain before exit). */
  drain(): Promise<void> {
    return drain(this.dispatch)
  }

  async close(): Promise<void> {
    if (this.#server) await new Promise((r) => this.#server!.close(r))
    this.store.close()
  }
}
