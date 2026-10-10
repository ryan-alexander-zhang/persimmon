import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KindRegistry } from '../kind-definition/registry.js'
import type { KindDefinition } from '../kind-definition/types.js'
import { validator } from '../resource/ajv.js'
import type { Resource } from '../resource/types.js'
import { SqliteStore } from '../store/sqlite.js'
import { memoryBlobs } from '../store/test-util.js'
import { canonicalJson, digestOf } from './canonical.js'
import { readClosure, storeClosure } from './snapshot.js'
import { type Closure, type Resolver, resolveClosure, SnapshotError } from './walk.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const closure = example('snapshot-closure') as Closure
const fresh = (r: Resource): Resource => ({ ...r, metadata: { name: r.metadata.name, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) } })

describe('canonical encoding', () => {
  it('sorts keys at every depth and has no whitespace', () => {
    expect(canonicalJson({ b: [{ z: 1, a: 2 }], a: 'x' })).toBe('{"a":"x","b":[{"a":2,"z":1}]}')
    expect(digestOf(Buffer.from('{}'))).toBe('sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
  })
})

describe('resolveClosure', () => {
  let store: SqliteStore
  let reg: KindRegistry
  let resolver: Resolver
  beforeEach(() => {
    store = new SqliteStore(':memory:', { blobs: memoryBlobs() })
    reg = new KindRegistry()
    const fullKinds = ['workflow', 'task', 'prompt', 'workflowrun', 'productrequirement', 'researchreport', 'pipeline'].map((n) =>
      example(`kind-definition-${n}`),
    )
    const fromClosure = closure.resources.filter((r) => r.kind === 'KindDefinition' && /^(executors|skills|taskruns)\./.test(r.metadata.name))
    for (const kd of [...fullKinds, ...fromClosure]) reg.register(kd)
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) store.resources.put(fresh(r as Resource))
    resolver = {
      kindByName: (k) => reg.byKind(k)?.definition,
      kind: (av, k) => reg.lookup(av, k)?.definition,
      definition: (kind, ns, name) => store.resources.get({ kind, namespace: ns, name }) ?? store.resources.get({ kind, name }),
      adapterDigest: (id) => {
        const a = closure.adapters.find((a) => a.id === id)
        if (!a) throw new SnapshotError(`adapter ${id} not Ready`)
        return a.describeDigest
      },
      // a stand-in for the composition Handler: a Pipeline expands to the Workflow its spec names under `expandsTo`
      expand: (r) => [{ apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: r.metadata.name, namespace: r.metadata.namespace }, spec: (r.spec as { expandsTo: Record<string, unknown> }).expandsTo } as Resource],
    }
  })

  const prdCreate = () => closure.resources.find((r) => r.kind === 'Workflow')!.spec as Record<string, unknown>

  it('a composition is replaced by its expansion; its KindDefinition rides along (04-snapshot.md step 8)', () => {
    store.resources.put({ apiVersion: 'persimmon.ai/v1', kind: 'Pipeline', metadata: { name: 'pipe', namespace: 'demo' }, spec: { expandsTo: prdCreate() } })
    const r = root()
    ;(r.spec as { workflowRef: { kind: string; name: string } }).workflowRef = { kind: 'Pipeline', name: 'pipe' } // allowed: Pipeline expands to Workflow
    const c = resolveClosure(r, resolver)
    const names = c.resources.map((x) => `${x.kind} ${x.metadata.name}`)
    expect(names).toContain('Workflow pipe')
    expect(names).toContain('KindDefinition pipelines.persimmon.ai')
    expect(names).toContain('Task research') // the expansion was walked
    expect(names.some((n) => n.startsWith('Pipeline '))).toBe(false)
  })

  it('an expansion that collides with a member of a different spec fails the create', () => {
    const outer = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'outer', namespace: 'demo' }, spec: { ...prdCreate(), steps: [{ id: 'a', uses: { kind: 'Workflow', name: 'prd-create' }, inputs: {}, timeout: '1h' }, { id: 'b', uses: { kind: 'Pipeline', name: 'prd-create' }, inputs: {}, timeout: '1h' }] } }
    store.resources.put(outer)
    store.resources.put({ apiVersion: 'persimmon.ai/v1', kind: 'Pipeline', metadata: { name: 'prd-create', namespace: 'demo' }, spec: { expandsTo: { ...prdCreate(), timeout: '9h' } } })
    const r = root()
    ;(r.spec as { workflowRef: { name: string } }).workflowRef.name = 'outer'
    expect(() => resolveClosure(r, resolver)).toThrow(/Workflow prd-create is already in the closure with a different spec/)
  })
  afterEach(() => store.close())

  const root = () => example('resource-namespaced') as Resource

  it('reaches every member of the design closure example', () => {
    const c = resolveClosure(root(), resolver)
    const names = (x: Closure) => x.resources.map((r) => `${r.kind} ${r.metadata.name}`).sort()
    expect(names(c)).toEqual(names(closure))
    expect(c.adapters).toEqual(closure.adapters)
    expect(validator('snapshot.yaml')(c)).toBe(true)
    expect(c.resources.map((r) => Object.keys(r.metadata).sort().join(',')).every((k) => /^name(,namespace)?$/.test(k))).toBe(true)
  })

  it('is deterministic and content-addressed', () => {
    const a = storeClosure(resolveClosure(root(), resolver), store.snapshots)
    const b = storeClosure(resolveClosure(root(), resolver), store.snapshots)
    expect(a).toEqual(b)
    expect(a.uri).toBe(`snapshot://${a.digest.slice(7)}`)
    expect(readClosure(a, store.snapshots).version).toBe(1)
    expect(() => readClosure({ uri: a.uri, digest: 'sha256:' + '0'.repeat(64) }, store.snapshots)).toThrow(/digest mismatch/)
  })

  it('prefers the root Namespace over a Global definition on every hop', () => {
    const globalTask = fresh(closure.resources.find((r) => r.kind === 'Task' && r.metadata.name === 'research') as Resource)
    delete globalTask.metadata.namespace
    ;(globalTask.spec as { timeout: string }).timeout = '99h'
    store.resources.put(globalTask)
    const c = resolveClosure(root(), resolver)
    const research = c.resources.filter((r) => r.kind === 'Task' && r.metadata.name === 'research')
    expect(research).toHaveLength(1)
    expect(research[0]!.metadata.namespace).toBe('demo')
  })

  it('fails on an unresolved ref, a kind outside the allowed list, and a missing Adapter', () => {
    const r = root()
    ;(r.spec as { workflowRef: { name: string } }).workflowRef.name = 'nope'
    expect(() => resolveClosure(r, resolver)).toThrow(/Workflow nope not found/)
    const r2 = root()
    ;(r2.spec as { workflowRef: { kind: string } }).workflowRef.kind = 'Task'
    expect(() => resolveClosure(r2, resolver)).toThrow(/not in Workflow/)
    const wf = store.resources.get({ kind: 'Executor', namespace: 'demo', name: 'claude-agent' })!
    ;(wf.spec as { adapter: string }).adapter = 'gone/v1'
    store.resources.put(wf)
    expect(() => resolveClosure(root(), resolver)).toThrow(/gone\/v1 not Ready/)
  })

  it('freezes stepContract runKind definitions even when no run exists yet', () => {
    const c = resolveClosure(root(), resolver)
    expect(c.resources.some((r) => r.metadata.name === 'workflowruns.persimmon.ai')).toBe(true)
  })
})
