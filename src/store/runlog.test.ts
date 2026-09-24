import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SqliteStore } from './sqlite.js'
import type { RunLogEntry } from './store.js'

const log = parse(readFileSync('docs/design/examples/reconcile-runlog.yaml', 'utf8')) as { uid: string; entries: RunLogEntry[] }
const stripSeq = (e: RunLogEntry['event']) => {
  const { sequence: _s, ...rest } = e
  return rest
}

describe('SqliteStore.runLog', () => {
  let store: SqliteStore
  beforeEach(() => {
    store = new SqliteStore(':memory:')
  })
  afterEach(() => store.close())

  it('replays the design RunLog example exactly', () => {
    const { uid, entries } = log
    for (const e of entries) {
      const seq = store.runLog.append(uid, stripSeq(e.event))
      expect(seq).toBe(e.event.sequence)
      for (let i = 0; i < (e.deliveries ?? 1); i++) store.runLog.markDelivery(uid, seq)
      store.runLog.ack(uid, seq, e.result!, e.appliedAt!)
    }
    expect(store.runLog.read(uid)).toEqual(entries)
    expect(store.runLog.read(uid, 4).map((e) => e.event.sequence)).toEqual([4])
  })

  it('dedupes on (uid, dedupeKey) and ignores a second ack', () => {
    const { uid, entries } = log
    const first = entries[0]!
    expect(store.runLog.append(uid, stripSeq(first.event))).toBe(1)
    expect(store.runLog.append(uid, stripSeq(first.event))).toBe(1)
    store.runLog.ack(uid, 1, first.result!, first.appliedAt!)
    store.runLog.ack(uid, 1, { actions: [] }, '2030-01-01T00:00:00Z')
    expect(store.runLog.read(uid)[0]!.appliedAt).toBe(first.appliedAt)
  })

  it('lists open entries and outstanding calls', () => {
    const { uid, entries } = log
    const [created, finished] = entries as [RunLogEntry, RunLogEntry]
    store.runLog.append(uid, stripSeq(created.event))
    expect(store.runLog.listOpen()).toEqual([{ uid, entry: { event: created.event } }])
    expect(store.runLog.outstandingCalls()).toEqual([])
    store.runLog.ack(uid, 1, created.result!, created.appliedAt!)
    expect(store.runLog.listOpen()).toEqual([])
    const calls = store.runLog.outstandingCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.action.idempotencyKey).toBe('prd-create-001//research/1')
    store.runLog.append(uid, stripSeq(finished.event))
    expect(store.runLog.outstandingCalls()).toEqual([])
  })

  it('keeps sequences per uid', () => {
    store.runLog.append('a', { type: 'Created', dedupeKey: 'created' })
    expect(store.runLog.append('b', { type: 'Created', dedupeKey: 'created' })).toBe(1)
    expect(store.runLog.append('a', { type: 'CancelRequested', dedupeKey: 'cancel', causationChain: ['sha256:1'] })).toBe(2)
    expect(store.runLog.read('a')[1]!.event.causationChain).toEqual(['sha256:1'])
  })
})
