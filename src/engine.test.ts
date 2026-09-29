import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'
import { Engine } from './engine.js'
import type { Resource } from './resource/types.js'
import type { Closure } from './snapshot/walk.js'
import { memoryBlobs } from './store/test-util.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const closure = example('snapshot-closure') as Closure
const fresh = ({ status: _s, ...r }: Resource): Resource => ({ ...r, metadata: { name: r.metadata.name, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) } })
const fakeAdapter = (id: string, roles = 'executor'): Resource => ({
  apiVersion: 'persimmon.ai/v1', kind: 'Adapter', metadata: { name: id.replace('/', '-') },
  spec: { id, roles: roles.split(','), transport: 'stdio', command: ['node', join(process.cwd(), 'test/fixtures/fake-adapter.mjs')], env: { FAKE_ID: id, FAKE_ROLES: roles } },
})

describe('Engine', () => {
  let engine: Engine
  let clock: number
  let dir: string
  beforeEach(() => {
    clock = Date.parse('2026-09-21T09:00:00Z')
    dir = mkdtempSync(join(tmpdir(), 'persimmon-engine-'))
    engine = new Engine({ config: parseConfig({}), storePath: ':memory:', blobs: memoryBlobs(), now: () => new Date(clock), cwd: dir })
    engine.dispatch.retryBaseMs = 0
  })
  afterEach(async () => {
    await engine.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers the core kinds and applies every design definition example', async () => {
    await engine.start()
    expect(engine.kinds.get('persimmon.ai/v1', 'WorkflowRun').definition.spec.snapshotOnCreate).toBe(true)
    expect(engine.handlers.get('persimmon.ai/v1', 'Trigger').impl).toBeDefined()
    await engine.apply(fakeAdapter('claude-code/v1'))
    expect(engine.adapters.require('claude-code/v1', 'executor').status?.describeDigest).toMatch(/^sha256:/)
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) await engine.apply(fresh(r as Resource))
    for (const n of ['task-approve-prd', 'validator-cel', 'gate-prd-approval', 'trigger-on-prd-published']) {
      const r = example(n) as Resource
      if (n === 'gate-prd-approval') {
        await engine.apply({ ...example('kind-definition-researchreport'), metadata: { name: 'reviewreports.engineering.persimmon.ai' }, spec: { ...example('kind-definition-researchreport').spec, names: { kind: 'ReviewReport', plural: 'reviewreports' } } })
      }
      await engine.apply(r)
    }
    expect(engine.store.resources.list('Task', 'demo').map((r) => r.metadata.name)).toEqual(['approve-prd', 'research', 'write-prd'])
    // SpecMutable update: generation bumps, SpecUpdated appended for handled kinds
    const wf = example('workflow-prd-create') as Resource
    ;(wf.spec as { timeout: string }).timeout = '3h'
    const { resource } = await engine.apply(wf)
    expect(resource.metadata.generation).toBe(2)
    expect(engine.store.runLog.read(resource.metadata.uid!).map((e) => e.event.type)).toEqual(['Created', 'SpecUpdated'])
    // Immutable kinds refuse a changed spec
    const prd = example('kind-definition-productrequirement')
    prd.spec.versions[0].schema.required = ['title']
    await expect(engine.apply(prd)).rejects.toThrow()
  })

  it('a missing Executor credential fails the attempt with permission_denied', async () => {
    await engine.start()
    await engine.apply(fakeAdapter('claude-code/v1'))
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) await engine.apply(fresh(r as Resource))
    await engine.create(fresh(example('run-workflowrun')))
    await engine.drain()
    const research = engine.store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: 'prd-create-001-research' })!
    expect(research.status).toMatchObject({ phase: 'Failed', error: { code: 'permission_denied', message: 'credential demo/github-token not found' } })
  })

  it('runs prd-create end to end against the fake Adapter until the task fails validation', async () => {
    process.env.PERSIMMON_CRED_DEMO__GITHUB_TOKEN = 'ghp-test'
    await engine.start()
    await engine.apply(fakeAdapter('claude-code/v1'))
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) await engine.apply(fresh(r as Resource))
    const errors: string[] = []
    engine.dispatch.onError = (_u, ev, e) => errors.push(`${ev.type}: ${e.message}`)
    const { resource: run } = await engine.create(fresh(example('run-workflowrun'))) // carries the repository input prd-create requires
    expect(run.metadata.snapshot?.uri).toMatch(/^snapshot:\/\//)
    await engine.drain()
    expect(errors).toEqual([])
    const research = engine.store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: 'prd-create-001-research' })!
    expect(research.metadata.ownerReferences?.[0]?.uid).toBe(run.metadata.uid)
    expect(research.status?.phase).toBe('Failed') // the fake answers execute with an echo, not a TaskResult
    expect((research.status as { error: { code: string } }).error.code).toBe('schema_violation')
    const wr = engine.store.resources.getByUid(run.metadata.uid!)!
    expect(wr.status).toMatchObject({ phase: 'Failed', error: { code: 'schema_violation' }, steps: { research: { phase: 'Failed' }, 'write-prd': { phase: 'Skipped' } } })
    expect(engine.store.runLog.listOpen()).toEqual([])
    expect(engine.store.timers.due('2099-01-01T00:00:00Z')).toEqual([])
  })
})

it('a deep cwd gets a short socket path under the temp dir (sun_path limit)', () => {
  const cwd = '/' + 'd'.repeat(120)
  const e = new Engine({ config: parseConfig({}), cwd, storePath: ':memory:', blobs: memoryBlobs() })
  expect(e.endpoint.replace('unix://', '').length).toBeLessThan(100)
  expect(e.endpoint).toMatch(/persimmon-[0-9a-f]{12}\.sock$/)
})

it('one listening engine per project: a second listen fails while the first lives, a stale lock is taken over', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'persimmon-lock-'))
  mkdirSync(join(cwd, '.persimmon'))
  const a = new Engine({ config: parseConfig({}), cwd, storePath: ':memory:', blobs: memoryBlobs() })
  await a.listen()
  const b = new Engine({ config: parseConfig({}), cwd, storePath: ':memory:', blobs: memoryBlobs() })
  await expect(b.listen()).rejects.toThrow(new RegExp(`another persimmon process \\(pid ${process.pid}\\)`))
  await a.close()
  writeFileSync(join(cwd, '.persimmon', 'engine.lock'), '999999') // no such process
  await b.listen()
  expect(readFileSync(join(cwd, '.persimmon', 'engine.lock'), 'utf8')).toBe(String(process.pid))
  await b.close()
  rmSync(cwd, { recursive: true, force: true })
})

