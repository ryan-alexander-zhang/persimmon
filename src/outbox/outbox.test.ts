import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KindRegistry } from '../kind-definition/registry.js'
import { validator } from '../resource/ajv.js'
import type { Resource } from '../resource/types.js'
import { SqliteStore } from '../store/sqlite.js'
import { memoryBlobs } from '../store/test-util.js'
import { deliverOnce, matches, receiversOf } from './deliver.js'
import { makeEvent, type OutboxEvent } from './event.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const delivery = example('outbox-delivery')
const fresh = (r: Resource): Resource => {
  const c = structuredClone(r)
  delete c.metadata.uid
  delete c.metadata.resourceVersion
  delete c.metadata.generation
  delete c.metadata.creationTimestamp
  return c
}

describe('makeEvent', () => {
  it('derives eventId from type, subject, time, producer and ordinal', () => {
    const { eventId: _id, ...body } = delivery.event as OutboxEvent
    const e = makeEvent(body)
    expect(e.eventId).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(makeEvent(body).eventId).toBe(e.eventId)
    expect(makeEvent({ ...body, ordinal: 1 }).eventId).not.toBe(e.eventId)
    expect(validator('outbox.yaml', '/$defs/OutboxEvent')(e)).toBe(true)
  })
})

describe('delivery', () => {
  let store: SqliteStore
  let kinds: KindRegistry
  const opts = { maxCausationDepth: 32, leaseTtlMs: 1000, holder: 'test', now: () => new Date('2026-09-21T10:30:00Z') }
  beforeEach(() => {
    store = new SqliteStore(':memory:', { blobs: memoryBlobs() })
    kinds = new KindRegistry()
    for (const n of ['trigger', 'workflowrun', 'productrequirement']) kinds.register(example(`kind-definition-${n}`))
    store.resources.put(fresh(example('trigger-on-prd-published')))
    const other = fresh(example('trigger-on-prd-published'))
    other.metadata.namespace = 'ops'
    store.resources.put(other)
    store.resources.put(fresh(example('revisioned-instance')))
  })
  afterEach(() => store.close())

  it('matches on type and CEL filter over the event', () => {
    const e = delivery.event as OutboxEvent
    expect(matches(e, { eventType: 'artifact.published' })).toBe(true)
    expect(matches(e, { eventType: 'resource.finished' })).toBe(false)
    expect(matches(e, { eventType: 'artifact.published', filter: 'event.subject.kind == "ProductRequirement"' })).toBe(true)
    expect(matches(e, { eventType: 'artifact.published', filter: 'event.subject.kind == "WorkflowRun"' })).toBe(false)
  })

  it('reproduces the design delivery example', () => {
    store.outbox.enqueue(delivery.event)
    expect(deliverOnce(store, kinds, 10, opts)).toBe(1)
    const trigger = store.resources.get({ kind: 'Trigger', namespace: 'demo', name: 'on-prd-published' })!
    const log = store.runLog.read(trigger.metadata.uid!)
    expect(log).toHaveLength(1)
    const signal = log[0]!.event
    expect(signal.type).toBe('Signal')
    expect(signal.dedupeKey).toBe(delivery.signal.dedupeKey)
    expect(signal.payload).toMatchObject({ source: 'outbox', eventId: delivery.event.eventId, payload: { event: delivery.event } })
    const subject = (signal.payload as { payload: { subject: Resource } }).payload.subject
    expect(subject.metadata.name).toBe('checkout-v2.r3')
    expect(signal.causationChain).toEqual([delivery.event.eventId])
    // the Trigger in namespace ops receives nothing
    const other = store.resources.get({ kind: 'Trigger', namespace: 'ops', name: 'on-prd-published' })!
    expect(store.runLog.read(other.metadata.uid!)).toEqual([])
    // acked: a second poll finds nothing
    expect(deliverOnce(store, kinds, 10, opts)).toBe(0)
  })

  it('skips terminal Resources and the subject itself', () => {
    const wr = fresh(example('resource-namespaced'))
    wr.status = { phase: 'Succeeded' }
    const done = store.resources.put(wr)
    const running = fresh(example('resource-namespaced'))
    running.metadata.name = 'prd-create-002'
    const live = store.resources.put(running)
    const kd = kinds.get('persimmon.ai/v1', 'WorkflowRun').definition
    const e = makeEvent({ type: 'resource.created', time: '2026-09-21T09:00:00Z', ordinal: 0, payload: {},
      subject: { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: 'prd-create-002', uid: live.metadata.uid! } })
    expect(receiversOf(e, kd, store)).toEqual([])
    const e2 = { ...e, subject: { ...e.subject, name: 'x', uid: 'other' } }
    expect(receiversOf(e2, kd, store).map((r) => r.metadata.uid)).toEqual([live.metadata.uid])
    expect(done.metadata.uid).not.toBe(live.metadata.uid)
  })

  it('suppresses an event whose chain is too long, once', () => {
    const long = { ...(delivery.event as OutboxEvent), causationChain: Array.from({ length: 33 }, (_, i) => `sha256:${String(i).padStart(64, '0')}`) }
    store.outbox.enqueue(long)
    expect(deliverOnce(store, kinds, 10, opts)).toBe(1)
    const trigger = store.resources.get({ kind: 'Trigger', namespace: 'demo', name: 'on-prd-published' })!
    expect(store.runLog.read(trigger.metadata.uid!)).toEqual([])
    const [suppressed] = store.outbox.claim(10, 'x', 1000) as unknown as OutboxEvent[]
    expect(suppressed!.type).toBe('event.suppressed')
    expect(suppressed!.payload).toMatchObject({ suppressedEventId: long.eventId, suppressedType: 'artifact.published' })
    expect(validator('outbox.yaml', '/$defs/OutboxEvent')(suppressed)).toBe(true)
  })
})
