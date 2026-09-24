// Outbox event construction (06-outbox.md).
import type { Actor, ObjectRef, RevisionRef } from '../resource/types.js'
import { canonicalBytes, digestOf } from '../snapshot/canonical.js'

export type Subject = ObjectRef | RevisionRef

export interface OutboxEvent {
  eventId: string
  type: string
  time: string
  subject: Subject
  producer?: { uid: string; sequence: number }
  ordinal: number
  actor: Actor
  causationChain: string[]
  payload: Record<string, unknown>
}

export const engineActor: Actor = { kind: 'service', id: 'engine' }

/** Types the framework emits; `emitEvent` may not use these prefixes. */
export const reservedPrefixes = ['resource.', 'artifact.', 'event.']

export interface NewEvent {
  type: string
  time: string
  subject: Subject
  producer?: { uid: string; sequence: number }
  ordinal: number
  actor?: Actor
  causationChain?: string[]
  payload: Record<string, unknown>
}

/** `eventId` is sha256 over the canonical encoding of `{type, subject, time, producer?, ordinal}`. */
export function makeEvent(e: NewEvent): OutboxEvent {
  const idBody: Record<string, unknown> = { type: e.type, subject: e.subject, time: e.time, ordinal: e.ordinal }
  if (e.producer) idBody.producer = e.producer
  const event: OutboxEvent = {
    eventId: digestOf(canonicalBytes(idBody)),
    type: e.type,
    time: e.time,
    subject: e.subject,
    ordinal: e.ordinal,
    actor: e.actor ?? engineActor,
    causationChain: e.causationChain ?? [],
    payload: e.payload,
  }
  if (e.producer) event.producer = e.producer
  return event
}

export const isRevisionRef = (s: Subject): s is RevisionRef => 'revision' in s
