// Store interface (08-store.md). One implementation per mode; the engine sees only this.
import type { AuditRecord, Resource } from '../resource/types.js'

export class ConflictError extends Error {}
export class NotFoundError extends Error {}
export class ReferencedError extends Error {}

export interface ResourceKey {
  kind: string
  namespace?: string | undefined
  name: string
}

export interface ResourceStore {
  /** Create when `metadata.resourceVersion` is absent; otherwise CAS update. Returns the stored Resource. */
  put(resource: Resource): Resource
  get(key: ResourceKey): Resource | undefined
  getByUid(uid: string): Resource | undefined
  list(kind: string, namespace?: string, labels?: Record<string, string>): Resource[]
  /** Refused while any ownerReference, ObjectRef, snapshot or RevisionRef points at it (00-resource.md). */
  delete(uid: string): void
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

export interface Store {
  readonly resources: ResourceStore
  readonly audit: AuditLog
  readonly runLog: RunLog
  /** One transaction; nested calls join the outer one. Throwing rolls back. */
  transaction<T>(fn: () => T): T
  close(): void
}
