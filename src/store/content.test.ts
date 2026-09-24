import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileBlobStore } from './file-blobs.js'
import { SqliteStore } from './sqlite.js'

describe('content-addressed stores and tokens', () => {
  let dir: string
  let clock = Date.parse('2026-09-24T00:00:00Z')
  let store: SqliteStore
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-blobs-'))
    store = new SqliteStore(':memory:', { blobs: new FileBlobStore(dir), now: () => new Date(clock) })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('snapshots are keyed by digest and shared', () => {
    const bytes = Buffer.from('{"version":1}')
    const a = store.snapshots.put(bytes)
    const b = store.snapshots.put(Buffer.from('{"version":1}'))
    expect(a).toEqual(b)
    expect(a.uri).toBe(`snapshot://${a.digest.slice(7)}`)
    expect(a.digest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(Buffer.from(store.snapshots.get(a.uri)!).toString()).toBe('{"version":1}')
    expect(store.snapshots.get('snapshot://' + '0'.repeat(64))).toBeUndefined()
  })

  it('blobs land on disk with their media type', () => {
    const a = store.blobs.put(Buffer.from('# PRD'), 'text/markdown')
    expect(store.blobs.put(Buffer.from('# PRD'), 'text/markdown')).toEqual(a)
    expect(a.uri).toMatch(/^blob:\/\/[a-f0-9]{64}$/)
    const got = store.blobs.get(a.uri)!
    expect(Buffer.from(got.bytes).toString()).toBe('# PRD')
    expect(got.mediaType).toBe('text/markdown')
    expect(store.blobs.get('blob://' + '0'.repeat(64))).toBeUndefined()
  })

  it('tokens verify to their scope until expiry or revoke', () => {
    const scope = { kind: 'call', uid: 'u1', idempotencyKey: 'k1' }
    const t1 = store.tokens.issue(scope, '2026-09-24T01:00:00Z')
    const t2 = store.tokens.issue({ kind: 'adapter', id: 'claude-code/v1' })
    expect(t1).toMatch(/^[a-f0-9]{64}$/)
    expect(store.tokens.verify(t1)).toEqual(scope)
    expect(store.tokens.verify('nope')).toBeUndefined()
    clock = Date.parse('2026-09-24T01:00:00Z')
    expect(store.tokens.verify(t1)).toBeUndefined()
    expect(store.tokens.verify(t2)).toEqual({ kind: 'adapter', id: 'claude-code/v1' })
    store.tokens.revoke({ kind: 'adapter', id: 'claude-code/v1' })
    expect(store.tokens.verify(t2)).toBeUndefined()
  })
})
