// Adapter resource and persimmon.adapter/v1 messages (07-adapter.md, schemas/adapter.yaml).
import type { ReconcileError } from '../reconcile/types.js'
import type { Resource } from '../resource/types.js'

export interface AdapterSpec {
  id: string
  roles: string[]
  transport: 'stdio' | 'http'
  command?: string[]
  url?: string
  env?: Record<string, string>
  credentialBindings?: string[]
}

export interface Describe {
  adapterId: string
  protocol: 'persimmon.adapter/v1'
  roles: string[]
  kinds?: { group: string; kind: string; versions: string[] }[]
  [roleField: string]: unknown
}

export interface AdapterStatus {
  describe?: Describe
  describeDigest?: string
  conditions?: { type: 'Ready'; status: 'True' | 'False'; reason?: string; lastTransitionTime?: string }[]
}

export type Adapter = Resource<AdapterSpec, AdapterStatus>

export interface Request {
  protocol: 'persimmon.adapter/v1'
  id: string
  op: string
  payload: Record<string, unknown>
}

export type Response =
  | { id: string; ok: true; result: Record<string, unknown> }
  | { id: string; ok: false; error: ReconcileError }

export type StreamLine = { id: string; event: 'log'; text: string } | { id: string; event: 'waiting'; reason: string }

/** What a call yields to the engine: the AdapterFinished states (03-reconcile.md). */
export type CallOutcome =
  | { state: 'succeeded'; result: Record<string, unknown> }
  | { state: 'failed'; error: ReconcileError }
  | { state: 'unknown'; reason: string }
  /** http `202 {id}`: the response arrives later at `engine.endpoint/responses`. */
  | { state: 'pending' }

export interface CallOptions {
  /** Milliseconds until the call is `unknown`; the stdio process is killed then. */
  timeoutMs?: number
  /** Working directory of a stdio Adapter process: the engine's, so `.persimmon/` resolves (20-pack.md). */
  cwd?: string
  /** Bearer token the Adapter presents at `engine.endpoint`; stdio gets it as `PERSIMMON_ADAPTER_TOKEN`. */
  adapterToken?: string
  onStream?: (line: StreamLine) => void
  /** Environment the caller adds to a stdio process: the conformance suite's flag and cues (22-conformance.md). */
  env?: Record<string, string>
}
