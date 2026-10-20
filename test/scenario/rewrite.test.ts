// End to end on SQLite (40-pack-rewrite.md): the Survey, one Slice's inventory and its characterization, through the engine,
// parity-run/v1 and parity/v1 for real. The readers and the auditor are humans by a Namespace override, answered with
// `persimmon complete --file`, as the Tester is by default. The source is a git checkout beside the project; the suite runs
// it from the project, and its mutant runs in a scratch clone.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'

const cart = ['export function add(qty) {', '  if (qty > 0) {', '    return { ok: true, qty }', '  }', '  return { ok: false }', '}', ''].join('\n')
// the suite: each test through the source's code at PERSIMMON_SOURCE, its JUnit XML, its observations and an lcov report
const suite = `
import { mkdirSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const { add } = await import(pathToFileURL(process.env.PERSIMMON_SOURCE + '/src/cart.js').href)
const tests = {
  test_EP1_GD1_adds_two: () => add(2),
  test_EP1_GD1_refuses_zero: () => add(0),
}
const expected = { test_EP1_GD1_adds_two: { ok: true, qty: 2 }, test_EP1_GD1_refuses_zero: { ok: false } }
const only = process.argv[2]
const obs = {}
let cases = ''
for (const [name, run] of Object.entries(tests)) {
  if (only && name !== only) continue
  obs[name] = run()
  const same = JSON.stringify(obs[name]) === JSON.stringify(expected[name])
  cases += '<testcase name="' + name + '">' + (same ? '' : '<failure message="differs"/>') + '</testcase>'
}
mkdirSync('build', { recursive: true })
writeFileSync('build/junit.xml', '<testsuite>' + cases + '</testsuite>')
writeFileSync('build/obs.json', JSON.stringify(obs))
writeFileSync('build/lcov.info', 'SF:src/cart.js\\nDA:1,2\\nDA:2,2\\nDA:3,1\\nDA:5,1\\nend_of_record\\n')
`
const mutant = ['--- a/src/cart.js', '+++ b/src/cart.js', '@@ -2 +2 @@', '-  if (qty > 0) {', '+  if (qty >= 0) {', ''].join('\n')

describe('scenario: a rewrite survey, inventory and characterization', () => {
  let dir: string
  let source: string
  let out: string[]
  const cli = () => ({ cwd: dir, out: (l: string) => out.push(l), err: (l: string) => out.push(`ERR ${l}`) })
  const run = (...argv: string[]) => runCli(argv, cli())
  const file = (name: string, doc: unknown) => {
    const p = join(dir, name)
    writeFileSync(p, stringify(doc))
    return p
  }
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim()
  const inbox = () => readdirSync(join(dir, '.persimmon', 'inbox')).filter((f) => f.endsWith('.yaml'))
  // the one form waiting: its output ports, then the answer
  const answer = async (ports: string[], outputs: Record<string, unknown>) => {
    expect(inbox()).toHaveLength(1)
    const taskRun = inbox()[0]!.replace(/\.yaml$/, '')
    const form = parse(readFileSync(join(dir, '.persimmon', 'inbox', `${taskRun}.yaml`), 'utf8'))
    expect(Object.keys(form.outputs).sort()).toEqual([...ports].sort())
    out = []
    expect([await run('complete', taskRun, '--file', file(`${taskRun}.answer.yaml`, { outputs })), out.filter((l) => l.startsWith('ERR'))]).toEqual([0, []])
  }
  const value = (v: unknown) => ({ kind: 'value', value: v })
  const ref = (kind: string, id: string, revision: number) => `{kind: artifact, ref: {apiVersion: rewrite.persimmon.ai/v1, kind: ${kind}, id: ${id}, revision: ${revision}}}`
  const runOf = (name: string) => out.find((l) => l.startsWith(`WorkflowRun   ${name}`))

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'persimmon-rw-')))
    source = realpathSync(mkdtempSync(join(tmpdir(), 'persimmon-rw-src-')))
    mkdirSync(join(source, 'src'))
    writeFileSync(join(source, 'src', 'cart.js'), cart)
    git(source, 'init', '-q')
    git(source, 'add', '.')
    git(source, 'commit', '-qm', 'source')
    out = []
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(source, { recursive: true, force: true })
  })

  it('the Survey cuts a Slice; the Slice is inventoried and characterized, its guard pinned by a killed mutant', { timeout: 120_000 }, async () => {
    expect(await run('init', '--pack', 'rewrite')).toBe(0)
    for (const name of ['source-reader', 'second-reader', 'auditor']) {
      const human = { apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name, namespace: 'default' }, spec: { type: 'human', adapter: 'cli-human/v1', configuration: {} } }
      expect(await run('apply', file(`${name}.yaml`, human), '-n', 'default')).toBe(0)
    }
    writeFileSync(join(dir, 'suite.mjs'), suite)
    const commit = git(source, 'rev-parse', 'HEAD')
    const empty = { stateChanges: [], guards: [], declarations: [], absences: [], plumbingPatterns: [], entities: [], externalSystems: [], tests: [], unread: [], openQuestions: [] }
    const surveyed = { source: { repository: source, commit }, entryPoints: [{ id: 'EP-1', kind: 'cli', name: 'add', where: ['src/cart.js:1-6'], reaches: { files: ['src/cart.js'], entities: [], externalSystems: [] } }], ...empty }

    // the Survey: the reader, the index, the human's cut, the ledger's first revision, the gate
    out = []
    expect(await run('run', 'survey', '--input', `source=${source}`, '--input', 'brief=Rewrite the cart.', '--input', 'productId=cart', '--follow')).toBe(0)
    await answer(['inventory'], { inventory: surveyed })
    await answer(['decisions'], { decisions: value({ approved: true, findings: [], slices: [{ id: 'SL-1', name: 'adding', entryPoints: ['EP-1'], order: 1 }] }) })
    expect(runOf('survey')).toMatch(/Succeeded/)

    // the Slice's inventory: two readers, the index, the auditor
    out = []
    expect(await run('run', 'inventory', '--input', `source=${source}`, '--input', 'brief=Rewrite the cart.', '--input', 'productId=cart', '--input', 'slice=SL-1',
      '--input', `base=${ref('SourceInventory', 'cart-inventory', 1)}`, '--input', `ledger=${ref('ParityLedger', 'cart-parity', 1)}`, '--follow')).toBe(0)
    const guard = { id: 'GD-1', condition: 'qty > 0', outcome: 'added with its qty; otherwise refused', role: 'rule', where: ['src/cart.js:2-5'], in: ['EP-1'] }
    await answer(['inventory'], { inventory: { ...surveyed, slice: 'SL-1', guards: [guard] } })
    await answer(['second'], { second: value({ guards: [{ ...guard, id: 'GD-7' }] }) })
    await answer(['audit'], { audit: value({ passed: true, findings: [], evidence: [] }) })
    expect(runOf('inventory')).toMatch(/Succeeded/)

    // characterization: the Tester's suite run on the source, its mutant killed in a scratch clone, the ledger closed
    out = []
    expect(await run('run', 'characterize', '--input', `source=${source}`, '--input', `repository=${dir}`, '--input', 'brief=Rewrite the cart.', '--input', 'productId=cart', '--input', 'slice=SL-1',
      '--input', `inventory=${ref('SourceInventory', 'cart-inventory', 2)}`, '--input', `ledger=${ref('ParityLedger', 'cart-parity', 1)}`, '--follow')).toBe(0)
    const units = { tool: 'node', run: 'node suite.mjs', one: 'node suite.mjs {test}', junit: 'build/junit.xml', observations: 'build/obs.json', testDir: '.', coverage: 'build/lcov.info' }
    await answer(['written'], { written: value({ files: ['suite.mjs'], suite: { levels: { units }, drivers: { source: 'suite.mjs' }, conventions: 'one process per run' } }) })
    await answer(['mutants'], { mutants: value([{ ref: 'GD-1', patch: mutant }]) })
    await answer(['audit'], { audit: value({ passed: true, findings: [], evidence: [] }) })
    expect(runOf('characterize')).toMatch(/Succeeded/)

    out = []
    expect(await run('get', 'ParityLedger/cart-parity')).toBe(0)
    const ledger = parse(out.join('\n')).spec.content
    expect(ledger.entryPoints).toEqual([{ id: 'EP-1', oracle: 'partial' }])
    expect(ledger.items).toEqual([expect.objectContaining({ ref: 'GD-1', reached: true, pinnable: true, pinned: true, mutant: 'killed' })])
    expect(ledger.answers).toEqual([{ test: 'test_EP1_GD1_adds_two', observed: { ok: true, qty: 2 } }, { test: 'test_EP1_GD1_refuses_zero', observed: { ok: false } }])
    expect(git(source, 'status', '--porcelain')).toBe('') // the checkout never changed
  })
})
