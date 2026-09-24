import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteStore } from './sqlite.js'
import type { OutboxRecord } from './store.js'

const events = parse(readFileSync('docs/design/examples/outbox-events.yaml', 'utf8')) as OutboxRecord[]

describe('SqliteStore queues', () => {
  let clock = Date.parse('2026-09-24T00:00:00Z')
  let store: SqliteStore
  beforeEach(() => {
    clock = Date.parse('2026-09-24T00:00:00Z')
    store = new SqliteStore(':memory:', () => new Date(clock))
  })
  afterEach(() => store.close())

  describe('outbox', () => {
    it('claims in order, hides claimed events until the ttl, acks', () => {
      for (const e of events) store.outbox.enqueue(e)
      store.outbox.enqueue(events[0]!) // duplicate eventId is a no-op
      const first = store.outbox.claim(2, 'a', 1000)
      expect(first.map((e) => e.eventId)).toEqual(events.slice(0, 2).map((e) => e.eventId))
      expect(store.outbox.claim(10, 'b', 1000).map((e) => e.eventId)).toEqual(events.slice(2).map((e) => e.eventId))
      store.outbox.ack(first[0]!.eventId)
      clock += 1000
      expect(store.outbox.claim(10, 'c', 1000).map((e) => e.eventId)).toEqual(events.slice(1).map((e) => e.eventId))
    })
  })

  describe('timers', () => {
    it('replaces on the same key and lists due timers in time order', () => {
      store.timers.set('u1', 'attempt', '2026-09-24T00:20:00Z')
      store.timers.set('u1', 'deadline', '2026-09-24T00:25:00Z')
      store.timers.set('u2', 'attempt', '2026-09-24T00:10:00Z')
      store.timers.set('u1', 'attempt', '2026-09-24T00:05:00Z')
      expect(store.timers.due('2026-09-24T00:10:00Z')).toEqual([
        { uid: 'u1', key: 'attempt', at: '2026-09-24T00:05:00Z' },
        { uid: 'u2', key: 'attempt', at: '2026-09-24T00:10:00Z' },
      ])
      store.timers.clear('u1', 'attempt')
      expect(store.timers.due('2026-09-24T00:10:00Z')).toHaveLength(1)
    })
  })

  describe('leases', () => {
    it('gives one holder per uid until expiry', () => {
      expect(store.leases.acquire('u1', 'a', 1000)).toBe(true)
      expect(store.leases.acquire('u1', 'b', 1000)).toBe(false)
      expect(store.leases.acquire('u1', 'a', 1000)).toBe(true) // re-entrant for the holder
      expect(store.leases.renew('u1', 'a', 1000)).toBe(true)
      expect(store.leases.renew('u1', 'b', 1000)).toBe(false)
      clock += 1000
      expect(store.leases.renew('u1', 'a', 1000)).toBe(false) // expired
      expect(store.leases.acquire('u1', 'b', 1000)).toBe(true)
      store.leases.release('u1', 'b')
      expect(store.leases.acquire('u1', 'a', 1000)).toBe(true)
    })
  })
})
