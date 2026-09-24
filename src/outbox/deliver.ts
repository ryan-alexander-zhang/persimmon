// Outbox poller: claim, match subscriptions, append Signals, ack (06-outbox.md).
import { Site } from '../expression/site.js'
import type { KindRegistry } from '../kind-definition/registry.js'
import type { JsonSchema, KindDefinition } from '../kind-definition/types.js'
import { ajv } from '../resource/ajv.js'
import type { Resource } from '../resource/types.js'
import type { Store } from '../store/store.js'
import { engineActor, isRevisionRef, makeEvent, type OutboxEvent } from './event.js'

const eventSchema = ajv.getSchema('outbox.yaml#/$defs/OutboxEvent')?.schema as JsonSchema
/** The `event` root every subscription filter sees. */
export const filterSite = new Site({ event: eventSchema })

export interface DeliveryOptions {
  maxCausationDepth: number
  leaseTtlMs: number
  holder: string
  now: () => Date
}

/** Every Resource of a subscribing kind in the subject's Namespace, live, not the subject itself. */
export function receiversOf(event: OutboxEvent, kd: KindDefinition, store: Store): Resource[] {
  const ns = event.subject.namespace
  const all = ns === undefined ? store.resources.list(kd.spec.names.kind) : store.resources.list(kd.spec.names.kind, ns)
  return all.filter((r) => !atTerminal(r, kd) && !isSelf(r, event))
}

function atTerminal(r: Resource, kd: KindDefinition): boolean {
  const t = kd.spec.terminal
  if (!t) return false
  const value = t.path.split('.').slice(1).reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], r.status)
  return typeof value === 'string' && t.values.includes(value)
}

function isSelf(r: Resource, event: OutboxEvent): boolean {
  const s = event.subject
  if (isRevisionRef(s)) return false
  return s.uid ? s.uid === r.metadata.uid : s.kind === r.kind && s.name === r.metadata.name && s.namespace === r.metadata.namespace
}

export function matches(event: OutboxEvent, sub: { eventType: string; filter?: string }): boolean {
  if (event.type !== sub.eventType) return false
  return sub.filter === undefined || filterSite.evaluate(sub.filter, { event }) === true
}

/** The subject as stored, for the Signal payload; a missing subject delivers the ref alone. */
function subjectOf(event: OutboxEvent, store: Store): unknown {
  const s = event.subject
  const key = isRevisionRef(s)
    ? { kind: s.kind, namespace: s.namespace, name: `${s.id}.r${s.revision}` }
    : { kind: s.kind, namespace: s.namespace, name: s.name }
  return store.resources.get(key) ?? s
}

/** One poll: returns how many events were processed. */
export function deliverOnce(store: Store, kinds: KindRegistry, limit: number, o: DeliveryOptions): number {
  const claimed = store.outbox.claim(limit, o.holder, o.leaseTtlMs) as unknown as OutboxEvent[]
  for (const event of claimed) {
    store.transaction(() => {
      if (event.causationChain.length > o.maxCausationDepth) {
        if (event.type !== 'event.suppressed') suppress(event, store, o)
      } else {
        deliver(event, store, kinds)
      }
      store.outbox.ack(event.eventId)
    })
  }
  return claimed.length
}

function deliver(event: OutboxEvent, store: Store, kinds: KindRegistry): void {
  let subject: unknown
  for (const kd of kinds.definitions()) {
    const subs = (kd.spec.subscriptions ?? []).filter((s) => matches(event, s))
    if (subs.length === 0) continue
    subject ??= subjectOf(event, store)
    for (const r of receiversOf(event, kd, store)) {
      store.runLog.append(r.metadata.uid as string, {
        type: 'Signal',
        dedupeKey: `signal/${event.eventId}`,
        payload: { source: 'outbox', eventId: event.eventId, payload: { event, subject } },
        causationChain: [...event.causationChain, event.eventId],
      })
    }
  }
}

function suppress(event: OutboxEvent, store: Store, o: DeliveryOptions): void {
  store.outbox.enqueue(
    makeEvent({
      type: 'event.suppressed',
      time: o.now().toISOString(),
      subject: event.subject,
      ordinal: 0,
      actor: engineActor,
      causationChain: [],
      payload: { suppressedEventId: event.eventId, suppressedType: event.type, causationChain: event.causationChain },
    }),
  )
}
