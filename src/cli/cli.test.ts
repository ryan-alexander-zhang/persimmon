import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from './index.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const fakeAdapter = (id: string, types = 'agent,script') => ({
  apiVersion: 'persimmon.ai/v1', kind: 'Adapter', metadata: { name: id.replace('/', '-') },
  spec: { id, roles: ['executor'], transport: 'stdio', command: ['node', join(process.cwd(), 'test/fixtures/fake-adapter.mjs')], env: { FAKE_ID: id, FAKE_TYPES: types } },
})

describe('persimmon CLI', () => {
  let dir: string
  let out: string[]
  let err: string[]
  const run = (...argv: string[]) => runCli(argv, { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
  const file = (name: string, docs: unknown[]) => {
    const p = join(dir, name)
    writeFileSync(p, docs.map((d) => stringify(d)).join('---\n'))
    return p
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-cli-'))
    out = []
    err = []
    process.env.PERSIMMON_CRED_GITHUB_TOKEN = 'ghp-test'
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('init writes config and applies the SDLC pack; validate and apply report per Resource', async () => {
    expect([await run('init'), err]).toEqual([0, []])
    expect(out[0]).toBe('wrote persimmon.yaml')
    expect(out.filter((l) => l.startsWith('created')).length).toBeGreaterThanOrEqual(14)
    expect(out.filter((l) => l.startsWith('warn'))).toEqual([]) // every pack Executor's Adapter ships
    out = []
    expect(await run('get', 'Workflow')).toBe(0)
    expect(out).toEqual(['Workflow/prd-approval', 'Workflow/prd-create']) // the pack is Global (20-pack.md)
    out = []
    expect([await run('init'), err]).toEqual([0, []]) // idempotent
    expect(out.every((l) => !l.startsWith('created'))).toBe(true)

    expect(await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1'), fakeAdapter('cli-human/v1', 'human')]))).toBe(0)
    out = []
    expect(await run('adapter', 'list')).toBe(0)
    expect(out).toEqual(['claude-code/v1  Ready  roles: executor', 'cli-human/v1  Ready  roles: executor', 'codex/v1  Ready  roles: executor', 'subprocess/v1  Ready  roles: executor'])

    out = []
    expect([await run('validate', 'packs/sdlc/global/50-tasks.yaml', 'packs/sdlc/global/80-workflows.yaml', 'packs/sdlc/global/40-executors.yaml'), out.filter((l) => l.startsWith('error'))]).toEqual([0, []])
    expect(out.filter((l) => l.startsWith('ok')).length).toBeGreaterThanOrEqual(7)
    out = []
    const bad = example('workflow-prd-create')
    bad.spec.entry = ['write-prd']
    expect(await run('validate', file('bad.yaml', [bad]))).toBe(1)
    expect(out.some((l) => l.startsWith('error Workflow/prd-create') && l.includes('entry must equal'))).toBe(true)

    out = []
    expect(await run('get', 'Task')).toBe(0)
    expect(out.length).toBe(5)
    expect(await run('delete', 'Task/write-prd')).toBe(1) // referenced by prd-create
    expect(err.at(-1)).toMatch(/referenced/)

    // a Namespaced override shadows the Global pack Task; refs resolve Namespace first, --global reaches the shadowed one
    const override = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'write-prd' }, spec: { ...(parse(readFileSync('packs/sdlc/global/50-tasks.yaml', 'utf8').split('---')[1]!).spec as object), timeout: '5m' } }
    out = []
    expect(await run('apply', file('override.yaml', [override]), '-n', 'default')).toBe(0)
    expect(out.at(-1)).toBe('created Task/write-prd')
    out = []
    expect(await run('get', 'Task/write-prd')).toBe(0)
    expect(out.join('\n')).toMatch(/namespace: default/)
    out = []
    expect(await run('get', 'Task/write-prd', '--global')).toBe(0)
    expect(out.join('\n')).not.toMatch(/namespace:/)
    expect(await run('delete', 'Task/write-prd', '-n', 'default')).toBe(0) // the override is unreferenced
    err = []
    out = []
    expect([await run('apply', file('ns.yaml', [{ ...override, metadata: { name: 'write-prd-2' } }]), '--global'), err, out.at(-1)]).toEqual([0, [], 'created Task/write-prd-2']) // scope Any: allowed
    out = []
    expect(await run('get', 'Task/write-prd-2')).toBe(0)
    expect(out.join('\n')).not.toMatch(/namespace:/)
    const run1 = { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'r' }, spec: { workflowRef: { kind: 'Workflow', name: 'prd-create' }, inputs: {}, timeout: '1h', origin: { kind: 'manual' } } }
    expect(await run('apply', file('run.yaml', [run1]), '--global')).toBe(1) // Namespaced kind
    expect(err.at(-1)).toMatch(/--global does not apply/)
  })

  it('create --follow drives a run to its terminal value and logs show the RunLog', async () => {
    await run('init')
    await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1')]))
    const wr = example('run-workflowrun')
    const runDoc = { apiVersion: wr.apiVersion, kind: wr.kind, metadata: { name: 'demo-001' }, spec: { ...wr.spec, timeout: '1h' } }
    out = []
    const code = await runCli(['create', file('run.yaml', [runDoc]), '--follow'], { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
    expect(code).toBe(1) // the fake adapter's execute answer is not a TaskResult
    expect(out).toEqual(['created WorkflowRun/demo-001', 'WorkflowRun/demo-001 Failed'])
    out = []
    expect(await run('get', 'WorkflowRun/demo-001')).toBe(0)
    const shown = parse(out.join('\n'))
    expect(shown.status).toMatchObject({ phase: 'Failed', error: { code: 'no_progress' } })
    out = []
    expect(await run('logs', 'TaskRun/demo-001-research')).toBe(0)
    expect(out.join('\n')).toMatch(/type: Created/)
    expect(out.join('\n')).toMatch(/type: AdapterFinished/)
    out = []
    expect(await run('resume')).toBe(0)
    expect(out).toEqual(['open events: 0'])
    expect(await run('signal', 'WorkflowRun/demo-001', '--event-id', 'e1')).toBe(0)
    expect(await run('nope')).toBe(2)
    expect(await run()).toBe(2)
  })
})
