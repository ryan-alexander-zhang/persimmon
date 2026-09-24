// Store interface (08-store.md). One implementation per mode; the engine sees only this.
import type { AuditRecord, Resource, RevisionRef } from '../resource/types.js'

export class ConflictError extends Error {}
export class NotFoundError extends Error {}
export class ReferencedError extends Error {}

export interface ResourceKey {
  kind: string
  namespace?: string | undefined
  name: string
}

export interface PublicationScope {
  /** Owner of the scope: the reconciling Resource. */
  uid: string
  /** The callAdapter idempotencyKey, or the reconcile's own key. */
  key: string
}

export interface Staged {
  ref: RevisionRef
  scope: string
  state: 'staged' | 'committed' | 'abandoned'
}

export interface ResourceStore {
  /** Create when `metadata.resourceVersion` is absent; otherwise CAS update. Returns the stored Resource. */
  put(resource: Resource): Resource
  get(key: ResourceKey): Resource | undefined
  getByUid(uid: string): Resource | undefined
  list(kind: string, namespace?: string, labels?: Record<string, string>): Resource[]
  /** Refused while any ownerReference, ObjectRef, snapshot or RevisionRef points at it (00-resource.md). */
  delete(uid: string): void
  /** Next revision for (kind, namespace, id); never reused, gaps allowed (05-revisioned-kind.md). */
  reserveRevision(kind: string, namespace: string, id: string): number
  /** Live revisions of one identity, ascending. */
  listRevisions(kind: string, namespace: string, id: string): Resource[]
  /** Stores a revision invisible to get and list until its scope commits. */
  stage(revision: Resource, scope: PublicationScope): Resource
  /** Makes every revision staged under the scope visible; returns them. */
  commitScope(scope: PublicationScope): Resource[]
  /** Retains the scope's revisions flagged; they never become visible. */
  abandonScope(scope: PublicationScope): void
  /** Every revision staged by this owner, with its state. */
  staged(uid: string): Staged[]
}

export interface AuditLog {
  append(record: AuditRecord): void
  read(uid: string): AuditRecord[]
}

/** Reconcile Event as the RunLog stores it; `src/reconcile/` refines the shapes. */
export interface RunLogEvent {
  type: string
  dedupeKey: string
  payload?: Record<string, unknown>
  causationChain?: string[]
}

export interface RunLogResult {
  statusPatch?: Record<string, unknown>
  actions: Record<string, unknown>[]
}

export interface RunLogEntry {
  event: RunLogEvent & { sequence: number }
  appliedAt?: string
  deliveries?: number
  result?: RunLogResult
}

export interface OutstandingCall {
  uid: string
  sequence: number
  action: Record<string, unknown>
}

export interface RunLog {
  /** Idempotent on (uid, dedupeKey): a repeat returns the existing sequence. */
  append(uid: string, event: RunLogEvent): number
  /** Counts one reconcile call for the entry; returns the count. */
  markDelivery(uid: string, sequence: number): number
  /** Records the committed result; a second ack is a no-op. */
  ack(uid: string, sequence: number, result: RunLogResult, appliedAt: string): void
  read(uid: string, from?: number): RunLogEntry[]
  /** Unacked entries, oldest first per uid. */
  listOpen(): { uid: string; entry: RunLogEntry }[]
  /** Acked callAdapter actions with no AdapterFinished appended for their idempotencyKey. */
  outstandingCalls(): OutstandingCall[]
}

/** Outbox event as stored; `src/outbox/` owns the full shape (06-outbox.md). */
export interface OutboxRecord {
  eventId: string
  type: string
}

export interface Outbox {
  /** Called inside the producing transaction. A repeated eventId is a no-op. */
  enqueue(event: OutboxRecord): void
  /** Hands out unclaimed events, invisible to other holders until `ttlMs` passes. */
  claim(limit: number, holder: string, ttlMs: number): OutboxRecord[]
  ack(eventId: string): void
}

export interface Timer {
  uid: string
  key: string
  at: string
}

export interface TimerStore {
  /** Same (uid, key) replaces. */
  set(uid: string, key: string, at: string): void
  clear(uid: string, key: string): void
  due(now: string): Timer[]
}

export interface LeaseStore {
  /** True when this holder now owns the lease; an expired lease may be taken. */
  acquire(uid: string, holder: string, ttlMs: number): boolean
  renew(uid: string, holder: string, ttlMs: number): boolean
  release(uid: string, holder: string): void
}

export interface Addressed {
  uri: string
  digest: string
}

export interface SnapshotStore {
  /** `snapshot://<digest hex>`; identical bytes share one copy (04-snapshot.md). */
  put(bytes: Uint8Array): Addressed
  get(uri: string): Uint8Array | undefined
}

export interface BlobStore {
  /** `blob://<digest hex>`; idempotent (05-revisioned-kind.md). */
  put(bytes: Uint8Array, mediaType: string): Addressed
  get(uri: string): { bytes: Uint8Array; mediaType: string } | undefined
}

export interface TokenStore {
  /** Returns the bearer token; only its hash is stored. `expiresAt` is RFC 3339. */
  issue(scope: Record<string, unknown>, expiresAt?: string): string
  verify(token: string): Record<string, unknown> | undefined
  /** Revokes every token issued for exactly this scope. */
  revoke(scope: Record<string, unknown>): void
}

export interface CredentialStore {
  /** Global `<name>` or `<namespace>/<name>`; never persisted anywhere (08-store.md). */
  resolve(name: string): string | undefined
}

export interface Store {
  readonly resources: ResourceStore
  readonly snapshots: SnapshotStore
  readonly blobs: BlobStore
  readonly tokens: TokenStore
  readonly audit: AuditLog
  readonly runLog: RunLog
  readonly outbox: Outbox
  readonly timers: TimerStore
  readonly leases: LeaseStore
  /** One transaction; nested calls join the outer one. Throwing rolls back. */
  transaction<T>(fn: () => T): T
  close(): void
}
