// End to end on SQLite: build-one, then build-all, over T-1 of the worked example (35-build-process.md). The builder is the human
// (cli-human/v1, answered with `persimmon complete --file`), the tests run on junit/v1 with a Namespace override of
// test-runner, the auditor is a human too by an override of auditor, and build-gate checks the record against the
// tests and the audit: round one is refused by both, round two passes.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, parseAllDocuments, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'

const domain = parseAllDocuments(readFileSync('docs/design/examples/sdlc-domain.yaml', 'utf8')).map((d) => d.toJS())
const one = (kind: string) => domain.find((d) => d.kind === kind)

describe('scenario: build a Plan task', () => {
  let dir: string
  let repo: string
  let out: string[]
  const cli = () => ({ cwd: dir, out: (l: string) => out.push(l), err: (l: string) => out.push(`ERR ${l}`) })
  const run = (...argv: string[]) => runCli(argv, cli())
  const file = (name: string, docs: unknown[]) => {
    const p = join(dir, name)
    writeFileSync(p, docs.map((d) => stringify(d)).join('---\n'))
    return p
  }
  const ref = (kind: string, id: string) => `{kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: ${kind}, id: ${id}, revision: 1}}`
  const inbox = () => readdirSync(join(dir, '.persimmon', 'inbox'))
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-build-'))
    repo = mkdtempSync(join(tmpdir(), 'persimmon-build-repo-'))
    out = []
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  })

  // init, the upstream, a test-runner writing the five T-1 tests passing (and `extra` cases), a human auditor
  const setup = async (extra = '') => {
    expect(await run('init')).toBe(0)
    const upstream = ['Plan', 'Spec', 'Architecture', 'Design', 'Glossary', 'BusinessRules'].map(one)
    for (const [i, doc] of upstream.entries()) expect(await run('create', file(`upstream-${i}.yaml`, [doc]))).toBe(0) // create stores one document
        const junit = '<testsuites><testsuite name="claim"><testcase classname="test/claim.test.ts" name="claim &gt; a 30 EUR meals line without a receipt is not complete and names BR-2"/><testcase classname="test/claim.test.ts" name="claim &gt; a per diem line needs no receipt"/><testcase classname="test/claim.test.ts" name="claim &gt; attaching a receipt to another employee&apos;s claim by URL is refused and logged"/><testcase classname="test/claim.test.ts" name="claim &gt; drafting a claim records each line&apos;s amount, date and category"/><testcase classname="test/claim.test.ts" name="claim &gt; a 25.00 EUR taxi line without a receipt is not complete and names BR-2"/>' + extra + '</testsuite></testsuites>'
    const runner = { apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name: 'test-runner', namespace: 'default' }, spec: { type: 'script', adapter: 'junit/v1', configuration: { program: [process.execPath, '-e', `require('node:fs').writeFileSync('junit.xml', ${JSON.stringify(junit)})`], junit: 'junit.xml' } } }
    expect(await run('apply', file('runner.yaml', [runner]), '-n', 'default')).toBe(0)
    const auditor = { apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name: 'auditor', namespace: 'default' }, spec: { type: 'human', adapter: 'cli-human/v1', configuration: {} } }
    expect(await run('apply', file('auditor.yaml', [auditor]), '-n', 'default')).toBe(0)
  }
  const audit = async (name: string, findings: unknown[]) => {
    expect(inbox()).toHaveLength(1)
    const t = inbox()[0]!.replace(/\.yaml$/, '')
    expect(parse(readFileSync(join(dir, '.persimmon', 'inbox', `${t}.yaml`), 'utf8')).reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'AcceptanceRecord', 'TestOutcome', 'Plan', 'Spec', 'Architecture'])
    expect([await run('complete', t, '--file', file(name, [{ outputs: { audit: { kind: 'value', value: { passed: true, findings, evidence: [] } } } }])), out.filter((l) => l.startsWith('ERR'))]).toEqual([0, []]) // passed: true is not read
  }

  it('a refused round goes back to the builder with its findings; the second round passes', { timeout: 60_000 }, async () => {
    await setup()
    out = []
    const started = await run('run', 'build-one', '--input', `plan=${ref('Plan', 'submit-a-claim-plan')}`, '--input', 'taskId=T-1', '--input', `spec=${ref('Spec', 'submit-a-claim')}`, '--input', `architecture=${ref('Architecture', 'expense-claims-architecture')}`,
      '--input', `designs={kind: artifacts, refs: [{apiVersion: sdd.persimmon.ai/v1, kind: Design, id: claims-api, revision: 1}]}`, '--input', `glossary=${ref('Glossary', 'expenses-glossary')}`, '--input', `rules=${ref('BusinessRules', 'expenses-rules')}`, '--input', `repository=${repo}`, '--follow')
    expect(started).toBe(0)
    expect(inbox()).toHaveLength(1)
    let taskRun = inbox()[0]!.replace(/\.yaml$/, '')
    const form = parse(readFileSync(join(dir, '.persimmon', 'inbox', `${taskRun}.yaml`), 'utf8'))
    expect(form.reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'Plan', 'Spec', 'Architecture', 'Design', 'Glossary', 'BusinessRules']) // the task brief
    expect(form.outputIds).toEqual({ record: 'submit-a-claim-plan-t-1' })

    // round one: AC-3 names a test that does not exist
    const record = structuredClone(one('AcceptanceRecord').spec.content)
    const wrong = structuredClone(record)
    wrong.verifies[1].tests = ['claim > per diem']
    out = []
    expect(await run('complete', taskRun, '--file', file('r1.yaml', [{ outputs: { record: wrong } }]))).toBe(0)
    await audit('a1.yaml', [{ severity: 'error', code: 'test-unfit', message: 'AC-1: the test asserts no rule' }])
    expect(inbox()).toHaveLength(1) // round two waits on the builder
    taskRun = inbox()[0]!.replace(/\.yaml$/, '')
    const second = parse(readFileSync(join(dir, '.persimmon', 'inbox', `${taskRun}.yaml`), 'utf8'))
    expect(second.inputs.feedback.value.passed).toBe(false)
    expect(second.inputs.feedback.value.results.evidence.findings.map((f: { code: string }) => f.code)).toEqual(['test-missing']) // the findings reach the builder
    expect(second.inputs.feedback.value.results.audit).toMatchObject({ passed: false, findings: [{ code: 'test-unfit' }] }) // the auditor's too
    expect(second.inputs.previousOutcome.ref).toMatchObject({ kind: 'TestOutcome', id: 'submit-a-claim-plan-t-1-tests', revision: 1 }) // carried beside the record
    expect(second.reading.map((r: { kind: string }) => r.kind).slice(-2)).toEqual(['AcceptanceRecord', 'TestOutcome']) // the builder reads what failed

    out = []
    expect(await run('complete', taskRun, '--file', file('r2.yaml', [{ outputs: { record } }]))).toBe(0)
    out = []
    await audit('a2.yaml', [{ severity: 'warning', code: 'test-doubt', message: 'AC-3: a value close to the scenario\'s' }]) // a warning passes
    expect(out.find((l) => l.startsWith('WorkflowRun   build-one-'))).toMatch(/Succeeded/)
    out = []
    expect(await run('get', 'TestOutcome/submit-a-claim-plan-t-1-tests')).toBe(0)
    expect(out.join('\n')).toContain('exitCode: 0')
    expect(out.join('\n')).toMatch(/actor:\s*\n\s*kind: service\s*\n\s*id: junit\/v1/) // a script wrote it
    out = []
    expect(await run('get', 'AcceptanceRecord/submit-a-claim-plan-t-1')).toBe(0)
    expect(out.join('\n')).toMatch(/actor:\s*\n\s*kind: user\s*\n\s*id: local/) // the human who answered the form, not the task Handler
    out = []
    expect(await run('get', 'WorkflowRun')).toBe(0)
    const loop = out.find((l) => /^WorkflowRun\/build-one-[0-9a-f]+\s/.test(l))!.split(/\s/)[0]!
    out = []
    expect(await run('describe', loop)).toBe(0)
    expect(out.join('\n')).toMatch(/passed:\s*\n?\s*kind: value\s*\n\s*value: true|passed: \{kind: value, value: true\}/)
    expect(out.join('\n')).toMatch(/rounds:\s*\n?\s*kind: value\s*\n\s*value: 2|rounds: \{kind: value, value: 2\}/)
  })
  it('build-all takes the baseline first: a test red before the build and red still refuses nothing (35-build-process.md)', { timeout: 60_000 }, async () => {
    await setup('<testcase classname="test/legacy.test.ts" name="legacy &gt; an old export"><failure message="was red before"/></testcase>')
    out = []
    expect(await run('run', 'build-all', '--input', `plan=${ref('Plan', 'submit-a-claim-plan')}`, '--input', 'tasks=[T-1]', '--input', `spec=${ref('Spec', 'submit-a-claim')}`, '--input', `architecture=${ref('Architecture', 'expense-claims-architecture')}`,
      '--input', `designs={kind: artifacts, refs: [{apiVersion: sdd.persimmon.ai/v1, kind: Design, id: claims-api, revision: 1}]}`, '--input', `glossary=${ref('Glossary', 'expenses-glossary')}`, '--input', `rules=${ref('BusinessRules', 'expenses-rules')}`, '--input', `repository=${repo}`, '--follow')).toBe(0)
    expect(inbox()).toHaveLength(1)
    const taskRun = inbox()[0]!.replace(/\.yaml$/, '')
    const form = parse(readFileSync(join(dir, '.persimmon', 'inbox', `${taskRun}.yaml`), 'utf8'))
    expect(form.inputs.baseline.ref).toMatchObject({ kind: 'TestOutcome', id: 'submit-a-claim-plan-baseline' }) // the builder sees what was red before
    expect(form.reading.map((r: { kind: string }) => r.kind).at(-1)).toBe('TestOutcome') // in its context, not only its inputs
    expect(await run('complete', taskRun, '--file', file('r1.yaml', [{ outputs: { record: one('AcceptanceRecord').spec.content } }]))).toBe(0)
    out = []
    await audit('a1.yaml', [])
    expect(out.find((l) => l.startsWith('WorkflowRun   build-all-'))).toMatch(/Succeeded/) // one round: the old red test is tolerated
    expect(out.join('\n')).toContain('suite-baseline')
  })

  it('a defect the builder reports passes the round with a warning; the developer investigates it as an Issue (35-build-process.md)', { timeout: 60_000 }, async () => {
    await setup('<testcase classname="test/legacy.test.ts" name="legacy &gt; an old export"><failure message="was red before"/></testcase>')
    out = []
    expect(await run('run', 'build-all', '--input', `plan=${ref('Plan', 'submit-a-claim-plan')}`, '--input', 'tasks=[T-1]', '--input', `spec=${ref('Spec', 'submit-a-claim')}`, '--input', `architecture=${ref('Architecture', 'expense-claims-architecture')}`,
      '--input', `designs={kind: artifacts, refs: [{apiVersion: sdd.persimmon.ai/v1, kind: Design, id: claims-api, revision: 1}]}`, '--input', `glossary=${ref('Glossary', 'expenses-glossary')}`, '--input', `rules=${ref('BusinessRules', 'expenses-rules')}`, '--input', `repository=${repo}`, '--follow')).toBe(0)
    const taskRun = inbox()[0]!.replace(/\.yaml$/, '')
    const record = { ...one('AcceptanceRecord').spec.content, defects: [{ id: 'D-1', observed: 'the export writes no header row', expected: 'a header row (legacy > an old export)', where: 'legacy > an old export' }] }
    expect(await run('complete', taskRun, '--file', file('r1.yaml', [{ outputs: { record } }]))).toBe(0)
    out = []
    await audit('a1.yaml', [])
    expect(out.find((l) => l.startsWith('WorkflowRun   build-all-'))).toMatch(/Succeeded/) // reported, never this task's: one round
    expect(out.join('\n')).toContain('warning defect-reported: D-1 at legacy > an old export: the export writes no header row')

    const issue = (revision: number, content: Record<string, unknown>) => ({ apiVersion: 'sdd.persimmon.ai/v1', kind: 'Issue', metadata: { name: `export-header-missing.r${revision}` }, spec: { identity: { id: 'export-header-missing', revision }, content } })
    const open = {
      title: 'The export writes no header row', found: { record: 'submit-a-claim-plan-t-1', defect: 'D-1' },
      observed: 'the export writes no header row', expected: 'a header row', trigger: 'any export',
      impact: { affected: 'every export', ongoing: true, severity: 'a reader cannot tell the columns apart' },
      rootCause: { statement: 'the writer starts at the first claim', at: ['src/export.ts:12'] }, scope: [{ site: 'src/export.ts:12', affected: true }],
      reproduction: { test: 'legacy > an old export', failure: 'was red before' }, verdict: 'code-nonconformant', blocks: [{ artifact: 'submit-a-claim-plan' }], status: 'open',
    }
    expect(await run('create', file('issue-1.yaml', [issue(1, open)]))).toBe(0)
    out = []
    expect(await run('create', file('issue-2.yaml', [issue(2, { ...open, status: 'resolved' })]))).not.toBe(0) // resolved names its proof
    expect(out.join('\n')).toContain('fixedBy')
    expect(await run('create', file('issue-2.yaml', [issue(2, { ...open, status: 'resolved', fixedBy: ['submit-a-claim-plan-t-1'], detectionGap: 'no test read the header', residual: 'none' })]))).toBe(0)
  })
})
