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

export interface Store {
  readonly resources: ResourceStore
  readonly audit: AuditLog
  /** One transaction; nested calls join the outer one. Throwing rolls back. */
  transaction<T>(fn: () => T): T
  close(): void
}
