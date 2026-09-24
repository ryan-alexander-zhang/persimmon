// Envelope and Reference shapes (00-resource.md, schemas/resource.yaml). Kept in step by hand.

export interface Actor {
  kind: 'user' | 'service' | 'handler'
  id: string
  display?: string
}

export interface ObjectRef {
  apiVersion: string
  kind: string
  namespace?: string
  name: string
  uid?: string
}

export interface LocalDefinitionRef {
  kind: string
  name: string
}

export interface RevisionRef {
  apiVersion: string
  kind: string
  namespace: string
  id: string
  revision: number
}

export interface ExternalResourceRef {
  provider: string
  type: string
  id: string
  locator: Record<string, unknown>
  version?: string
  url?: string
}

export interface Snapshot {
  uri: string
  digest: string
}

export interface Metadata {
  name: string
  namespace?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
  uid?: string
  resourceVersion?: string
  generation?: number
  creationTimestamp?: string
  ownerReferences?: ObjectRef[]
  snapshot?: Snapshot
  stalled?: { attempts: number; lastError?: string }
}

export interface Resource<Spec = Record<string, unknown>, Status = Record<string, unknown>> {
  apiVersion: string
  kind: string
  metadata: Metadata
  spec: Spec
  status?: Status
}

export type Change = 'create' | 'spec' | 'status' | 'metadata' | 'delete' | 'signal'

export interface AuditRecord {
  actor: Actor
  time: string
  kind: string
  namespace?: string
  name: string
  uid: string
  generation: number
  change: Change
}
