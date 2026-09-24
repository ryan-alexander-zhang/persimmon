// Events, Actions and errors of the reconcile loop (03-reconcile.md, schemas/reconcile.yaml).
import type { ObjectRef, Resource, RevisionRef } from '../resource/types.js'

export interface ReconcileError {
  code: string
  message: string
  retryable: boolean
}

export type AdapterFinishedPayload =
  | { idempotencyKey: string; state: 'succeeded'; result: Record<string, unknown> }
  | { idempotencyKey: string; state: 'failed'; error: ReconcileError }
  | { idempotencyKey: string; state: 'unknown' }

interface EventBase {
  sequence: number
  dedupeKey: string
  causationChain?: string[]
}

export type Event = EventBase &
  (
    | { type: 'Created' }
    | { type: 'SpecUpdated'; payload: { generation: number } }
    | { type: 'ChildFinished'; payload: { ref: ObjectRef & { uid: string }; value: string } }
    | { type: 'TimerFired'; payload: { key: string; at: string } }
    | { type: 'Signal'; payload: { source: 'adapter' | 'api' | 'outbox'; eventId: string; payload?: Record<string, unknown> } }
    | { type: 'CancelRequested'; payload?: { reason?: string } }
    | { type: 'AdapterFinished'; payload: AdapterFinishedPayload }
  )

export type EventType = Event['type']

/** An Event before the RunLog assigns its sequence. */
export type NewEvent = { [K in EventType]: Omit<Extract<Event, { type: K }>, 'sequence'> }[EventType]

export interface Representation {
  name: string
  mediaType: string
  digest: string
}

export interface PublishRequest {
  kind: { apiVersion: string; kind: string }
  id: string
  content: Record<string, unknown>
  inputs?: RevisionRef[]
  representations: Representation[]
}

export type Action =
  | { type: 'createResource'; resource: Resource; snapshot?: 'inherit' | 'new'; owned?: boolean }
  | { type: 'cancelResource'; ref: ObjectRef }
  | ({ type: 'publishArtifact' } & PublishRequest)
  | { type: 'commitScope'; key: string }
  | { type: 'abandonScope'; key: string }
  | { type: 'emitEvent'; eventType: string; payload: Record<string, unknown> }
  | { type: 'setTimer'; key: string; at: string }
  | { type: 'clearTimer'; key: string }
  | { type: 'callAdapter'; adapterId: string; op: string; payload: Record<string, unknown>; idempotencyKey: string; deadline?: string }

export type ActionType = Action['type']
