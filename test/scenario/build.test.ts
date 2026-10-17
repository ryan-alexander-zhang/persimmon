// End to end on SQLite: build-one over T-1 of the worked example (35-build-process.md). The builder is the human
// (cli-human/v1, answered with `persimmon complete --file`), the tests run on junit/v1 with a Namespace override of
// test-runner, and build-gate checks the record against them: round one is refused, round two passes.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, parseAllDocuments, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'

const domain = parseAllDocuments(readFileSync('docs/design/examples/sdlc-domain.yaml', 'utf8')).map((d) => d.toJS())
const one = (kind: string) => domain.find((d) => d.kind === kind)

describe('scenario: build one Plan task', () => {
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

  it('a refused round goes back to the builder with its findings; the second round passes', { timeout: 60_000 }, async () => {
    expect(await run('init')).toBe(0)
    const upstream = ['Plan', 'Spec', 'Architecture', 'Design', 'Glossary', 'BusinessRules'].map(one)
    for (const [i, doc] of upstream.entries()) expect(await run('create', file(`upstream-${i}.yaml`, [doc]))).toBe(0) // create stores one document
    // the project's tests: a JUnit report with the two T-1 tests passing, as a test command would write it
    const junit = '<testsuites><testsuite name="claim"><testcase classname="test/claim.test.ts" name="claim &gt; a 30 EUR meals line without a receipt is not complete and names BR-2"/><testcase classname="test/claim.test.ts" name="claim &gt; a per diem line needs no receipt"/></testsuite></testsuites>'
    const runner = { apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name: 'test-runner', namespace: 'default' }, spec: { type: 'script', adapter: 'junit/v1', configuration: { program: [process.execPath, '-e', `require('node:fs').writeFileSync('junit.xml', ${JSON.stringify(junit)})`], junit: 'junit.xml' } } }
    expect(await run('apply', file('runner.yaml', [runner]), '-n', 'default')).toBe(0)

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
    expect(inbox()).toHaveLength(1) // round two waits on the builder
    taskRun = inbox()[0]!.replace(/\.yaml$/, '')
    const second = parse(readFileSync(join(dir, '.persimmon', 'inbox', `${taskRun}.yaml`), 'utf8'))
    expect(second.inputs.feedback.value.passed).toBe(false)
    expect(second.inputs.feedback.value.results.evidence.findings.map((f: { code: string }) => f.code)).toEqual(['test-missing']) // the findings reach the builder
    expect(second.inputs.previousOutcome.ref).toMatchObject({ kind: 'TestOutcome', id: 'submit-a-claim-plan-t-1-tests', revision: 1 }) // carried beside the record
    expect(second.reading.map((r: { kind: string }) => r.kind).slice(-2)).toEqual(['AcceptanceRecord', 'TestOutcome']) // the builder reads what failed

    out = []
    expect(await run('complete', taskRun, '--file', file('r2.yaml', [{ outputs: { record } }]))).toBe(0)
    expect(out.find((l) => l.startsWith('WorkflowRun   build-one-'))).toMatch(/Succeeded/)
    out = []
    expect(await run('get', 'TestOutcome/submit-a-claim-plan-t-1-tests')).toBe(0)
    expect(out.join('\n')).toContain('exitCode: 0')
    out = []
    expect(await run('get', 'WorkflowRun')).toBe(0)
    const loop = out.find((l) => /^WorkflowRun\/build-one-[0-9a-f]+\s/.test(l))!.split(/\s/)[0]!
    out = []
    expect(await run('describe', loop)).toBe(0)
    expect(out.join('\n')).toMatch(/passed:\s*\n?\s*kind: value\s*\n\s*value: true|passed: \{kind: value, value: true\}/)
    expect(out.join('\n')).toMatch(/rounds:\s*\n?\s*kind: value\s*\n\s*value: 2|rounds: \{kind: value, value: 2\}/)
  })
})
