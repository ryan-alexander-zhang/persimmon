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
    expect(out.some((l) => l.includes('warn  Executor/claude-agent'))).toBe(true)
    out = []
    expect([await run('init'), err]).toEqual([0, []]) // idempotent
    expect(out.every((l) => !l.startsWith('created'))).toBe(true)

    expect(await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1'), fakeAdapter('cli-human/v1', 'human')]))).toBe(0)
    out = []
    expect(await run('adapter', 'list')).toBe(0)
    expect(out).toEqual(['claude-code/v1  Ready  roles: executor', 'cli-human/v1  Ready  roles: executor'])

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
