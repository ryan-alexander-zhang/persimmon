import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Resource } from '../resource/types.js'
import { SqliteStore } from './sqlite.js'
import { memoryBlobs } from './test-util.js'
import { ConflictError, NotFoundError, ReferencedError } from './store.js'

const example = (name: string) => parse(readFileSync(`docs/design/examples/${name}.yaml`, 'utf8')) as Resource
const fresh = (r: Resource): Resource => {
  const c = structuredClone(r)
  delete c.metadata.uid
  delete c.metadata.resourceVersion
  delete c.metadata.generation
  delete c.metadata.creationTimestamp
  return c
}

describe('SqliteStore.resources', () => {
  let store: SqliteStore
  beforeEach(() => {
    store = new SqliteStore(':memory:', { blobs: memoryBlobs(), now: () => new Date('2026-09-24T00:00:00Z') })
  })
  afterEach(() => store.close())

  it('creates with engine metadata', () => {
    const r = store.resources.put(fresh(example('resource-namespaced')))
    expect(r.metadata.uid).toMatch(/^[0-9a-f-]{36}$/)
    expect(r.metadata.resourceVersion).toBe('1')
    expect(r.metadata.generation).toBe(1)
    expect(r.metadata.creationTimestamp).toBe('2026-09-24T00:00:00.000Z')
    expect(store.resources.get({ kind: 'WorkflowRun', namespace: 'demo', name: 'prd-create-001' })).toEqual(r)
    expect(store.resources.getByUid(r.metadata.uid!)).toEqual(r)
  })

  it('refuses a second create of the same name', () => {
    store.resources.put(fresh(example('resource-namespaced')))
    expect(() => store.resources.put(fresh(example('resource-namespaced')))).toThrow(ConflictError)
  })

  it('updates by CAS and bumps generation only on spec change', () => {
    const r1 = store.resources.put(fresh(example('resource-global')))
    const r2 = store.resources.put({ ...r1, status: { ready: true } })
    expect(r2.metadata.resourceVersion).toBe('2')
    expect(r2.metadata.generation).toBe(1)
    const r3 = store.resources.put({ ...r2, spec: { ...r2.spec, mutability: 'Immutable' } })
    expect(r3.metadata.generation).toBe(2)
    expect(r3.metadata.uid).toBe(r1.metadata.uid)
    expect(() => store.resources.put({ ...r1, status: {} })).toThrow(/stale/)
  })

  it('refuses an update with a resourceVersion for an unknown Resource', () => {
    expect(() => store.resources.put(example('resource-global'))).toThrow(ConflictError)
  })

  it('lists by kind, namespace and labels', () => {
    const a = fresh(example('resource-namespaced'))
    a.metadata.labels = { team: 'x' }
    const b = fresh(example('resource-namespaced'))
    b.metadata.name = 'other'
    b.metadata.namespace = 'ops'
    store.resources.put(a)
    store.resources.put(b)
    expect(store.resources.list('WorkflowRun').map((r) => r.metadata.name)).toEqual(['prd-create-001', 'other'])
    expect(store.resources.list('WorkflowRun', 'ops')).toHaveLength(1)
    expect(store.resources.list('WorkflowRun', undefined, { team: 'x' })).toHaveLength(1)
    expect(store.resources.list('Nope')).toEqual([])
  })

  it('refuses delete while an owner reference or spec ref points at it', () => {
    const owner = store.resources.put(fresh(example('resource-namespaced')))
    const child = fresh(example('resource-child'))
    child.metadata.ownerReferences = [
      { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: 'prd-create-001', uid: owner.metadata.uid! },
    ]
    const c = store.resources.put(child)
    expect(() => store.resources.delete(owner.metadata.uid!)).toThrow(ReferencedError)
    store.resources.delete(c.metadata.uid!)
    store.resources.delete(owner.metadata.uid!)
    expect(store.resources.getByUid(owner.metadata.uid!)).toBeUndefined()
    expect(() => store.resources.delete('nope')).toThrow(NotFoundError)
  })

  it('tracks RevisionRefs inside spec', () => {
    const prd = store.resources.put(fresh(example('revisioned-instance')))
    const report = fresh(example('revisioned-instance'))
    report.kind = 'ResearchReport'
    report.metadata.name = 'research-checkout-v2.r1'
    report.spec = { ...report.spec, identity: { id: 'research-checkout-v2', revision: 1 } }
    const rep = store.resources.put(report)
    // prd.spec.provenance.inputs points at ResearchReport research-checkout-v2 revision 1
    expect(() => store.resources.delete(rep.metadata.uid!)).toThrow(ReferencedError)
    store.resources.delete(prd.metadata.uid!)
    store.resources.delete(rep.metadata.uid!)
  })

  it('rolls back a failed transaction', () => {
    expect(() =>
      store.transaction(() => {
        store.resources.put(fresh(example('resource-global')))
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(store.resources.list('KindDefinition')).toEqual([])
  })

  it('appends and reads audit records', () => {
    const rec = parse(readFileSync('docs/design/examples/resource-audit.yaml', 'utf8'))
    store.audit.append(rec)
    store.audit.append({ ...rec, change: 'delete' })
    expect(store.audit.read(rec.uid).map((r) => r.change)).toEqual(['status', 'delete'])
  })
})

describe('SqliteStore over one file from two processes', () => {
  it('waits for a write lock another process holds instead of failing', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'persimmon-')), 'store.db')
    const store = new SqliteStore(path, { blobs: memoryBlobs() })
    const holder = spawn(process.execPath, ['-e', `
      const db = new (require('node:sqlite').DatabaseSync)(${JSON.stringify(path)})
      db.exec('begin immediate'); console.log('locked')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400)
      db.exec('commit')`])
    await new Promise((resolve) => holder.stdout.once('data', resolve))
    expect(store.leases.acquire('uid-1', 'me', 1000)).toBe(true)
    store.close()
  })
})
