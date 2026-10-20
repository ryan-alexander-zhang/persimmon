// Engine bootstrap: config ─▶ Store ─▶ registries ─▶ builtin Handlers ─▶ callbacks server ─▶ dispatcher (ARCHITECTURE.md).
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { Server } from 'node:http'
import { callback, type CallbackEngine } from './adapter/callbacks.js'
import { AdapterRegistry, describe as describeAdapter, validateAdapter } from './adapter/registry.js'
import { callbackServer, listenUnix } from './adapter/server.js'
import type { Adapter } from './adapter/types.js'
import { type Config, durationMs } from './config.js'
import { HandlerRegistry } from './handler/registry.js'
import type { HandlerImpl } from './handler/types.js'
import { audit, createResource as createResourceRaw, type CreateOptions, prepareCreate } from './handler/write.js'
import { KindRegistry } from './kind-definition/registry.js'
import { coreHandlers, coreKinds, frameworkKinds } from './kinds/core.js'
import type { HandlerDeps } from './kinds/deps.js'
import { executorHandler } from './kinds/executor/handler.js'
import { gateHandler, validatorHandler } from './kinds/gate/handler.js'
import { taskHandler } from './kinds/task/handler.js'
import { triggerHandler } from './kinds/trigger/handler.js'
import { workflowHandler } from './kinds/workflow/handler.js'
import { compositionHandler } from './kinds/composition/handler.js'
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
    // relative to the project directory; an absolute or `~/` path may be shared by several (08-store.md)
    const at = (p: string) => resolve(cwd, p.startsWith('~/') ? join(homedir(), p.slice(2)) : p)
    const storePath = o.storePath ?? at(sqlite)
    if (storePath !== ':memory:') mkdirSync(dirname(storePath), { recursive: true })
    this.store = new SqliteStore(storePath, { blobs: o.blobs ?? new FileBlobStore(at(o.config.blobs)), now })
    this.credentials = new ConfigCredentialStore(o.config.credentials)
    this.adapters = new AdapterRegistry(this.credentials, cwd)
    // sun_path is 104 bytes on macOS; a deep cwd gets a short socket in the temp dir keyed by cwd
    const sock = `${cwd}/.persimmon/engine.sock`
    this.endpoint = `unix://${sock.length < 100 ? sock : `${tmpdir()}/persimmon-${createHash('sha256').update(cwd).digest('hex').slice(0, 12)}.sock`}`

    const deps: HandlerDeps = {
      kinds: this.kinds,
      adapters: this.adapters,
      now,
      closure: (s) => readClosure(s, this.store.snapshots),
      callback: (token, name, args) => callback(this.callbackEngine(), token, name, args),
      getResource: (kind, ns, name) => (ns ? this.store.resources.get({ kind, namespace: ns, name }) : undefined) ?? this.store.resources.get({ kind, name }),
      getByUid: (uid) => this.store.resources.getByUid(uid),
      random: Math.random,
      expand: (r, ns) => this.handlers.get(r.apiVersion, r.kind).impl?.expand?.(r, ns).resources ?? [],
      latestRevision: (kind, ns, id) => {
        const last = this.store.resources.listRevisions(kind.kind, ns, id).filter((r) => r.apiVersion === kind.apiVersion).at(-1) // ascending; committed only
        return last ? { apiVersion: kind.apiVersion, kind: kind.kind, namespace: ns, id, revision: (last.spec as { identity: { revision: number } }).identity.revision } : undefined
      },
      latestRevisions: (kind, ns) => {
        const latest = new Map<string, { revision: number; content: unknown }>()
        for (const r of this.store.resources.list(kind.kind, ns)) {
          const spec = r.spec as { identity?: { id: string; revision: number }; content?: unknown }
          if (r.apiVersion !== kind.apiVersion || !spec.identity || (latest.get(spec.identity.id)?.revision ?? 0) >= spec.identity.revision) continue
          latest.set(spec.identity.id, { revision: spec.identity.revision, content: spec.content })
        }
        return [...latest.keys()].sort().map((id) => ({ ref: { apiVersion: kind.apiVersion, kind: kind.kind, namespace: ns, id, revision: latest.get(id)!.revision }, content: latest.get(id)!.content }))
      },
    }
    const builtins = new Map<string, HandlerImpl>([
      ['workflow', workflowHandler(deps)],
      ['task', taskHandler(deps)],
      ['executor', executorHandler(deps)],
      ['gate', gateHandler(deps)],
      ['validator', validatorHandler(deps)],
      ['trigger', triggerHandler(deps)],
      ['composition', compositionHandler(deps)],
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
      cwd,
      resolver: liveResolver(this.kinds, this.store, this.adapters, this.handlers),
      defaultNamespace: o.config.defaultNamespace,
      now,
      maxCausationDepth: o.config.maxCausationDepth,
      defaultCallDeadlineMs: durationMs(o.config.defaultCallDeadline),
      endpoint: this.endpoint,
      maxReconcileAttempts: o.config.maxReconcileAttempts,
      leaseTtlMs: durationMs(o.config.leaseTtl),
      retryBaseMs: Number(process.env.PERSIMMON_RETRY_BASE_MS ?? 100),
      inFlight: new Set(),
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
  /** Loads stored definitions; `recover: false` for a read-only process that must not mark another engine's open calls unknown. */
  async start(o: { recover?: boolean } = {}): Promise<void> {
    if (this.#started) return
    this.#started = true
    for (const kd of this.store.resources.list('KindDefinition')) if (!this.kinds.lookup(`${(kd.spec as { group: string }).group}/v1`, (kd.spec as { names: { kind: string } }).names.kind)) this.kinds.register(kd)
    for (const h of this.store.resources.list('Handler')) if (!this.handlers.lookup(`${(h.spec as { kinds: { group: string; kind: string }[] }).kinds[0]!.group}/v1`, (h.spec as { kinds: { kind: string }[] }).kinds[0]!.kind)) this.handlers.register(h)
    for (const a of this.store.resources.list('Adapter')) {
      const adapter = a as unknown as Adapter
      this.adapters.register(adapter)
      // adapter tokens are stored hashed, so a fresh process reissues them (07-adapter.md: expires on re-apply)
      this.store.tokens.revoke({ kind: 'adapter', id: adapter.spec.id })
      this.adapters.setToken(adapter.spec.id, this.store.tokens.issue({ kind: 'adapter', id: adapter.spec.id }))
    }
    if (o.recover !== false) recoverCalls(this.dispatch)
  }

  /** Serves Engine callbacks on the unix socket; stdio Adapters need it during a drain. One listening engine per project: a second would take the socket and re-dispatch open calls. */
  async listen(): Promise<void> {
    if (this.#server) return
    this.#lock()
    this.#server = callbackServer(this.callbackEngine())
    await listenUnix(this.#server, this.endpoint)
  }

  #lockFile?: string
  #lock(): void {
    const file = `${this.cwd}/.persimmon/engine.lock`
    if (existsSync(file)) {
      const pid = Number(readFileSync(file, 'utf8'))
      let alive = Number.isInteger(pid) && pid > 0
      if (alive)
        try {
          process.kill(pid, 0)
        } catch {
          alive = false // stale lock from a killed process
        }
      if (alive) throw new Error(`another persimmon process (pid ${pid}) is running in this project; wait for it or stop it`)
    }
    mkdirSync(`${this.cwd}/.persimmon`, { recursive: true })
    writeFileSync(file, String(process.pid))
    this.#lockFile = file
  }

  /** API write as the local Actor (00-resource.md write order). Adapters are described on apply. */
  async apply(input: Resource, actor: Actor = localActor): Promise<{ resource: Resource; created: boolean; changed: boolean }> {
    if (input.kind === 'KindDefinition') {
      // a revisioned kind's schema may change when every committed revision still validates (01-kind-definition.md)
      const committed = (kind: string) => this.store.resources.list(kind)
      const stagedKd = this.kinds.register(input, { replace: true, dryRun: true, committed }) // validates without touching the registry
      const out = await this.#upsert(stagedKd as unknown as Resource, actor)
      this.kinds.register(out.resource, { replace: true, committed: () => [] }) // the dry run checked the revisions; nothing commits between
      return out
    }
    if (input.kind === 'Adapter') {
      const spec = validateAdapter(input)
      // adapter token: issued at apply, revoked on re-apply (07-adapter.md Token table)
      this.store.tokens.revoke({ kind: 'adapter', id: spec.spec.id })
      const adapterToken = this.store.tokens.issue({ kind: 'adapter', id: spec.spec.id })
      this.adapters.setToken(spec.spec.id, adapterToken)
      const described = await describeAdapter(spec, this.credentials, this.dispatch.now, { cwd: this.cwd, adapterToken })
      const { status: _s, ...bare } = described
      const out = await this.#upsert(bare as unknown as Resource, actor)
      const stored = this.store.resources.put({ ...out.resource, status: described.status as Record<string, unknown> })
      this.adapters.register(stored as unknown as Adapter)
      return { resource: stored, created: out.created, changed: true } // re-described every time
    }
    const out = await this.#upsert(input, actor)
    if (input.kind === 'Handler') this.handlers.register(out.resource, { replace: true })
    return out
  }

  async #upsert(input: Resource, actor: Actor): Promise<{ resource: Resource; created: boolean; changed: boolean }> {
    // the lookup mirrors placement (write.ts): a doc without a Namespace is Global unless its kind is Namespaced
    const scope = this.kinds.get(input.apiVersion, input.kind).definition.spec.scope
    const existing = this.store.resources.get({ kind: input.kind, namespace: input.metadata.namespace ?? (scope === 'Namespaced' ? this.dispatch.defaultNamespace : undefined), name: input.metadata.name })
    if (!existing) {
      const r = await createResourceRaw(this.dispatch, input, { actor, directory: this.cwd })
      return { ...r, changed: r.created }
    }
    // SpecMutable update: CAS on the stored version, generation bump, SpecUpdated when spec changed
    this.kinds.checkMutability(existing, input)
    // envelope, schema defaults and the Handler's validate, as on create: an upgrade never stores a definition create would refuse
    const prepared = await prepareCreate(this.dispatch, { ...input, metadata: { ...input.metadata, namespace: existing.metadata.namespace } })
    const same = (k: 'labels' | 'annotations') => !input.metadata[k] || isDeepStrictEqual(input.metadata[k], existing.metadata[k])
    if (isDeepStrictEqual(existing.spec, prepared.spec) && same('labels') && same('annotations')) return { resource: existing, created: false, changed: false } // nothing to write, no version bump
    const next: Resource = { ...existing, spec: prepared.spec, metadata: { ...existing.metadata, ...(input.metadata.labels ? { labels: input.metadata.labels } : {}), ...(input.metadata.annotations ? { annotations: input.metadata.annotations } : {}) } }
    const stored = this.store.transaction(() => {
      const s = this.store.resources.put(next)
      this.store.audit.append(audit(s, actor, this.dispatch.now().toISOString(), 'spec'))
      if (s.metadata.generation !== existing.metadata.generation && this.kinds.get(s.apiVersion, s.kind).definition.spec.handlerRef)
        appendEvent(this.dispatch, s.metadata.uid as string, { type: 'SpecUpdated', dedupeKey: `spec/${s.metadata.generation}`, payload: { generation: s.metadata.generation as number } })
      return s
    })
    return { resource: stored, created: false, changed: true }
  }

  create(input: Resource, o: Partial<CreateOptions> = {}): Promise<{ resource: Resource; created: boolean }> {
    return createResourceRaw(this.dispatch, input, { actor: localActor, directory: this.cwd, ...o })
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
    if (this.#lockFile) rmSync(this.#lockFile, { force: true })
    this.store.close()
  }
}
