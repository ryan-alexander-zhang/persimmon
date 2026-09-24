import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Resource } from '../resource/types.js'
import { SqliteStore } from './sqlite.js'
import { memoryBlobs } from './test-util.js'

const instance = parse(readFileSync('docs/design/examples/revisioned-instance.yaml', 'utf8')) as Resource
const revision = (n: number): Resource => {
  const r = structuredClone(instance)
  delete r.metadata.uid
  delete r.metadata.resourceVersion
  delete r.metadata.generation
  delete r.metadata.creationTimestamp
  r.metadata.name = `checkout-v2.r${n}`
  ;(r.spec as { identity: { revision: number } }).identity.revision = n
  return r
}
const K = 'ProductRequirement'
const owner = '019a3c2e-7d00-7b1c-9d2e-3f4a5b6c7d8e'

describe('revisions and Publication scopes', () => {
  let store: SqliteStore
  beforeEach(() => {
    store = new SqliteStore(':memory:', { blobs: memoryBlobs() })
  })
  afterEach(() => store.close())

  it('follows the design publish flow: abandoned revision leaves a gap', () => {
    expect(store.resources.reserveRevision(K, 'demo', 'checkout-v2')).toBe(1)
    expect(store.resources.reserveRevision(K, 'demo', 'checkout-v2')).toBe(2)
    const k1 = { uid: owner, key: 'prd-create-001//write-prd/1' }
    store.resources.stage(revision(2), k1)
    expect(store.resources.get({ kind: K, namespace: 'demo', name: 'checkout-v2.r2' })).toBeUndefined()
    expect(store.resources.staged(owner)).toMatchObject([{ ref: { id: 'checkout-v2', revision: 2 }, scope: k1.key, state: 'staged' }])

    store.resources.abandonScope(k1)
    expect(store.resources.staged(owner)[0]!.state).toBe('abandoned')
    expect(store.resources.reserveRevision(K, 'demo', 'checkout-v2')).toBe(3)

    const k2 = { uid: owner, key: 'prd-create-001//write-prd/2' }
    store.resources.stage(revision(3), k2)
    const committed = store.resources.commitScope(k2)
    expect(committed.map((r) => r.metadata.name)).toEqual(['checkout-v2.r3'])
    expect(store.resources.get({ kind: K, namespace: 'demo', name: 'checkout-v2.r3' })?.metadata.uid).toBe(committed[0]!.metadata.uid)
    expect(store.resources.get({ kind: K, namespace: 'demo', name: 'checkout-v2.r2' })).toBeUndefined()
    expect(store.resources.listRevisions(K, 'demo', 'checkout-v2').map((r) => r.metadata.name)).toEqual(['checkout-v2.r3'])
    expect(store.resources.staged(owner).map((s) => s.state)).toEqual(['abandoned', 'committed'])
    expect(store.resources.commitScope(k2)).toEqual([]) // second commit: nothing left staged
    expect(store.resources.reserveRevision(K, 'demo', 'checkout-v2')).toBe(4)
  })

  it('keeps revision counters per identity and namespace', () => {
    store.resources.reserveRevision(K, 'demo', 'a')
    expect(store.resources.reserveRevision(K, 'demo', 'b')).toBe(1)
    expect(store.resources.reserveRevision(K, 'ops', 'a')).toBe(1)
    expect(store.resources.reserveRevision(K, 'demo', 'a')).toBe(2)
  })

  it('a committed revision blocks delete of what its provenance points at', () => {
    const report = revision(1)
    report.kind = 'ResearchReport'
    report.metadata.name = 'research-checkout-v2.r1'
    ;(report.spec as { identity: { id: string } }).identity.id = 'research-checkout-v2'
    const rep = store.resources.stage(report, { uid: owner, key: 'a' })
    store.resources.commitScope({ uid: owner, key: 'a' })
    store.resources.stage(revision(3), { uid: owner, key: 'b' })
    expect(() => store.resources.delete(rep.metadata.uid!)).not.toThrow() // staged does not hold a ref yet
    const rep2 = store.resources.stage(report, { uid: owner, key: 'c' })
    store.resources.commitScope({ uid: owner, key: 'c' })
    store.resources.commitScope({ uid: owner, key: 'b' })
    expect(() => store.resources.delete(rep2.metadata.uid!)).toThrow(/referenced/)
  })
})
