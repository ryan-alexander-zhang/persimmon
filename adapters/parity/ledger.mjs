// The ParityLedger, computed (40-pack-rewrite.md): never written by an agent, as the TestReport is not (39-test-process.md).
// Pure over what the Tasks before it answered: the inventory, the human's typed decisions, the suite's runs on the source
// and on the rewrite with their observations, the source's coverage mapped onto its index, the mutants, the rules.
import { isDeepStrictEqual } from 'node:util'
import { parseWhere } from './check.mjs'

const rank = { running: 3, partial: 2, recorded: 1, static: 0 }
const levelOracle = { app: 'running', units: 'partial', records: 'recorded' }
const strongest = (oracles) => oracles.reduce((a, b) => (rank[b] > rank[a] ? b : a), 'static')
const noWitness = 'no test passed on the source, its units or its records'

/** Whether a test's name cites an id: `EP-2`, `EP_2` or `EP2` as a whole word, so `GD2` never cites `GD-21` nor `EP2A` `EP-2`. */
export function cites(name, id) {
  const [prefix, n] = id.split('-')
  return new RegExp(`(?<![A-Za-z0-9])${prefix}[-_]?${n}(?![A-Za-z0-9])`).test(name)
}

/** The ids a rule's `source` names after `inventory:`, as `recover-rules` writes them. */
const ruleRefs = (rule) => (/^inventory:/.test(rule.source ?? '') ? rule.source.slice('inventory:'.length).split(/[\s,]+/).filter(Boolean) : [])

/** The inventory's items with the entry points each sits in: guards, declarations, state changes, absences, outbound systems. */
function itemsOf(inventory) {
  return [
    ...(inventory.guards ?? []).map((g) => ({ ref: g.id, kind: g.role === 'plumbing' ? 'plumbing' : 'guard', eps: g.in ?? [], where: g.where, volatile: g.volatile?.length > 0 })),
    ...(inventory.declarations ?? []).map((d) => ({ ref: d.id, kind: 'declaration', eps: [], where: d.where })),
    ...(inventory.stateChanges ?? []).map((s) => ({ ref: s.id, kind: 'effect', eps: s.from ?? [], where: s.where })),
    ...(inventory.externalSystems ?? []).filter((x) => x.direction !== 'in').map((x) => ({ ref: x.id, kind: 'effect', eps: [], where: x.where })),
    ...(inventory.absences ?? []).map((a) => ({ ref: a.id, kind: 'absence', eps: [], where: a.where })),
  ]
}

/** `reached`: a line of the item's file wheres ran; `measured`: coverage covers every file the item sits in. A locator
 * where (a database trigger, a configuration key) is never measured: coverage cannot say, so the item is unverified at best. */
function measure(where, coverage) {
  const files = (where ?? []).map(parseWhere)
  const measured = coverage !== undefined && files.length > 0 && files.every((p) => p && Object.hasOwn(coverage, p.path))
  const reached = files.some((p) => {
    const lines = p && coverage?.[p.path]
    return !!lines && Object.entries(lines).some(([n, l]) => l.hits > 0 && (p.from === undefined || (Number(n) >= p.from && Number(n) <= p.to)))
  })
  return { measured, reached }
}

/** The plumbing pattern the human accepted that covers the guard: one naming it, or one whose where holds its lines. */
function patternOf(item, inventory, accepted) {
  for (const pp of (inventory.plumbingPatterns ?? []).filter((p) => accepted.includes(p.id))) {
    if (pp.examples.includes(item.ref)) return pp.id
    const spans = pp.where.map(parseWhere).filter((w) => w?.from !== undefined)
    const mine = (item.where ?? []).map(parseWhere).filter((w) => w?.from !== undefined)
    if (mine.length && mine.every((m) => spans.some((s) => s.path === m.path && s.from <= m.from && m.to <= s.to))) return pp.id
  }
  return undefined
}

/** One item's account, as the design's table says, with why it is not complete. */
function account(item, x) {
  if (item.kind === 'absence') return x.disposition === 'keep' || x.disposition === 'change' ? ['complete'] : ['open', 'no Disposition decided']
  if (item.kind === 'plumbing') return x.plumbing ? ['complete'] : ['open', 'its plumbing pattern is not accepted']
  if (x.dead || x.disposition === 'drop') return ['complete']
  // a write or a message is pinned, not ruled; a rule changed by a decision is the decision's, its `decision:` rule cites no item
  const ruled = item.kind === 'effect' || x.rules.length > 0 || x.disposition === 'change'
  if (ruled && x.pinnable && x.pinned) return ['complete']
  if (x.accepted) return ['unverified', 'accepted open']
  if (ruled && !x.pinnable) return ['unverified', 'its Oracle cannot pin it']
  if (!ruled) return ['open', 'no rule cites it']
  if (!x.reached) return ['open', 'not reached']
  if (x.mutant === 'killed') return ['open', 'its mutant was killed by no test that cites it']
  return ['open', x.mutant === 'survived' ? 'its mutant survived' : x.mutant === 'invalid' ? 'its mutant was invalid' : 'no mutant run']
}

/** The Disposition of an item: its own decision (an absence), else the one every active rule citing it agrees on, else,
 * with no active rule left, a change or drop decided on a deprecated one. A disagreement decides nothing. */
function dispositionOf(ref, citing, decided) {
  const own = decided(ref)
  if (own) return own
  const active = citing.filter((r) => r.status === 'active').map((r) => decided(r.id) ?? 'keep')
  if (active.length) return active.every((d) => d === active[0]) && active[0] !== 'keep' ? active[0] : undefined
  return citing.map((r) => decided(r.id)).find((d) => d === 'change' || d === 'drop')
}

/** Every typed decision so far: the last revision's, then this stage's, a later one for the same ref replacing it. A stage's
 * human Task answers that stage's decisions only; without the earlier ones every account would be recomputed undecided. */
export function mergeDecisions(earlier = {}, now = {}) {
  const byRef = (key) => {
    const merged = new Map((earlier[key] ?? []).map((d) => [d.ref, d]))
    for (const d of now[key] ?? []) merged.set(d.ref, d)
    return [...merged.values()]
  }
  return {
    dispositions: byRef('dispositions'), dead: byRef('dead'), accepted: byRef('accepted'), readers: byRef('readers'),
    plumbing: [...new Set([...(earlier.plumbing ?? []), ...(now.plumbing ?? [])])],
  }
}

/**
 * The next ledger revision. `slice` absent: the Survey's, holding the human's cut. Otherwise the Slice's: every item the
 * inventory lists or the ledger held for the Slice, its account, the Oracle of each of its entry points, the source's
 * answers, with `rewrite` the differences, then the Slice's verdict. `runs` are run-source's, `[{level, tests, observations}]`;
 * absent, the stage measured nothing and the last revision's measurements of the Slice carry over, only the accounts recomputed;
 * `coverage` the mapped files, undefined when no report ran; `mutants` run-mutants', `[{ref, result, failed[]}]`.
 */
export function computeLedger({ inventory, inventoryRef, last, slice, decisions: stage = {}, suite, runs, coverage, mutants = [], rules, rulesRef, rewrite }) {
  if (!inventoryRef) throw new Error('inventoryRef is required: a ledger pins the inventory revision it was computed from')
  const base = last ?? { source: inventory.source, slices: [], entryPoints: [], items: [], answers: [], differences: [], unreached: [] }
  const ledger = { ...structuredClone(base), source: inventory.source, inventory: inventoryRef }
  const kept = mergeDecisions(base.decisions, stage)
  if (Object.values(kept).some((l) => l.length)) ledger.decisions = kept
  const decisions = { ...kept, slices: stage.slices, driver: stage.driver, concerns: stage.concerns }
  delete ledger.verdict
  delete ledger.rewrite // only the revision that compared a rewrite run says so
  if (rulesRef) ledger.rules = rulesRef
  if (!slice) {
    ledger.slices = decisions.slices ?? ledger.slices
    delete ledger.slice
    return ledger
  }
  ledger.slice = slice
  if (suite) ledger.suite = suite
  const cut = ledger.slices.find((s) => s.id === slice)
  if (!cut) throw new Error(`${slice} is no Slice of the ledger's cut`)

  // only characterize measures the source: a later stage carries what it measured, so no later run measures it differently
  const measuring = runs !== undefined
  // the Oracle of each entry point: the strongest level a test citing it passed on; a test red on the source witnesses nothing
  const tests = (runs ?? []).flatMap((r) => r.tests.map((t) => ({ ...t, level: r.level, observations: r.observations ?? {} })))
  const passed = tests.filter((t) => t.status === 'passed')
  // a record runs against the rewrite only: a records test that ran there holds its entry point's Oracle, whatever it answered
  const records = (rewrite?.runs ?? []).filter((r) => r.level === 'records').flatMap((r) => r.tests)
  const held = [...passed, ...records.map((t) => ({ ...t, level: 'records' }))]
  const carried = (ep) => (measuring ? [] : [base.entryPoints.find((e) => e.id === ep)?.oracle ?? 'static'])
  const eps = Object.fromEntries(cut.entryPoints.map((ep) => [ep, strongest([...carried(ep), ...held.filter((t) => cites(t.name, ep)).map((t) => levelOracle[t.level] ?? 'static')])]))
  ledger.entryPoints = [...ledger.entryPoints.filter((e) => !(e.id in eps)), ...cut.entryPoints.map((id) => ({ id, oracle: eps[id] }))].sort((a, b) => Number(a.id.slice(3)) - Number(b.id.slice(3)))
  const best = strongest(Object.values(eps))

  const names = [...new Set(tests.map((t) => t.name))]
  const allRules = rules?.rules ?? []
  const decided = (ref) => (decisions.dispositions ?? []).find((d) => d.ref === ref)?.disposition
  const owner = new Map(base.items.map((i) => [i.ref, i.slice]))
  const listed = itemsOf(inventory)
  const mine = listed.filter((i) => (owner.get(i.ref) ?? slice) === slice)
  // an item's account: this Slice's measured now when this stage measures, every other item's measurements carried, and every
  // account recomputed with every decision so far, since a later Slice's human may decide an earlier Slice's item
  const compute = (item, at) => {
    const fresh = measuring && at === slice
    // without the rules (characterize binds none), an earlier Slice's item keeps the rules it was last ruled by
    const ruledBefore = !rules && at !== slice
    const itemOracle = item.eps.length ? strongest(item.eps.map((ep) => eps[ep] ?? 'static')) : best
    const citing = allRules.filter((r) => ruleRefs(r).includes(item.ref))
    const { measured, reached } = measure(item.where, coverage)
    // several mutants of one item: the strongest one, a kill by a citing test green on the source before any other kill
    const killsHere = (m) => m.result === 'killed' && (m.failed ?? []).some((n) => cites(n, item.ref) && passed.some((t) => t.name === n))
    const strength = (m) => (killsHere(m) ? 4 : { killed: 3, survived: 2, invalid: 1 }[m.result] ?? 0)
    const run = mutants.filter((m) => m.ref === item.ref).sort((a, b) => strength(b) - strength(a))[0]
    const last = base.items.find((i) => i.ref === item.ref && i.slice === at)
    const x = {
      ...(fresh ? {
        reached,
        pinnable: (itemOracle === 'running' || itemOracle === 'partial') && measured && !item.volatile,
        mutant: run?.result,
        // only a test citing the item, and green on the source, kills it: a test red there witnesses nothing
        pinned: run?.result === 'killed' && (run.failed ?? []).some((n) => cites(n, item.ref) && passed.some((t) => t.name === n)),
        tests: names.filter((n) => cites(n, item.ref) || item.eps.some((ep) => cites(n, ep))),
      } : { reached: last?.reached ?? false, pinnable: last?.pinnable ?? false, pinned: last?.pinned ?? false, mutant: last?.mutant === 'none' ? undefined : last?.mutant, tests: last?.tests ?? [] }),
      rules: ruledBefore ? (last?.rules ?? []) : citing.filter((r) => r.status === 'active').map((r) => r.id),
      disposition: ruledBefore ? (decided(item.ref) ?? last?.disposition) : dispositionOf(item.ref, citing, decided),
      dead: (decisions.dead ?? []).find((d) => d.ref === item.ref)?.evidence,
      accepted: (decisions.accepted ?? []).find((d) => d.ref === item.ref)?.reason,
      reader: (decisions.readers ?? []).find((d) => d.ref === item.ref)?.resolution,
      plumbing: item.kind === 'plumbing' ? patternOf(item, inventory, decisions.plumbing ?? []) : undefined,
    }
    const [acct, reason] = account(item, x)
    const mutable = item.kind === 'guard' || item.kind === 'declaration' || item.kind === 'effect' // plumbing and absences are decided, not mutated
    return Object.fromEntries(Object.entries({
      ref: item.ref, slice: at, reached: x.reached, pinnable: x.pinnable, pinned: x.pinned, mutant: mutable ? (x.mutant ?? (x.pinnable ? 'none' : undefined)) : undefined,
      tests: x.tests, rules: x.rules, disposition: x.disposition,
      dead: x.dead, accepted: x.accepted, plumbing: x.plumbing, reader: x.reader, account: acct, reason,
    }).filter(([, v]) => v !== undefined))
  }
  // an item a Slice held that this inventory revision no longer lists stays, open, until a human decides it
  const gone = (i) => {
    const dead = i.dead ?? (decisions.dead ?? []).find((d) => d.ref === i.ref)?.evidence
    const dropped = i.disposition === 'drop' || decided(i.ref) === 'drop'
    return dead || dropped ? { ...i, ...(dead ? { dead, account: 'complete' } : { disposition: 'drop', account: 'complete' }), reason: undefined } : { ...i, account: 'open', reason: 'the inventory no longer lists it' }
  }
  const def = (ref) => listed.find((l) => l.ref === ref)
  const strip = (i) => Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined))
  ledger.items = [
    ...base.items.filter((i) => i.slice !== slice).map((i) => (def(i.ref) ? compute(def(i.ref), i.slice) : strip(gone(i)))),
    ...mine.map((item) => compute(item, slice)),
    ...base.items.filter((i) => i.slice === slice && !def(i.ref)).map((i) => strip(gone(i))),
  ]

  // every test that passed on the source, recorded once, never edited; its observation null when the run wrote none
  const known = new Set(ledger.answers.map((a) => a.test))
  for (const t of passed) {
    if (known.has(t.name)) continue
    ledger.answers.push({ test: t.name, observed: Object.hasOwn(t.observations, t.name) ? t.observations[t.name] : null })
    known.add(t.name)
  }

  // on the rewrite: a recorded test that failed, did not run, or observed otherwise is a difference, caused by a change or
  // drop of a rule whose item it cites
  if (rewrite) {
    const ran = new Map(rewrite.runs.flatMap((r) => r.tests.map((t) => [t.name, { status: t.status, observed: (r.observations ?? {})[t.name] }])))
    const changed = allRules.filter((r) => ['change', 'drop'].includes(decided(r.id)))
    const cause = (name) => {
      const rule = changed.find((r) => ruleRefs(r).some((ref) => cites(name, ref)))
      if (rule) return { cause: { rule: rule.id } }
      const issue = base.differences.find((d) => d.test === name && d.cause?.issue)?.cause // an Issue's cause holds while the difference does
      return issue ? { cause: issue } : {}
    }
    const fresh = ledger.answers.flatMap(({ test, observed }) => {
      const now = ran.get(test)
      const same = now && now.status === 'passed' && (observed === null || isDeepStrictEqual(now.observed, observed))
      if (same) return []
      return [{ test, source: observed, rewrite: now ? (now.observed ?? now.status) : 'not run', ...cause(test) }]
    })
    // a record's expected output is in its test: one not green on the rewrite differs from what the source produced
    const recorded = records.filter((t) => t.status !== 'passed').map((t) => ({ test: t.name, source: 'recorded', rewrite: t.status, ...cause(t.name) }))
    ledger.differences = [...fresh, ...recorded]
    const head = rewrite.runs.find((r) => r.head)?.head
    ledger.rewrite = { tests: ran.size, ...(head ? { head } : {}) }
  }

  // what no Oracle reached: an entry point no test passed on, one a test red on the source left without a witness, and one
  // a test of the Slice observed nothing for, which rests on its status alone; a test citing nothing counts at the Slice's first
  const at = (name) => cut.entryPoints.find((ep) => cites(name, ep)) ?? mine.find((i) => cites(name, i.ref))?.ref ?? cut.entryPoints[0]
  const blind = passed.filter((t) => ledger.answers.some((a) => a.test === t.name && a.observed === null))
  ledger.unreached = [
    ...base.unreached.filter((u) => u.slice !== slice || (!measuring && u.why !== noWitness)), // a red or blind test's entry carries; the Oracle's is recomputed
    ...cut.entryPoints.filter((ep) => eps[ep] === 'static').map((ref) => ({ ref, slice, why: noWitness })),
    ...tests.filter((t) => t.status !== 'passed').map((t) => ({ ref: at(t.name), slice, why: `${t.name} ${t.status} on the source: the characterization is broken there` })),
    ...blind.map((t) => ({ ref: at(t.name), slice, why: `${t.name} observed nothing: it rests on its status alone` })),
  ]
  if (decisions.driver) ledger.driver = decisions.driver
  if (decisions.concerns) ledger.concerns = decisions.concerns

  const mineNow = ledger.items.filter((i) => i.slice === slice)
  const open = mineNow.filter((i) => i.account === 'open')
  const unexplained = ledger.differences.filter((d) => !d.cause)
  const unverified = mineNow.filter((i) => i.account === 'unverified')
  const unreached = ledger.unreached.filter((u) => u.slice === slice)
  ledger.verdict =
    open.length || unexplained.length ? { result: 'fail', rule: `${open.length} open item(s), ${unexplained.length} difference(s) without a cause` }
    : unverified.length || unreached.length ? { result: 'concerns', rule: `${unverified.length} unverified item(s), ${unreached.length} unreached entry point(s)` }
    : { result: 'pass', rule: 'nothing open, nothing unverified, nothing unreached, no difference without a cause' }
  return ledger
}
