// Handler contract (02-handler.md, schemas/handler.yaml).
import type { Action, Event } from '../reconcile/types.js'
import type { Actor, ObjectRef, Resource, RevisionRef, Snapshot } from '../resource/types.js'

export interface HandlerSpec {
  kinds: { group: string; kind: string; versions: string[] }[]
  implementation: { builtin: string } | { adapter: { id: string } }
}

export type Handler = Resource<HandlerSpec>

export interface Finding {
  severity: 'error' | 'warning'
  code?: string
  /** JSON pointer into the Resource. */
  path?: string
  message: string
}

export interface ValidateResult {
  findings: Finding[]
}

export interface Context {
  children: { ref: ObjectRef; terminal: boolean; status?: Record<string, unknown> }[]
  snapshot?: Snapshot
  /** Absent on engine-originated Events. */
  actor?: Actor
  timers: string[]
  staged?: { ref: RevisionRef; scope: string }[]
}

export interface ReconcileInput {
  resource: Resource
  event: Event
  context: Context
  engine: { endpoint: string; token: string }
}

export interface ReconcileResult {
  statusPatch?: Record<string, unknown>
  actions: Action[]
}

/** What a builtin implements. Adapter Handlers speak the same contract over the wire (07-adapter.md). */
export interface HandlerImpl {
  validate(resource: Resource): ValidateResult
  reconcile(input: ReconcileInput): ReconcileResult | Promise<ReconcileResult>
  /** Kinds with `expansion` only: the target-kind Resource of the same name first, then helpers (02-handler.md). Pure. */
  expand?(resource: Resource): { resources: Resource[] }
}
