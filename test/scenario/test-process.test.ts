// End to end on SQLite: the Test process (39-test-process.md) over the worked example. The Tester sets up the harness and
// writes the api tests, the builder the code and its unit tests, all as humans answering forms (cli-human/v1); the harness's
// commands copy what each wrote into the JUnit XML, so a test "runs" as the file says. The auditor and the test designer are
// humans too, by Namespace overrides.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, parseAllDocuments, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'

const domain = parseAllDocuments(readFileSync('docs/design/examples/sdlc-domain.yaml', 'utf8')).map((d) => d.toJS())
const one = (kind: string) => domain.find((d) => d.kind === kind)

// a level's command: its JUnit XML is the file the test writer left, `<from>`; none written, no test read
const copy = (from: string, to: string) => [process.execPath, '-e', `const fs = require('node:fs'); if (fs.existsSync('${from}')) fs.copyFileSync('${from}', '${to}')`]
const xml = (...cases: [string, string?][]) => `<testsuites><testsuite>${cases.map(([name, failure]) => `<testcase classname="t" name="${name}">${failure ? `<failure message="${failure}"/>` : ''}</testcase>`).join('')}</testsuite></testsuites>`
const harness = {
  architecture: 'expense-claims-architecture',
  levels: {
    unit: { tool: 'node', run: copy('unit.xml', 'junit.xml'), one: ['node', '{test}'], junit: 'junit.xml', testDir: 'test', seed: 'seed > a drafted claim starts with no lines', conventions: 'the title opens with the case id' },
    api: { tool: 'node', run: copy('api.xml', 'junit-api.xml'), one: ['node', '{test}'], junit: 'junit-api.xml', testDir: 'api', seed: 'the app answers its health check', conventions: 'the title opens with the case id' },
  },
  app: { start: ['npm', 'run', 'dev'], ready: 'http://localhost:3996/health' },
  openQuestions: [],
}
const seeds: [string][] = [['seed > a drafted claim starts with no lines']]
const apiSeed: [string][] = [['the app answers its health check']]
const pass = { kind: 'value', value: { passed: true, findings: [], evidence: [] } }

describe('scenario: the Test process', () => {
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
  const designs = `designs={kind: artifacts, refs: [{apiVersion: sdd.persimmon.ai/v1, kind: Design, id: claims-api, revision: 1}]}`
  const inbox = () => readdirSync(join(dir, '.persimmon', 'inbox'))
  // the one parked form, read; then answered with `outputs`
  const form = () => {
    expect(inbox()).toHaveLength(1)
    const taskRun = inbox()[0]!.replace(/\.yaml$/, '')
    return { ...parse(readFileSync(join(dir, '.persimmon', 'inbox', `${taskRun}.yaml`), 'utf8')), taskRun }
  }
  const answer = async (taskRun: string, outputs: Record<string, unknown>) => {
    out = []
    expect([await run('complete', taskRun, '--file', file(`${taskRun}.answer.yaml`, [{ outputs }])), out.filter((l) => l.startsWith('ERR'))]).toEqual([0, []])
  }
  const human = (name: string) => ({ apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name, namespace: 'default' }, spec: { type: 'human', adapter: 'cli-human/v1', configuration: {} } })
  const setup = async (kinds: string[]) => {
    expect(await run('init')).toBe(0)
    for (const [i, kind] of kinds.entries()) expect(await run('create', file(`upstream-${i}.yaml`, [one(kind)]))).toBe(0)
    expect(await run('apply', file('humans.yaml', [human('auditor'), human('test-design-agent')]), '-n', 'default')).toBe(0)
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-test-process-'))
    repo = mkdtempSync(join(tmpdir(), 'persimmon-test-process-repo-'))
    out = []
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  })

  it('setup-tests: the Tester records the harness, each level runs once and its seed test passes', { timeout: 60_000 }, async () => {
    await setup(['Architecture', 'Design'])
    writeFileSync(join(repo, 'unit.xml'), xml(...seeds)) // the seed tests the Tester wrote
    out = []
    expect(await run('run', 'setup-tests', '--input', `architecture=${ref('Architecture', 'expense-claims-architecture')}`, '--input', designs, '--input', `repository=${repo}`, '--follow')).toBe(0)
    let f = form()
    expect(f.reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'Architecture', 'Design']) // the harness rules, the Architecture's testing concepts, the Designs
    expect(f.outputIds).toEqual({ harness: 'expense-claims-architecture-harness' })
    await answer(f.taskRun, { harness }) // round one: no api seed test yet
    f = form()
    expect(f.inputs.feedback.value.results.evidence.findings.map((x: { code: string }) => x.code)).toEqual(['suite-empty'])
    writeFileSync(join(repo, 'api.xml'), xml(...apiSeed))
    await answer(f.taskRun, { harness })
    f = form() // the seed tests pass: the human confirms the harness
    expect(f.reading.map((r: { kind: string }) => r.kind)).toEqual(['TestHarness', 'Architecture'])
    await answer(f.taskRun, { result: pass })
    expect(out.find((l) => l.startsWith('WorkflowRun   setup-tests-'))).toMatch(/Succeeded/)
    out = []
    expect(await run('get', 'TestOutcome/expense-claims-architecture-harness-seed-levels-1')).toBe(0)
    expect(out.join('\n')).toMatch(/level: api/)
  })

  it('test-design-one: the cases are checked, audited and confirmed by a human before any code', { timeout: 60_000 }, async () => {
    await setup(['Spec', 'Plan', 'Architecture', 'Design', 'Glossary', 'BusinessRules', 'TestHarness'])
    out = []
    expect(await run('run', 'test-design-one', '--input', `spec=${ref('Spec', 'submit-a-claim')}`, '--input', `plan=${ref('Plan', 'submit-a-claim-plan')}`, '--input', `architecture=${ref('Architecture', 'expense-claims-architecture')}`, '--input', designs,
      '--input', `glossary=${ref('Glossary', 'expenses-glossary')}`, '--input', `rules=${ref('BusinessRules', 'expenses-rules')}`, '--input', `harness=${ref('TestHarness', 'expense-claims-architecture-harness')}`, '--follow')).toBe(0)
    let f = form()
    expect(f.outputIds).toEqual({ testDesign: 'submit-a-claim-tests' })
    const cases = structuredClone(one('TestDesign').spec.content)
    const short = { ...cases, cases: cases.cases.filter((c: { id: string }) => c.id !== 'TC-10') } // QS-3 has no case
    await answer(f.taskRun, { testDesign: short })
    f = form() // the check refused: round two, the designer again, no auditor call
    expect(f.inputs.feedback.value.results.consistency.findings.map((x: { message: string }) => x.message)).toEqual(['quality scenario QS-3 is proven at build but no case verifies it'])
    await answer(f.taskRun, { testDesign: cases })
    f = form()
    expect(f.reading.map((r: { kind: string }) => r.kind)[0]).toBe('Prompt') // the auditor, with the draft audit rules
    await answer(f.taskRun, { audit: pass })
    f = form()
    expect(f.reading.map((r: { kind: string }) => r.kind)).toEqual(['TestDesign', 'Spec']) // the human reads the cases beside the Spec
    await answer(f.taskRun, { result: pass })
    expect(out.find((l) => l.startsWith('WorkflowRun   test-design-one-'))).toMatch(/Succeeded/)
  })

  it('build-all under a TestDesign: the Tester writes the api tests, the builder the code, the Gate reads by case, a TestReport follows', { timeout: 90_000 }, async () => {
    await setup(['Plan', 'Spec', 'Architecture', 'Design', 'Glossary', 'BusinessRules', 'TestDesign'])
    expect(await run('create', file('harness.yaml', [{ ...one('TestHarness'), spec: { identity: { id: 'expense-claims-architecture-harness', revision: 1 }, content: harness } }]))).toBe(0)
    writeFileSync(join(repo, 'unit.xml'), xml(...seeds))
    writeFileSync(join(repo, 'api.xml'), xml(...apiSeed))
    out = []
    expect(await run('run', 'build-all', '--input', `plan=${ref('Plan', 'submit-a-claim-plan')}`, '--input', 'tasks=[T-1]', '--input', `spec=${ref('Spec', 'submit-a-claim')}`, '--input', `architecture=${ref('Architecture', 'expense-claims-architecture')}`,
      '--input', designs, '--input', `glossary=${ref('Glossary', 'expenses-glossary')}`, '--input', `rules=${ref('BusinessRules', 'expenses-rules')}`, '--input', `repository=${repo}`,
      '--input', `testDesign=${ref('TestDesign', 'submit-a-claim-tests')}`, '--input', `harness=${ref('TestHarness', 'expense-claims-architecture-harness')}`, '--follow')).toBe(0)

    // round one: the Tester writes T-1's api cases before the code, and misses TC-10
    let f = form()
    expect(f.inputs.cases.value).toEqual({ unit: ['CAP-1/TC-3', 'CAP-1/TC-8', 'CAP-1/TC-9'], integration: [], api: ['CAP-1/TC-1', 'CAP-1/TC-10'], e2e: [], manual: [], write: { api: true, e2e: false } })
    expect(f.reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'TestDesign', 'TestHarness', 'Plan', 'Spec', 'Design'])
    writeFileSync(join(repo, 'api.xml'), xml(...apiSeed, ['CAP-1/TC-1 a meals line without a receipt keeps the claim not complete']))
    await answer(f.taskRun, { written: { kind: 'value', value: { files: ['api.xml'], cases: ['CAP-1/TC-1'] } } })
    f = form() // the builder: the cases, what the Tester wrote, the harness
    expect(f.inputs.written.value.cases).toEqual(['CAP-1/TC-1'])
    expect(f.reading.map((r: { kind: string }) => r.kind).slice(-3)).toEqual(['TestOutcome', 'TestDesign', 'TestHarness'])
    const units: [string][] = [['CAP-1/TC-3 a per diem line needs no receipt'], ['CAP-1/TC-8 drafting records each line'], ['CAP-1/TC-9 a taxi line at 25.00 EUR needs a receipt']]
    writeFileSync(join(repo, 'unit.xml'), xml(...seeds, ...units))
    const { verifies, ...record } = one('AcceptanceRecord').spec.content // no rows: the test names carry the case ids
    expect(verifies).toHaveLength(5)
    await answer(f.taskRun, { record })
    f = form()
    expect(f.reading.map((r: { kind: string }) => r.kind).at(-1)).toBe('TestDesign') // the auditor judges by case
    await answer(f.taskRun, { audit: pass })

    // round two: the finding names TC-10, so the Tester writes again; the builder rebuilds against it
    f = form()
    expect(f.inputs.feedback.value.results.evidence.findings.map((x: { code: string; message: string }) => [x.code, x.message])).toEqual([['case-untested', 'CAP-1/TC-10: no api test carries it: a request naming another employee\'s claim is refused and logged']])
    expect(f.inputs.cases.value.write).toEqual({ api: true, e2e: false })
    const apis: [string][] = ['TC-1', 'TC-10'].map((c) => [`CAP-1/${c} as designed`]) // T-1's only: T-2 to T-4 are not built
    writeFileSync(join(repo, 'api.xml'), xml(...apiSeed, ...apis))
    await answer(f.taskRun, { written: { kind: 'value', value: { files: ['api.xml'], cases: ['CAP-1/TC-1', 'CAP-1/TC-10'] } } })
    await answer(form().taskRun, { record })
    await answer(form().taskRun, { audit: pass })

    // the plan tier: unit in full, every level; the auditor's evaluation, then the computed report
    f = form()
    expect(f.reading.map((r: { kind: string }) => r.kind)).toEqual(['TestDesign', 'Plan', 'TestOutcome', 'TestOutcome', 'AcceptanceRecord']) // the cases, the plan tier's levels, the records
    await answer(f.taskRun, { evaluation: { kind: 'value', value: { summary: 'Every case of CAP-1 ran green at its level.', residualRisks: [] } } })
    expect(out.find((l) => l.startsWith('WorkflowRun   build-all-'))).toMatch(/Succeeded/)
    out = []
    expect(await run('get', 'TestOutcome/submit-a-claim-plan-final')).toBe(0)
    expect(out.join('\n')).toContain('the TestReport reads every case')
    out = []
    expect(await run('get', 'TestReport/submit-a-claim-plan-test-report')).toBe(0)
    const text = out.join('\n')
    expect(text).toMatch(/result: pass/)
    expect(text).toContain('P0 100%, P1 100%, all 100% ok')
    expect(text).toMatch(/case: CAP-1\/TC-2\s*\n(.*\n)*?\s*reason: task not built/) // T-2's case, out of the verdict
    expect(text).toMatch(/actor:\s*\n\s*kind: service\s*\n\s*id: testdesign\/v1/) // computed, not written
  })
})
