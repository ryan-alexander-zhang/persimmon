// The ParityLedger computed from what the Tasks answered (40-pack-rewrite.md): the JPetStore example's Slice reproduced, then
// one change per account rule, per Oracle, per difference and per verdict, and every input a review found passing a lost rule.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'
import { cites, computeLedger } from '../../adapters/parity/ledger.mjs'

const root = join(import.meta.dirname, '..', '..')
const docs = parseAllDocuments(readFileSync(join(root, 'docs/design/examples/rewrite-jpetstore.yaml'), 'utf8')).map((d) => d.toJS())
const named = (name: string) => structuredClone(docs.find((d) => d.metadata.name === name).spec.content)

const expected = named('jpetstore-parity.r3')
const tests: string[] = expected.answers.map((a: { test: string }) => a.test)
const observations = Object.fromEntries(expected.answers.map((a: { test: string; observed: unknown }) => [a.test, a.observed]))
const run = (status = 'passed', obs: Record<string, unknown> = observations, only = tests) => [{ level: 'app', tests: only.map((name) => ({ name, status })), observations: obs }]
const rules = {
  title: 'JPetStore rules', owner: 'shop',
  rules: [
    { id: 'BR-1', type: 'decision', statement: 's', rationale: 'r', status: 'active', source: 'inventory: GD-2' },
    { id: 'BR-2', type: 'derivation', statement: 's', rationale: 'r', status: 'active', source: 'inventory: DC-1' },
    { id: 'BR-3', type: 'constraint', statement: 's', rationale: 'r', status: 'active', source: 'inventory: ST-1' },
    { id: 'BR-4', type: 'constraint', statement: 's', rationale: 'r', status: 'active', source: 'inventory: AB-1' },
  ],
}
const lines = (...ns: number[]) => Object.fromEntries(ns.map((n) => [n, { hits: 1 }]))
const coverage = {
  'src/main/java/org/mybatis/jpetstore/web/controllers/CartController.java': lines(59, 76, 100),
  'src/main/java/org/mybatis/jpetstore/service/CatalogService.java': { 152: { hits: 3, branches: { covered: 2, total: 2 } } },
  'src/main/java/org/mybatis/jpetstore/service/OrderService.java': lines(82, 88),
  'src/main/java/org/mybatis/jpetstore/domain/Order.java': lines(658),
  'src/main/resources/org/mybatis/jpetstore/mapper/SequenceMapper.xml': lines(12),
}
const killed = (ref: string, failed: string[]) => ({ ref, result: 'killed', failed })
const mutants = [killed('GD-2', ['test_EP2_GD2_add_in_stock']), killed('DC-1', ['test_EP3_DC1_order_ids_follow_the_sequence']), killed('ST-1', ['test_EP3_ST1_line_items_numbered_from_1'])]
const decisions = { approved: true, findings: [], dispositions: [{ ref: 'AB-1', disposition: 'change' }], dead: [], plumbing: ['PP-1'], accepted: [], readers: [] }
const slice = (over: Record<string, any> = {}) =>
  computeLedger({
    inventory: named('jpetstore-inventory.r2'), inventoryRef: { id: 'jpetstore-inventory', revision: 2 }, last: named('jpetstore-parity.r1'), slice: 'SL-1',
    decisions, suite: expected.suite, runs: run(), coverage, mutants, rules, rulesRef: { id: 'jpetstore-rules', revision: 1 }, ...over,
  })
const item = (ledger: any, ref: string) => ledger.items.find((i: { ref: string }) => i.ref === ref)

describe('cites', () => {
  it('reads an id in a test name as a whole word, with a hyphen, an underscore or nothing between', () => {
    expect([cites('test_EP2_x', 'EP-2'), cites('EP-2 adds', 'EP-2'), cites('ep_EP_2', 'EP-2'), cites('GD2', 'GD-2')]).toEqual([true, true, true, true])
    expect([cites('test_GD21_x', 'GD-2'), cites('test_XEP2', 'EP-2'), cites('test_EP2A', 'EP-2')]).toEqual([false, false, false])
  })
})

describe('computeLedger', () => {
  it('the Survey revision holds the human\'s cut and nothing else', () => {
    expect(computeLedger({ inventory: named('jpetstore-inventory.r1'), inventoryRef: { id: 'jpetstore-inventory', revision: 1 }, decisions: { slices: named('jpetstore-parity.r1').slices } })).toEqual(named('jpetstore-parity.r1'))
    expect(() => computeLedger({ inventory: named('jpetstore-inventory.r1') } as any)).toThrow(/inventoryRef is required/)
  })

  it('reproduces the example Slice after recovery: every item complete, the Oracle running, the verdict pass', () => {
    expect(slice()).toEqual(expected)
  })

  it('a volatile guard pins only when the suite controls its clock or seed', () => {
    const inventory = named('jpetstore-inventory.r2')
    inventory.guards.find((g: { id: string }) => g.id === 'GD-2').volatile = ['time']
    expect(item(slice({ inventory }), 'GD-2')).toMatchObject({ pinnable: false, account: 'unverified' })
    expect(item(slice({ inventory, suite: { ...expected.suite, controlled: ['GD-2'] } }), 'GD-2')).toMatchObject({ pinnable: true, account: 'complete' })
  })

  it('a covered line is reached, not pinned: a surviving mutant leaves a ruled guard open; no mutant run says so', () => {
    expect(item(slice({ mutants: [{ ref: 'GD-2', result: 'survived', failed: [] }] }), 'GD-2')).toMatchObject({ reached: true, mutant: 'survived', account: 'open', reason: 'its mutant survived' })
    expect(item(slice({ mutants: [] }), 'GD-2')).toMatchObject({ mutant: 'none', account: 'open', reason: 'no mutant run' })
  })

  it('a mutant killed only by tests that do not cite the item pins nothing, nor does one killed where coverage cannot say', () => {
    const byOthers = slice({ mutants: [killed('GD-2', ['test_EP2_other']), mutants[1], mutants[2]] })
    expect(item(byOthers, 'GD-2')).toMatchObject({ mutant: 'killed', account: 'open', reason: 'its mutant was killed by no test that cites it' })
    expect(byOthers.verdict.result).toBe('fail')
    const unmeasured = slice({ coverage: {} })
    expect(item(unmeasured, 'GD-2')).toMatchObject({ account: 'unverified', reason: 'its Oracle cannot pin it' })
    expect(unmeasured.verdict.result).toBe('concerns')
  })

  it('of several mutants of one item, a kill by a citing test counts whatever order they came in', () => {
    const many = [{ ref: 'GD-2', result: 'invalid', failed: [], reason: 'off the line' }, { ref: 'GD-2', result: 'survived', failed: [] }, ...mutants]
    expect(item(slice({ mutants: many }), 'GD-2')).toMatchObject({ mutant: 'killed', pinned: true, account: 'complete' })
  })

  it('a mutant killed by a test that was red on the source pins nothing', () => {
    const red = [{ level: 'app', tests: tests.map((name) => ({ name, status: name === 'test_EP3_DC1_order_ids_follow_the_sequence' ? 'failed' : 'passed' })), observations }]
    expect(item(slice({ runs: red }), 'DC-1')).toMatchObject({ mutant: 'killed', account: 'open', reason: 'its mutant was killed by no test that cites it' })
  })

  it('a red source test citing nothing is counted at the Slice\'s first entry point; a test that observed nothing makes the verdict concerns at best', () => {
    const smoke = [{ level: 'app', tests: [...tests.map((name) => ({ name, status: 'passed' })), { name: 'test_smoke', status: 'errored' }], observations }]
    expect(slice({ runs: smoke }).unreached).toEqual([{ ref: 'EP-1', slice: 'SL-1', why: 'test_smoke errored on the source: the characterization is broken there' }])
    const blind = slice({ runs: run('passed', {}) })
    expect(blind.unreached).toHaveLength(6)
    expect(blind.unreached[0]).toEqual({ ref: 'EP-1', slice: 'SL-1', why: 'test_EP1_view_empty_cart observed nothing: it rests on its status alone' })
    expect(blind.verdict.result).toBe('concerns')
  })

  it('a difference an Issue explains keeps that cause while it persists', () => {
    const rewrite = { runs: run('passed', { ...observations, test_EP2_GD2_add_in_stock: { lines: {}, subtotal: '0.00' } }) }
    const differs = slice({ last: slice(), rewrite })
    differs.differences[0].cause = { issue: 'jpetstore-issue-1' }
    expect(slice({ last: differs, rewrite }).differences[0].cause).toEqual({ issue: 'jpetstore-issue-1' })
    expect(slice({ last: differs, rewrite: { runs: run() } }).differences).toEqual([]) // fixed: the difference and its cause are gone
  })

  it('a where only a database holds is never measured: its declaration is unverified at best, never complete', () => {
    const inventory = named('jpetstore-inventory.r2')
    inventory.declarations[0].where = [{ in: 'db', locator: 'sequence ordernum' }]
    expect(item(slice({ inventory }), 'DC-1')).toMatchObject({ reached: false, account: 'unverified', reason: 'its Oracle cannot pin it' })
  })

  it('before recovery a guard no rule cites is open; a dead, dropped or accepted one is decided', () => {
    expect(item(slice({ rules: undefined }), 'GD-2')).toMatchObject({ rules: [], account: 'open', reason: 'no rule cites it' })
    expect(item(slice({ rules: undefined, decisions: { dead: [{ ref: 'GD-2', evidence: 'stock is never negative' }] } }), 'GD-2')).toMatchObject({ account: 'complete', dead: 'stock is never negative' })
    expect(item(slice({ decisions: { dispositions: [{ ref: 'BR-1', disposition: 'drop' }] }, mutants: [] }), 'GD-2')).toMatchObject({ disposition: 'drop', account: 'complete' })
    expect(item(slice({ decisions: { accepted: [{ ref: 'GD-2', reason: 'needs a clock we cannot set' }] }, mutants: [] }), 'GD-2')).toMatchObject({ account: 'unverified', reason: 'accepted open' })
  })

  it('a drop decided on a deprecated rule never outvotes an active rule that keeps the item', () => {
    const both = { ...rules, rules: [...rules.rules, { id: 'BR-9', type: 'decision', statement: 's', rationale: 'r', status: 'deprecated', source: 'inventory: GD-2' }] }
    const ledger = slice({ rules: both, decisions: { ...decisions, dispositions: [...decisions.dispositions, { ref: 'BR-9', disposition: 'drop' }] }, mutants: [] })
    expect(item(ledger, 'GD-2')).toMatchObject({ rules: ['BR-1'], account: 'open' })
    expect(item(ledger, 'GD-2').disposition).toBeUndefined()
  })

  it('a plumbing guard is complete under an accepted pattern only; an absence only with a Disposition', () => {
    expect(item(slice({ decisions: { ...decisions, plumbing: [] } }), 'GD-1')).toMatchObject({ account: 'open', reason: 'its plumbing pattern is not accepted' })
    expect(item(slice({ decisions: { plumbing: ['PP-1'] } }), 'AB-1')).toMatchObject({ account: 'open', reason: 'no Disposition decided' })
  })

  it('an item the inventory no longer lists stays, open, until a human decides it', () => {
    const recovered = slice()
    const inventory = named('jpetstore-inventory.r2')
    inventory.guards.splice(1, 1)
    const next = slice({ inventory, last: recovered })
    expect(item(next, 'GD-2')).toMatchObject({ account: 'open', reason: 'the inventory no longer lists it' })
    expect(next.verdict.result).toBe('fail')
  })

  it('without a run on the source the Oracle is static: ruled items are unverified, the entry points unreached, the verdict concerns', () => {
    const ledger = slice({ runs: [], coverage: undefined, mutants: [] })
    expect(ledger.entryPoints.map((e: { oracle: string }) => e.oracle)).toEqual(['static', 'static', 'static'])
    expect(item(ledger, 'GD-2')).toMatchObject({ account: 'unverified', reason: 'its Oracle cannot pin it' })
    expect(ledger.unreached.map((u: { ref: string }) => u.ref)).toEqual(['EP-1', 'EP-2', 'EP-3'])
    expect(ledger.verdict.result).toBe('concerns')
  })

  it('a test red on the source witnesses nothing: its entry point is unreached', () => {
    const red = [{ level: 'app', tests: tests.map((name) => ({ name, status: name === 'test_EP1_view_empty_cart' ? 'failed' : 'passed' })), observations }]
    const ledger = slice({ runs: red })
    expect(ledger.unreached).toEqual([
      { ref: 'EP-1', slice: 'SL-1', why: 'no test passed on the source, its units or its records' },
      { ref: 'EP-1', slice: 'SL-1', why: 'test_EP1_view_empty_cart failed on the source: the characterization is broken there' },
    ])
    expect(ledger.answers.map((a: { test: string }) => a.test)).not.toContain('test_EP1_view_empty_cart')
  })

  it('records every test that passed on the source once, observed or not, and never edits it', () => {
    const blind = slice({ runs: run('passed', {}) })
    expect(blind.answers).toEqual(tests.map((test) => ({ test, observed: null })))
    const recovered = slice()
    expect(slice({ last: recovered, runs: run('passed', { ...observations, test_EP2_GD2_add_in_stock: { changed: true } }) }).answers).toEqual(recovered.answers)
  })

  it('on the rewrite: a test that failed, did not run, or observed otherwise is a difference, even with no observations at all', () => {
    const recovered = slice()
    const failing = slice({ last: recovered, rewrite: { runs: run('failed', {}) } })
    expect(failing.differences.map((d: { test: string; rewrite: unknown }) => [d.test, d.rewrite])).toEqual(tests.map((t) => [t, 'failed']))
    expect(failing.verdict.result).toBe('fail')
    const blind = slice({ runs: run('passed', {}) })
    expect(slice({ last: blind, runs: run('passed', {}), rewrite: { runs: run('failed', {}) } }).differences).toHaveLength(6) // no observation recorded, the status still decides
    const partial = slice({ last: recovered, rewrite: { runs: run('passed', observations, ['test_EP2_GD2_add_in_stock']) } })
    expect(partial.differences.map((d: { rewrite: unknown }) => d.rewrite)).toEqual(['not run', 'not run', 'not run', 'not run', 'not run'])
    const other = slice({ last: recovered, rewrite: { runs: run('passed', { ...observations, test_EP2_GD2_add_in_stock: { lines: {}, subtotal: '0.00' } }) } })
    expect(other.differences).toEqual([{ test: 'test_EP2_GD2_add_in_stock', source: observations.test_EP2_GD2_add_in_stock, rewrite: { lines: {}, subtotal: '0.00' } }])
  })

  it('a guard whose rule a human changed is accounted for by the change, though the new rule cites a decision, not the item', () => {
    const changed = { ...rules, rules: [{ ...rules.rules[0], status: 'deprecated' }, ...rules.rules.slice(1), { id: 'BR-5', type: 'decision', statement: 's', rationale: 'r', status: 'active', source: 'decision: stock no longer checked' }] }
    const ledger = slice({ rules: changed, decisions: { ...decisions, dispositions: [...decisions.dispositions, { ref: 'BR-1', disposition: 'change' }] } })
    expect(item(ledger, 'GD-2')).toMatchObject({ disposition: 'change', account: 'complete' })
  })

  it('a stage that measures nothing carries the last revision\'s measurements and recomputes only the accounts', () => {
    const characterized = slice({ rules: undefined, rulesRef: undefined, decisions: {} })
    expect(characterized.verdict.result).toBe('fail') // no rule recovered yet
    expect(slice({ last: characterized, runs: undefined, coverage: undefined, mutants: undefined })).toEqual(expected)
    const red = slice({ runs: [{ level: 'app', tests: [...tests.map((name) => ({ name, status: 'passed' })), { name: 'test_EP2_broken', status: 'failed' }], observations }] })
    expect(slice({ last: red, runs: undefined, coverage: undefined, mutants: undefined }).unreached).toEqual(red.unreached) // a red test's entry stays
  })

  it('a record runs on the rewrite only: its test holds the entry point\'s Oracle, and one not green there is a difference', () => {
    const records = [{ level: 'records', tests: [{ name: 'test_EP1_record_7', status: 'passed' }, { name: 'test_EP2_record_8', status: 'failed' }], observations: {} }]
    const ledger = slice({ runs: [], rewrite: { runs: records } })
    expect(ledger.entryPoints.filter((e: { id: string }) => ['EP-1', 'EP-2'].includes(e.id))).toEqual([{ id: 'EP-1', oracle: 'recorded' }, { id: 'EP-2', oracle: 'recorded' }])
    expect(ledger.differences).toEqual([{ test: 'test_EP2_record_8', source: 'recorded', rewrite: 'failed' }])
    expect(slice({ runs: [] }).entryPoints.find((e: { id: string }) => e.id === 'EP-1').oracle).toBe('static') // before a rewrite ran, no record has
  })

  it('a difference is explained by a change or drop of a rule whose item the test cites; one revision\'s differences never vanish in the next', () => {
    const recovered = slice()
    const rewrite = { runs: run('passed', { ...observations, test_EP2_GD2_add_in_stock: { lines: {}, subtotal: '0.00' } }) }
    const changed = slice({ last: recovered, rewrite, decisions: { ...decisions, dispositions: [...decisions.dispositions, { ref: 'BR-1', disposition: 'change' }] } })
    expect(changed.differences[0].cause).toEqual({ rule: 'BR-1' })
    expect(changed.verdict.result).toBe('pass')
    const differs = slice({ last: recovered, rewrite })
    const rerun = slice({ last: differs, rewrite: { runs: run('passed', observations, ['test_EP1_view_empty_cart']) } })
    expect(rerun.differences.map((d: { test: string }) => d.test)).toContain('test_EP2_GD2_add_in_stock') // not rerun is a difference still
  })

  it('a later stage keeps every earlier decision: parity recomputes with the recovery\'s Dispositions and plumbing', () => {
    const recovered = slice()
    const atParity = slice({ last: recovered, decisions: { approved: true, findings: [], driver: { confirmed: true } }, rewrite: { runs: run() } })
    expect(item(atParity, 'AB-1')).toMatchObject({ disposition: 'change', account: 'complete' })
    expect(item(atParity, 'GD-1')).toMatchObject({ plumbing: 'PP-1', account: 'complete' })
    expect(atParity.verdict.result).toBe('pass')
    const overruled = slice({ last: recovered, decisions: { dispositions: [{ ref: 'AB-1', disposition: 'drop' }] } })
    expect(overruled.decisions.dispositions).toEqual([{ ref: 'AB-1', disposition: 'drop' }]) // a later decision on the same ref replaces it
  })

  it('a later Slice\'s decision on an earlier Slice\'s item recomputes its account; its measurements and rules carry', () => {
    const open = slice({ mutants: [] })
    expect(item(open, 'GD-2').account).toBe('open')
    open.slices.push({ id: 'SL-3', name: 'again', entryPoints: ['EP-2'], order: 3 })
    const next = computeLedger({ inventory: named('jpetstore-inventory.r2'), inventoryRef: { id: 'jpetstore-inventory', revision: 3 }, last: open, slice: 'SL-3', runs: [], mutants: [], decisions: { dead: [{ ref: 'GD-2', evidence: 'no input reaches it' }] } })
    expect(item(next, 'GD-2')).toMatchObject({ slice: 'SL-1', account: 'complete', dead: 'no input reaches it', rules: item(open, 'GD-2').rules, reached: item(open, 'GD-2').reached })
  })

  it('an item keeps the Slice whose inventory first listed it', () => {
    const ledger = slice()
    ledger.slices.push({ id: 'SL-3', name: 'again', entryPoints: ['EP-2'], order: 3 })
    const next = computeLedger({ inventory: named('jpetstore-inventory.r2'), inventoryRef: { id: 'jpetstore-inventory', revision: 3 }, last: ledger, slice: 'SL-3', runs: [], mutants: [] })
    expect(next.items.filter((i: { slice: string }) => i.slice === 'SL-3')).toEqual([])
    expect(next.items).toEqual(ledger.items)
  })
})
