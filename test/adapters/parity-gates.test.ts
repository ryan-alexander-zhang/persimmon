// The Rewrite pack's Gate checks over a computed ledger (40-pack-rewrite.md): ledger-closure at characterize-gate,
// recovery-consistency at recover-gate, parity-consistency at parity-gate; one finding code per case.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'
import { checkClosure, checkParity, checkRecovery } from '../../adapters/parity/check.mjs'
import { computeLedger } from '../../adapters/parity/ledger.mjs'

const root = join(import.meta.dirname, '..', '..')
const docs = parseAllDocuments(readFileSync(join(root, 'docs/design/examples/rewrite-jpetstore.yaml'), 'utf8')).map((d) => d.toJS())
const named = (name: string) => structuredClone(docs.find((d) => d.metadata.name === name).spec.content)
const expected = named('jpetstore-parity.r3')
const tests: string[] = expected.answers.map((a: { test: string }) => a.test)
const observations = Object.fromEntries(expected.answers.map((a: { test: string; observed: unknown }) => [a.test, a.observed]))
const runs = (obs = observations, names = tests) => [{ level: 'app', tests: names.map((name) => ({ name, status: 'passed' })), observations: obs }]
const rule = (id: string, source: string, status = 'active') => ({ id, type: 'constraint', statement: 's', rationale: 'r', status, source })
const rules = { title: 'r', owner: 'o', rules: [rule('BR-1', 'inventory: GD-2'), rule('BR-2', 'inventory: DC-1'), rule('BR-3', 'inventory: ST-1'), rule('BR-4', 'inventory: AB-1')] }
const lines = (...ns: number[]) => Object.fromEntries(ns.map((n) => [n, { hits: 1 }]))
const files = {
  'src/main/java/org/mybatis/jpetstore/web/controllers/CartController.java': lines(59, 76),
  'src/main/java/org/mybatis/jpetstore/service/CatalogService.java': { 152: { hits: 3, branches: { covered: 2, total: 2 } } },
  'src/main/java/org/mybatis/jpetstore/service/OrderService.java': lines(82, 88),
  'src/main/java/org/mybatis/jpetstore/domain/Order.java': lines(658),
  'src/main/resources/org/mybatis/jpetstore/mapper/SequenceMapper.xml': lines(12),
}
const killed = (ref: string, test: string) => ({ ref, result: 'killed', failed: [test] })
const mutants = [killed('GD-2', 'test_EP2_GD2_add_in_stock'), killed('DC-1', 'test_EP3_DC1_order_ids_follow_the_sequence'), killed('ST-1', 'test_EP3_ST1_line_items_numbered_from_1')]
const decisions = { approved: true, findings: [], dispositions: [{ ref: 'AB-1', disposition: 'change' }], dead: [], plumbing: ['PP-1'], accepted: [], readers: [] }
const ledger = (over: Record<string, any> = {}) =>
  computeLedger({ inventory: named('jpetstore-inventory.r2'), inventoryRef: { id: 'jpetstore-inventory', revision: 2 }, last: named('jpetstore-parity.r1'), slice: 'SL-1', decisions, suite: expected.suite, runs: runs(), coverage: files, mutants, rules, rulesRef: { id: 'jpetstore-rules', revision: 1 }, ...over })
const inventory = named('jpetstore-inventory.r2')
const index = { commit: inventory.source.commit, dirty: [], root: '/w/src', gitCommonDir: '/w/src/.git', project: { root: '/w/rw' }, files: Object.fromEntries(Object.keys(files).concat(['src/main/java/org/mybatis/jpetstore/domain/Cart.java', 'src/main/java/org/mybatis/jpetstore/web/controllers/OrderController.java', 'src/main/java/org/mybatis/jpetstore/domain/LineItem.java', 'src/main/resources/org/mybatis/jpetstore/mapper/ItemMapper.xml', 'src/main/java/org/mybatis/jpetstore/web/controllers/CatalogController.java', 'src/main/java/org/mybatis/jpetstore/web/controllers/AccountController.java', 'src/main/java/org/mybatis/jpetstore/service/AccountService.java', 'src/test/java/org/mybatis/jpetstore/domain/CartTest.java']).map((p) => [p, { lines: 800, branchLines: [] }])) }
const codes = (found: { code: string }[]) => found.map((f) => f.code)
const closure = (over: Record<string, any> = {}, l = ledger()) => checkClosure({ ledger: l, inventory, index, coverage: { files, unmapped: [] }, runs: runs(), slice: 'SL-1', ...over })

describe('checkClosure (ledger-closure)', () => {
  it('the example Slice, every pinnable item pinned, closes', () => {
    expect(closure()).toEqual([])
  })

  it('item-open: an item its Oracle can pin that no killed mutant pins; an item no rule cites yet is no finding here', () => {
    const before = ledger({ rules: undefined, mutants: [] })
    expect(closure({}, before).map((f: { message: string }) => f.message)).toEqual(['GD-2: no mutant was run for it', 'DC-1: no mutant was run for it', 'ST-1: no mutant was run for it'])
    const survived = ledger({ rules: undefined, mutants: [{ ref: 'GD-2', result: 'survived', failed: [] }, mutants[1], mutants[2]] })
    expect(closure({}, survived).map((f: { message: string }) => f.message)).toEqual(['GD-2: its mutant survived: no test notices it change'])
  })

  it('the source placement and commit hold at the closure gate too, and a Slice id in a test name is no inventory id', () => {
    expect(codes(closure({ index: { ...index, dirty: ['src/main/java/org/mybatis/jpetstore/service/OrderService.java'] } }))).toEqual(['source-moved'])
    expect(codes(closure({ index: { ...index, project: { root: '/w' } } }))).toEqual(['source-inside-project'])
    expect(closure({ runs: runs(observations, [...tests, 'test_SL1_EP1_smoke']) })).toEqual([])
  })

  it('test-reference, coverage-unmapped, branch-uncovered from the report, expected-moved', () => {
    expect(codes(closure({ runs: runs(observations, [...tests, 'test_EP9_ghost']) }))).toEqual(['test-reference'])
    expect(codes(closure({ coverage: { files, unmapped: ['gone/Other.java'] } }))).toEqual(['coverage-unmapped'])
    const branchy = { ...files, 'src/main/java/org/mybatis/jpetstore/web/controllers/CartController.java': { 59: { hits: 1 }, 100: { hits: 2, branches: { covered: 1, total: 2 } } } }
    expect(closure({ coverage: { files: branchy, unmapped: [] } }).map((f: { message: string }) => f.message)).toEqual(['src/main/java/org/mybatis/jpetstore/web/controllers/CartController.java branches at line 100, inside no guard and no plumbing pattern'])
    expect(codes(closure({ runs: runs({ ...observations, test_EP2_GD2_add_in_stock: { lines: {}, subtotal: '9.99' } }) }))).toEqual(['expected-moved'])
  })
})

describe('checkRecovery (recovery-consistency)', () => {
  const prd = { title: 'p', capabilities: [{ id: 'CAP-1', name: 'cart', description: 'add and view (EP-1, EP-2)' }, { id: 'CAP-2', name: 'order', description: 'submit an order (EP-3)' }], nonGoals: [] as string[] }
  const recover = (over: Record<string, any> = {}) => checkRecovery({ prd, rules, inventory, ledger: ledger(), decisions, slice: 'SL-1', ...over })

  it('the example recovery is consistent', () => {
    expect(recover()).toEqual([])
  })

  it('rule-unsourced, unknown-inventory-item, capability-dropped, item-unaccounted, entry-point-uncited', () => {
    expect(codes(recover({ rules: { ...rules, rules: [...rules.rules, rule('BR-5', 'the brief')] } }))).toEqual(['rule-unsourced'])
    expect(codes(recover({ rules: { ...rules, rules: [...rules.rules, rule('BR-5', 'inventory: GD-9')] } }))).toEqual(['unknown-inventory-item'])
    expect(codes(recover({ lastPrd: { capabilities: [...prd.capabilities, { id: 'CAP-3', name: 'gone', description: '' }] } }))).toEqual(['capability-dropped'])
    expect(codes(recover({ lastPrd: { capabilities: [{ id: 'CAP-3' }] }, prd: { ...prd, nonGoals: ['CAP-3 wish lists: never used'] } }))).toEqual([])
    expect(codes(recover({ ledger: ledger({ mutants: [] }) }))).toEqual(['item-unaccounted', 'item-unaccounted', 'item-unaccounted'])
    const uncited = recover({ prd: { ...prd, capabilities: [prd.capabilities[0]!] } })
    expect(uncited.map((f: { severity: string; code: string }) => `${f.severity}:${f.code}`)).toEqual(['warning:entry-point-uncited'])
  })

  it('ids match as whole words: CAP-30 never names CAP-3, BR-10 never replaces BR-1', () => {
    expect(codes(recover({ lastPrd: { capabilities: [{ id: 'CAP-3' }] }, prd: { ...prd, nonGoals: ['CAP-30 reports: later'] } }))).toEqual(['capability-dropped'])
    const changed = { ...decisions, dispositions: [...decisions.dispositions, { ref: 'BR-1', disposition: 'change' }] }
    const wrong = { ...rules, rules: [rule('BR-1', 'inventory: GD-2', 'deprecated'), ...rules.rules.slice(1), rule('BR-5', 'decision: the owner, replaces BR-10')] }
    expect(codes(recover({ decisions: changed, rules: wrong }))).toContain('disposition-mismatch')
  })

  it('item-unaccounted sees an earlier Slice\'s open item too', () => {
    const l = ledger()
    l.items.push({ ref: 'GD-99', slice: 'SL-0', reached: false, pinnable: false, pinned: false, tests: [], rules: [], account: 'open', reason: 'the inventory no longer lists it' })
    expect(recover({ ledger: l }).map((f: { message: string }) => f.message)).toEqual(['GD-99 (SL-0) is open: the inventory no longer lists it'])
  })

  it('disposition-mismatch: a drop the Prd ignores, a change with no rule replacing it', () => {
    expect(codes(recover({ decisions: { ...decisions, dispositions: [...decisions.dispositions, { ref: 'CAP-2', disposition: 'drop' }] } }))).toContain('disposition-mismatch')
    const changed = { ...decisions, dispositions: [...decisions.dispositions, { ref: 'BR-1', disposition: 'change' }] }
    expect(codes(recover({ decisions: changed })).filter((c: string) => c === 'disposition-mismatch')).toHaveLength(2) // BR-1 still active, and nothing replaces it
    const replaced = { ...rules, rules: [rule('BR-1', 'inventory: GD-2', 'deprecated'), ...rules.rules.slice(1), rule('BR-5', 'decision: the shop owner, replaces BR-1')] }
    expect(codes(recover({ decisions: changed, rules: replaced })).filter((c: string) => c === 'disposition-mismatch')).toEqual([])
  })
})

describe('checkParity (parity-consistency)', () => {
  const recovered = ledger()
  it('a rewrite that answers as the source did passes', () => {
    expect(checkParity({ ledger: ledger({ last: recovered, rewrite: { runs: runs() } }), slice: 'SL-1' })).toEqual([])
  })

  it('parity-unexplained and parity-verdict on a difference; concerns pass only when a human accepted them', () => {
    const differs = ledger({ last: recovered, rewrite: { runs: runs({ ...observations, test_EP1_view_empty_cart: { lines: {}, subtotal: '1.00' } }) } })
    expect(codes(checkParity({ ledger: differs, slice: 'SL-1' }))).toEqual(['parity-unexplained', 'parity-verdict'])
    const concerns = ledger({ last: recovered, coverage: {}, rewrite: { runs: runs() } })
    expect(concerns.verdict.result).toBe('concerns')
    expect(codes(checkParity({ ledger: concerns, slice: 'SL-1' }))).toEqual(['parity-verdict'])
    expect(checkParity({ ledger: { ...concerns, concerns: { accepted: true, reason: 'the clock-bound guards are tested by hand in UAT' } }, slice: 'SL-1' })).toEqual([])
    expect(codes(checkParity({ ledger: { ...concerns, concerns: { accepted: true, reason: '   ' } }, slice: 'SL-1' }))).toEqual(['parity-verdict'])
  })

  it('a ledger no rewrite run was compared against never passes, nor a rewrite driver left unbound', () => {
    expect(codes(checkParity({ ledger: recovered, slice: 'SL-1' }))).toEqual(['parity-verdict'])
    const withDriver = ledger({ last: recovered, rewrite: { runs: runs() }, suite: { ...expected.suite, drivers: { source: 's.py', rewrite: 'r.py' } } })
    expect(codes(checkParity({ ledger: withDriver, slice: 'SL-1' }))).toEqual(['driver-uncited'])
  })

  it('driver-uncited: a method citing no entry point or Design element, an entry point no method maps and no non-goal names', () => {
    const passed = { ...ledger({ last: recovered, rewrite: { runs: runs() } }), driver: { confirmed: true } }
    const driver = { methods: [{ name: 'viewCart', entryPoint: 'EP-1', element: 'EL-3' }, { name: 'addItem', entryPoint: 'EP-2' }] }
    expect(checkParity({ ledger: passed, slice: 'SL-1', driver }).map((f: { message: string }) => f.message)).toEqual([
      "the rewrite driver's addItem cites EP-2 and no Design element: each method cites both",
      'EP-3 has no rewrite driver method and is no non-goal',
    ])
    expect(codes(checkParity({ ledger: passed, slice: 'SL-1', driver, prd: { nonGoals: ['EP-3 order submission moves to the new checkout'] } }))).toEqual(['driver-uncited'])
  })

  it('driver-unconfirmed: a changed interface\'s driver passes only once review-parity confirmed it; a kept one needs no confirmation', () => {
    const compared = ledger({ last: recovered, rewrite: { runs: runs() } })
    const methods = ['EP-1', 'EP-2', 'EP-3'].map((ep, i) => ({ name: `op${i}`, entryPoint: ep, element: `EL-${i + 1}` }))
    expect(codes(checkParity({ ledger: compared, slice: 'SL-1', driver: { methods } }))).toEqual(['driver-unconfirmed'])
    expect(codes(checkParity({ ledger: { ...compared, driver: { confirmed: false } }, slice: 'SL-1', driver: { methods } }))).toEqual(['driver-unconfirmed'])
    expect(checkParity({ ledger: { ...compared, driver: { confirmed: true } }, slice: 'SL-1', driver: { methods } })).toEqual([])
    expect(checkParity({ ledger: compared, slice: 'SL-1', driver: { kept: true, methods } })).toEqual([])
  })
})
