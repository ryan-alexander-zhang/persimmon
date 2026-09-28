import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseInput } from './create.js'
import { askForm, example as template, type Form } from './signal.js'
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
    expect(out).toContain('created Trigger/on-prd-published') // the pack's Trigger listens in defaultNamespace
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

    // describe-driven Task rules: parameters, context kinds, Skill formats (12-task.md)
    const codexExecutor = { apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name: 'codex-agent' }, spec: { type: 'agent', adapter: 'codex/v1', configuration: { model: 'gpt-6-sol' }, security: { networkAccess: 'deny' } } }
    const skill = { apiVersion: 'persimmon.ai/v1', kind: 'Skill', metadata: { name: 'odd' }, spec: { source: { provider: 'git', type: 'repository', id: 'x', locator: { remote: 'r' }, version: 'v' }, digest: 'sha256:' + 'a'.repeat(64), format: 'other/v1' } }
    const t1 = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 't1' }, spec: { outputs: { n: { type: { kind: 'value', schema: { type: 'integer' } } } }, executorRef: { kind: 'Executor', name: 'codex-agent' }, action: { instructions: 'x', parameters: { effort: 'high' }, context: [{ kind: 'skill', ref: { kind: 'Skill', name: 'odd' } }] }, timeout: '1m', sideEffects: 'none' } }
    out = []
    expect(await run('validate', file('rules.yaml', [codexExecutor, skill, t1]))).toBe(1)
    const errors = out.filter((l) => l.startsWith('error Task/t1'))
    expect(errors.some((l) => l.includes('parameters do not match codex/v1 describe.parametersSchema'))).toBe(true)
    expect(errors.some((l) => l.includes('Skill odd format other/v1 is not in codex/v1 describe.skillFormats'))).toBe(true)
    const t2 = { ...t1, metadata: { name: 't2' }, spec: { ...t1.spec, executorRef: { kind: 'Executor', name: 'lint-script' }, action: { instructions: 'x', context: [{ kind: 'prompt', ref: { kind: 'Prompt', name: 'write-prd-template' } }] } } }
    out = []
    expect(await run('validate', file('rules2.yaml', [t2]))).toBe(1)
    expect(out.some((l) => l.startsWith('error Task/t2') && l.includes('subprocess/v1 does not accept prompt context'))).toBe(true)

    out = []
    expect(await run('get', 'Task')).toBe(0)
    expect(out.length).toBe(5)
    expect(await run('delete', 'Task/write-prd')).toBe(1) // referenced by prd-create
    expect(err.at(-1)).toMatch(/referenced/)

    // a Namespaced override shadows the Global pack Task; refs resolve Namespace first, --global reaches the shadowed one
    const override = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'write-prd' }, spec: { ...(parse(readFileSync('packs/sdlc/global/50-tasks.yaml', 'utf8').split('---')[1]!).spec as object), timeout: '5m' } }
    const incompatible = structuredClone(override) as { spec: { outputs: Record<string, unknown> } }
    incompatible.spec.outputs = { other: { type: { kind: 'value', schema: { type: 'string' } } } }
    err = []
    expect(await run('apply', file('incompatible.yaml', [incompatible]), '-n', 'default')).toBe(1) // ports must match the Global definition (20-pack.md)
    expect(err.at(-1)).toMatch(/override outputs\.prd is missing/)
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

  it('run --follow returns when the run is parked on a human Task', async () => {
    await run('init')
    const ask = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'ask' }, spec: { inputs: { q: { type: { kind: 'value', schema: { type: 'string' } } } }, outputs: { result: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/ValidationResult' } } } }, executorRef: { kind: 'Executor', name: 'local-reviewer' }, action: { instructions: 'Answer' }, timeout: '1h', sideEffects: 'none' } }
    const wf = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'ask-wf' }, spec: { inputs: { q: { type: { kind: 'value', schema: { type: 'string' } } } }, entry: ['ask'], steps: [{ id: 'ask', uses: { kind: 'Task', name: 'ask' }, inputs: { q: { fromInput: 'q' } }, timeout: '1h' }], transitions: [{ id: 'done', from: [{ stepRef: 'ask', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '3h' } }
    expect(await run('apply', file('ask.yaml', [ask, wf]))).toBe(0)
    out = []
    expect(await run('run', 'ask-wf', '--input', 'q=ok?', '--follow')).toBe(0)
    const name = out[0]!.split('/')[1]!
    expect(out.at(-1)).toBe(`parked on you: persimmon complete ${name}-ask`)
    expect(out).toContain(`TaskRun/${name}-ask  Waiting human (.persimmon/inbox/${name}-ask.yaml)`)
    out = []
    expect(await run('get', `WorkflowRun/${name}`)).toBe(0)
    expect(parse(out.join('\n')).spec.timeout).toBe('3h')
  })

  it('create --follow drives a run to its terminal value and logs show the RunLog', async () => {
    await run('init')
    await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1')]))
    const wr = example('run-workflowrun')
    const runDoc = { apiVersion: wr.apiVersion, kind: wr.kind, metadata: { name: 'demo-001' }, spec: { ...wr.spec, timeout: '1h' } }
    out = []
    const code = await runCli(['create', file('run.yaml', [runDoc]), '--follow'], { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
    expect(code).toBe(1) // the fake adapter's execute answer is not a TaskResult
    expect(out[0]).toBe('created WorkflowRun/demo-001')
    expect(out.at(-1)).toBe('WorkflowRun/demo-001  Failed no_progress: every activated step finished and no terminal was selected')
    expect(out.some((l) => /^TaskRun\/demo-001-research  Failed schema_violation/.test(l))).toBe(true) // owned runs report as they change
    out = []
    expect(await run('get', 'WorkflowRun/demo-001')).toBe(0)
    const shown = parse(out.join('\n'))
    expect(shown.status).toMatchObject({ phase: 'Failed', error: { code: 'no_progress' } })
    out = []
    expect(await run('logs', 'TaskRun/demo-001-research')).toBe(0)
    expect(out.join('\n')).toMatch(/type: Created/)
    expect(out.join('\n')).toMatch(/type: AdapterFinished/)
    out = []
    expect(await run('tree', 'WorkflowRun/demo-001')).toBe(0)
    expect(out[0]).toMatch(/^WorkflowRun   demo-001\s+Failed\s+\d+s$/)
    expect(out[1]).toBe('   no_progress: every activated step finished and no terminal was selected') // the error under the run
    expect(out[2]).toMatch(/^└─ research   TaskRun   claude-code\/v1\s+Failed\s+\d+s$/) // owned runs branch under their owner
    expect(out[3]).toMatch(/^      schema_violation: /)
    expect(out).toHaveLength(4)
    out = []
    expect(await run('resume')).toBe(0)
    expect(out).toEqual(['open events: 0'])
    expect(await run('signal', 'WorkflowRun/demo-001', '--event-id', 'e1')).toBe(0)
    expect(await run('nope')).toBe(2)
    expect(await run()).toBe(2)
  })

  it('run builds a manual WorkflowRun from --input values and follows it', async () => {
    await run('init')
    await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1')]))
    const repo = example('resource-refs').externalResourceRef
    writeFileSync(join(dir, 'repo.yaml'), stringify({ kind: 'externalResource', ref: repo }))
    out = []
    const code = await runCli(['run', 'prd-create', '--input', `repository=@${join(dir, 'repo.yaml')}`, '--timeout', '2h', '--follow'], { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
    expect(code).toBe(1)
    expect(out[0]).toMatch(/^created WorkflowRun\/prd-create-[0-9a-f]{6}$/)
    const name = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${name}`)).toBe(0)
    const shown = parse(out.join('\n'))
    expect(shown.spec).toMatchObject({ workflowRef: { kind: 'Workflow', name: 'prd-create' }, inputs: { repository: { kind: 'externalResource', ref: repo } }, timeout: '2h', origin: { kind: 'manual' } })
    expect(shown.metadata.namespace).toBe('default')
    // a bare path on an externalResource port becomes a repository ref pinned to HEAD
    out = []
    expect(await run('run', 'prd-create', '--input', `repository=${process.cwd()}`)).toBe(0)
    const name2 = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${name2}`)).toBe(0)
    expect(parse(out.join('\n')).spec.inputs.repository).toMatchObject({ kind: 'externalResource', ref: { provider: 'git', type: 'repository', id: 'persimmon', locator: { path: process.cwd() }, version: expect.stringMatching(/^[0-9a-f]{40}$/) } })
    expect(parse(out.join('\n')).spec.timeout).toBe('2h') // no --timeout: the Workflow's own (prd-create: 2h)
    // a revision document on an artifact port is stored and referenced
    const prdDoc = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', metadata: { name: 'spec-1.r1' }, spec: { identity: { id: 'spec-1', revision: 1 }, content: { title: 'Spec', problem: 'p', requirements: [{ id: 'R1', statement: 's' }] } } }
    out = []
    expect(await run('run', 'prd-approval', '--input', `prd=@${file('prd.yaml', [prdDoc])}`)).toBe(0)
    const name3 = out[0]!.split('/')[1]!
    out = []
    expect(await run('get', `WorkflowRun/${name3}`)).toBe(0)
    expect(parse(out.join('\n')).spec.inputs.prd).toEqual({ kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'default', id: 'spec-1', revision: 1 } })
    out = []
    expect(await run('get', 'ProductRequirement/spec-1.r1')).toBe(0)
    expect(parse(out.join('\n')).spec.content.title).toBe('Spec')
    expect(await run('run', 'prd-approval', '--input', `prd=@${file('prd.yaml', [prdDoc])}`)).toBe(0) // a second run reuses the stored revision
    expect(parseInput('n=12')).toEqual(['n', { kind: 'value', value: 12 }])
    expect(parseInput('s=hello world')).toEqual(['s', { kind: 'value', value: 'hello world' }])
    expect(parseInput('a={kind: artifact, ref: {id: x}}')).toEqual(['a', { kind: 'artifact', ref: { id: 'x' } }])
    expect(() => parseInput('novalue')).toThrow(/<port>=<value>/)
  })

  it('an unknown flag is an error with usage, exit 2', async () => {
    expect(await run('run', 'wf', '--inputs', 'x=1')).toBe(2)
    expect(err.at(-1)).toMatch(/Unknown option '--inputs'/)
    expect(out.at(-1)).toMatch(/^usage: persimmon/)
  })

  it('complete refuses a TaskRun that is not waiting for a human, and stops at EOF keeping the form', async () => {
    await run('init')
    await run('adapter', 'install', file('a.yaml', [fakeAdapter('claude-code/v1')]))
    const wr = example('run-workflowrun')
    await runCli(['create', file('run.yaml', [{ apiVersion: wr.apiVersion, kind: wr.kind, metadata: { name: 'demo-002' }, spec: { ...wr.spec, timeout: '1h' } }]), '--follow'], { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
    expect(await run('complete', 'demo-002-research', '--file', file('r.yaml', [{ protocol: 'persimmon.result/v1', outputs: {} }]))).toBe(1)
    expect(err.at(-1)).toMatch(/is Failed.*not waiting for a human/)
  })

  it('a form example is a value shaped like the schema, never the schema', () => {
    expect(template({ type: 'object', required: ['title', 'tags', 'level'], properties: { title: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, level: { enum: ['low', 'high'] }, extra: { type: 'integer' } } })).toEqual({ title: '', tags: [''], level: 'low' })
    expect(template({ type: 'object', properties: { n: { type: 'number' }, ok: { type: 'boolean' }, items: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } } })).toEqual({ n: 0, ok: false, items: [{ id: '' }] })
    expect(template({ type: 'object', required: ['a', 'b'], properties: { a: { $ref: '#/$defs/x' }, b: { oneOf: [{ type: 'integer' }, { type: 'string' }] } }, $defs: { x: { type: 'object', required: ['y'], properties: { y: { type: 'boolean' } } } } })).toEqual({ a: { y: false }, b: 0 })
    expect(template({ allOf: [{ type: 'object', required: ['a'], properties: { a: { type: 'string' } } }, { required: ['b'], properties: { b: { type: 'integer' } } }] })).toEqual({ a: '', b: 0 })
    expect(template({ type: 'array', minItems: 2, items: { type: 'string' } })).toEqual(['', ''])
    expect(template({ type: 'array', items: [{ type: 'string' }] })).toEqual([])
  })

  it('the interactive form: reject with findings, an artifact answer through the example loop, a form without reading', async () => {
    const asks: { prompt: string; mode: string }[] = []
    const scripted = (answers: (string | null)[]) => async (prompt: string, mode: string) => (asks.push({ prompt, mode }), answers.shift() ?? null)
    const prd: Form['reading'] = [{ kind: 'ProductRequirement', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'default', id: 'p', revision: 1 }, content: { title: 'P' } }]
    const result = { type: { kind: 'value' as const, schema: { type: 'object', required: ['passed', 'findings', 'evidence'], properties: { passed: { type: 'boolean' }, findings: { type: 'array' }, evidence: { type: 'array' } } } } }
    // reject: n, two blocking findings; evidence is what was shown
    let c = await askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted(['n', 'no acceptance criteria\nno owner']) }, { instructions: 'Approve?', reading: prd, outputs: { result } }, 'tr')
    expect(c).toEqual({ taskResult: { protocol: 'persimmon.result/v1', outputs: { result: { kind: 'value', value: { passed: false, findings: [{ severity: 'error', code: 'blocking_1', message: 'no acceptance criteria' }, { severity: 'error', code: 'blocking_2', message: 'no owner' }], evidence: [prd[0]!.ref] } } } }, publish: [] })
    expect(asks.map((a) => a.mode)).toEqual(['line', 'block'])
    expect(out.join('\n')).toContain('── ProductRequirement p r1 ──\ntitle: P')
    // artifact output: bad YAML, then a schema miss, then a good answer; published under a DNS-label id
    asks.length = 0
    out = []
    const report = { type: { kind: 'artifact' as const, artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ReviewReport' } } }
    c = await askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted(['verdict: [', 'verdict: 3', 'verdict: approve']) }, { instructions: 'Review', reading: [], inputs: { prd: { kind: 'artifact', ref: prd[0]!.ref } }, outputs: { Report: report }, outputSchemas: { Report: { type: 'object', required: ['verdict'], properties: { verdict: { enum: ['approve', 'revise'] } } } } }, 'my-Run')
    expect(c).toEqual({ taskResult: { protocol: 'persimmon.result/v1', outputs: {} }, publish: [{ port: 'Report', request: { kind: report.type.artifactKind, id: 'my-run-report', content: { verdict: 'approve' }, representations: [] } }] })
    expect(asks).toHaveLength(3)
    expect(asks[0]!.prompt).toContain('for example:\nverdict: approve') // the example, not the schema
    expect(err.filter((l) => l.startsWith('not YAML') || l.startsWith('Report:'))).toHaveLength(2)
    expect(out.join('\n')).toContain('inputs:') // no reading: the references are shown instead
    // an artifact the adapter could not fetch is shown as unavailable and is not evidence
    asks.length = 0
    out = []
    const gone = { kind: 'ReviewReport', ref: { ...prd[0]!.ref, kind: 'ReviewReport', id: 'r' }, error: 'not_found' }
    c = await askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted(['y', '']) }, { instructions: 'Approve?', reading: [...prd, gone], outputs: { result } }, 'tr')
    expect(out.join('\n')).toContain('── ReviewReport r r1 ──\n(unavailable: not_found)')
    expect((c.taskResult as { outputs: { result: { value: { evidence: unknown[] } } } }).outputs.result.value.evidence).toEqual([prd[0]!.ref])
    // an older form (references only) still records the reviewed artifact as evidence
    c = await askForm({ cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l), ask: scripted(['y', '']) }, { instructions: 'Approve?', inputs: { prd: { kind: 'artifact', ref: prd[0]!.ref } }, outputs: { result } }, 'tr')
    expect((c.taskResult as { outputs: { result: { value: { evidence: unknown[] } } } }).outputs.result.value.evidence).toEqual([prd[0]!.ref])
  })

  it('complete on an unknown TaskRun is not found', async () => {
    await run('init')
    expect(await run('complete', 'nope')).toBe(1)
    expect(err.at(-1)).toMatch(/not found/)
  })
})

