// The Rewrite pack's checks (40-pack-rewrite.md), pure over the artifacts and values a Gate binds: a SourceInventory, the
// source index index-source read, the human's typed decisions. No Gate reads the checkout (14-gate.md), so nothing here does.
import { isAbsolute, relative, sep } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { cites } from './ledger.mjs'

const error = (code, message) => ({ severity: 'error', code, message })
const warning = (code, message) => ({ severity: 'warning', code, message })

/** `path:12` → {path, from: 12, to: 12}; `path:12-30` → {path, 12, 30}; `path` → {path}; a locator object → undefined. */
export function parseWhere(where) {
  if (typeof where !== 'string') return undefined
  const m = /^(.*?)(?::([0-9]+)(?:-([0-9]+))?)?$/.exec(where)
  const from = m[2] ? Number(m[2]) : undefined
  return { path: m[1], from, to: m[3] ? Number(m[3]) : from }
}

const inside = (child, parent) => {
  const r = relative(parent, child)
  return r === '' || !(r === '..' || r.startsWith(`..${sep}`) || isAbsolute(r))
}
const has = (files, path) => Object.hasOwn(files, path)

/** source-inside-project, source-moved: the index against the project and the inventory. */
function placement(inventory, index) {
  const found = []
  const { root, gitCommonDir, project } = index
  if (inside(root, project.root) || inside(project.root, root) || (gitCommonDir && gitCommonDir === project.gitCommonDir)) {
    found.push(error('source-inside-project', `the Source system's checkout ${root} and the project ${project.root} are one repository or one inside the other: a rewrite lives in a repository of its own; a change in place is a refactor`))
  }
  const commit = inventory.source?.commit ?? ''
  if (!commit || !(index.commit.startsWith(commit) || commit.startsWith(index.commit))) {
    found.push(error('source-moved', `the checkout is at ${index.commit}, the inventory was read at ${commit || 'no commit'}`))
  }
  if (index.dirty?.length) found.push(error('source-moved', `the checkout differs from its commit in ${index.dirty.join(', ')}: the facts must be the commit's`))
  return found
}

// every list of the inventory with its id prefix, in document order
const lists = [
  ['entryPoints', 'EP'], ['stateChanges', 'ST'], ['guards', 'GD'], ['declarations', 'DC'], ['absences', 'AB'],
  ['plumbingPatterns', 'PP'], ['entities', 'EN'], ['externalSystems', 'EX'], ['openQuestions', 'Q'],
]

/** id-sequence: each list's ids unique and increasing in document order; a gap is a removed item. */
function sequence(inventory) {
  const found = []
  for (const [list, prefix] of lists) {
    let last = 0
    const seen = new Set()
    for (const { id } of inventory[list] ?? []) {
      const n = Number(id.slice(prefix.length + 1))
      if (seen.has(id)) found.push(error('id-sequence', `${id} appears twice in ${list}`))
      else if (n <= last) found.push(error('id-sequence', `${id} follows ${prefix}-${last} in ${list}: ids increase in document order`))
      seen.add(id)
      last = Math.max(last, n)
    }
  }
  return found
}

/** inventory-reference: every id a field cites names an item of the inventory, of the kind the field takes. */
function references(inventory) {
  const ids = new Set(lists.flatMap(([list]) => (inventory[list] ?? []).map((x) => x.id)))
  const found = []
  const cite = (where, id, ...prefixes) => {
    if (!prefixes.some((p) => id.startsWith(`${p}-`))) found.push(error('inventory-reference', `${where} cites ${id} where ${prefixes.map((p) => `${p}-n`).join(' or ')} belongs`))
    else if (!ids.has(id)) found.push(error('inventory-reference', `${where} cites ${id}, which the inventory lacks`))
  }
  for (const e of inventory.entryPoints ?? []) {
    for (const id of e.reaches?.entities ?? []) cite(e.id, id, 'EN')
    for (const id of e.reaches?.externalSystems ?? []) cite(e.id, id, 'EX')
  }
  for (const s of inventory.stateChanges ?? []) {
    cite(s.id, s.entity, 'EN')
    for (const id of s.from ?? []) cite(s.id, id, 'EP')
  }
  for (const g of inventory.guards ?? []) for (const id of g.in ?? []) cite(g.id, id, 'EP')
  for (const p of inventory.plumbingPatterns ?? []) for (const id of p.examples ?? []) cite(p.id, id, 'GD')
  for (const t of inventory.tests ?? []) for (const id of t.covers ?? []) cite(`test ${t.name}`, id, 'EP', 'GD')
  return found
}

/** inventory-location: a file where names a file the index has, its lines within the file and in order. */
function locations(inventory, index) {
  const found = []
  const check = (owner, where) => {
    const w = parseWhere(where)
    if (!w) return // a locator outside the repository: a database, a configuration store
    if (!has(index.files, w.path)) return found.push(error('inventory-location', `${owner} is at ${where}, a file the checkout at ${index.commit} lacks`))
    const file = index.files[w.path]
    if (w.from !== undefined && (w.to > file.lines || w.from > w.to)) found.push(error('inventory-location', `${owner} is at ${where}, but ${w.path} has ${file.lines} lines${w.from > w.to ? ' and the range runs backwards' : ''}`))
  }
  for (const [list] of lists) for (const x of inventory[list] ?? []) for (const where of x.where ?? []) check(x.id, where)
  for (const e of inventory.entryPoints ?? []) for (const path of e.reaches?.files ?? []) check(`${e.id} reaches`, path)
  for (const t of inventory.tests ?? []) check(`test ${t.name}`, t.where)
  return found
}

/** The entry points of a Slice, by the ledger's cut; every one when no Slice is named. */
const sliceEntryPoints = (inventory, slices, slice) => {
  const cut = slice ? slices?.find((s) => s.id === slice) : undefined
  return new Set(cut ? cut.entryPoints : (inventory.entryPoints ?? []).map((e) => e.id))
}

/** inventory-location for the Slice itself: a Slice the Survey's cut lacks would widen the checks to the whole source. */
const unknownSlice = (slices, slice) => (slice && !slices?.some((s) => s.id === slice) ? [error('inventory-location', `${slice} is no Slice of the Survey's cut`)] : [])

/** The line ranges of a file the guards and plumbing patterns cover; a whole-file where covers no line. */
function covered(inventory) {
  const ranges = new Map()
  for (const x of [...(inventory.guards ?? []), ...(inventory.plumbingPatterns ?? [])]) {
    for (const where of x.where ?? []) {
      const w = parseWhere(where)
      if (w?.from === undefined) continue
      ;(ranges.get(w.path) ?? ranges.set(w.path, []).get(w.path)).push([w.from, w.to])
    }
  }
  return ranges
}

/** branch-uncovered: a branch line of a file the Slice reaches, inside no guard's or plumbing pattern's line where; with
 * `coverage`, also every line the report gives branch counters on, which sees branches no keyword names. */
function branches(inventory, index, slices, slice, coverage) {
  const eps = sliceEntryPoints(inventory, slices, slice)
  const files = new Set((inventory.entryPoints ?? []).filter((e) => eps.has(e.id)).flatMap((e) => e.reaches?.files ?? []))
  const ranges = covered(inventory)
  const found = []
  for (const path of [...files].sort()) {
    if (!has(index.files, path)) continue // inventory-location names it
    const counted = Object.entries(coverage?.[path] ?? {}).filter(([, l]) => l.branches?.total > 0).map(([n]) => Number(n))
    const read = index.files[path].branchLines
    if (read === null && !counted.length) {
      found.push(warning('branch-unread', `${path}'s branch lines could not be read (no keyword table for its language, or too large): its guards rest on the readers alone`))
      continue
    }
    const lines = [...new Set([...(read ?? []), ...counted])].sort((a, b) => a - b).filter((n) => !(ranges.get(path) ?? []).some(([a, b]) => n >= a && n <= b))
    if (lines.length) found.push(error('branch-uncovered', `${path} branches at line${lines.length > 1 ? 's' : ''} ${lines.join(', ')}, inside no guard and no plumbing pattern`))
  }
  return found
}

/** reader-disagreement: a guard of one reader whose line where overlaps nothing the other recorded; a warning the human settles. */
function readers(inventory, second) {
  const spans = (inv) => (inv.guards ?? []).map((g) => ({ id: g.id, at: (g.where ?? []).map(parseWhere).filter((w) => w?.from !== undefined) }))
  const overlaps = (a, b) => a.at.some((x) => b.at.some((y) => x.path === y.path && x.from <= y.to && y.from <= x.to))
  const [first, other] = [spans(inventory), spans(second)]
  const lone = (mine, theirs, who) => mine.filter((g) => g.at.length && !theirs.some((o) => overlaps(g, o))).map((g) => warning('reader-disagreement', `${who} reader's ${g.id} at ${g.at.map((w) => `${w.path}:${w.from}-${w.to}`).join(', ')} overlaps no guard of the other reader`))
  return [...lone(first, other, 'the first'), ...lone(other, first, 'the second')]
}

/** survey-consistency: the Survey's inventory against the checkout, and the human's cut of it into Slices. */
export function checkSurvey({ inventory, index, decisions }) {
  const found = [...placement(inventory, index), ...sequence(inventory), ...references(inventory), ...locations(inventory, index)]
  const eps = (inventory.entryPoints ?? []).map((e) => e.id)
  const slices = decisions?.slices ?? []
  let last = 0
  for (const s of slices) {
    const n = Number(s.id.slice(3))
    if (n <= last) found.push(error('id-sequence', `${s.id} follows SL-${last}: Slice ids increase in document order`))
    last = Math.max(last, n)
    for (const ep of s.entryPoints) if (!eps.includes(ep)) found.push(error('slice-cut', `${s.id} names ${ep}, which the inventory lacks`))
  }
  for (const ep of eps) {
    const in_ = slices.filter((s) => s.entryPoints.includes(ep)).map((s) => s.id)
    if (in_.length !== 1) found.push(error('slice-cut', in_.length ? `${ep} is in ${in_.join(' and ')}: an entry point is in one Slice` : `${ep} is in no Slice`))
  }
  return found
}

/** inventory-consistency: a Slice's inventory against the checkout, the Survey's cut, and the second reader's guards. */
export function checkInventory({ inventory, index, slices, slice, second }) {
  const lost = unknownSlice(slices, slice)
  return [
    ...placement(inventory, index),
    ...sequence(inventory),
    ...references(inventory),
    ...locations(inventory, index),
    ...lost,
    ...(lost.length ? [] : branches(inventory, index, slices, slice)),
    ...(second ? readers(inventory, second) : []),
  ]
}

const idPattern = /(?<![A-Za-z0-9])(EP|GD|DC|ST|EX|AB|PP|EN)[-_]?(\d+)(?![A-Za-z0-9])/g
/** The inventory ids a text names, as `EP-2`, `EP_2` or `EP2`, written back as `EP-2`. */
const idsIn = (text) => [...String(text).matchAll(idPattern)].map((m) => `${m[1]}-${m[2]}`)
const inventoryIds = (inventory) => new Set(lists.flatMap(([list]) => (inventory[list] ?? []).map((x) => x.id)))

/** expected-moved: a test the source answered again otherwise than recorded, with no change of a rule whose item it cites. */
function moved(ledger, runs) {
  const recorded = new Map((ledger.answers ?? []).filter((a) => a.observed !== null).map((a) => [a.test, a.observed]))
  const changed = (ledger.items ?? []).filter((i) => i.disposition === 'change').map((i) => i.ref)
  const found = []
  for (const r of runs ?? []) {
    for (const t of r.tests.filter((t) => t.status === 'passed' && recorded.has(t.name) && Object.hasOwn(r.observations ?? {}, t.name))) {
      if (isDeepStrictEqual(r.observations[t.name], recorded.get(t.name))) continue
      if (changed.some((ref) => idsIn(t.name).includes(ref))) continue
      found.push(error('expected-moved', `${t.name} now observes ${JSON.stringify(r.observations[t.name])} where the source answered ${JSON.stringify(recorded.get(t.name))}, and no change of a rule it cites allows it`))
    }
  }
  return found
}

/**
 * ledger-closure, at characterize-gate: every item of the Slice its Oracle can pin is pinned, every test names ids the
 * inventory has, the coverage maps onto the index, every branch line the coverage counts sits in a guard, and no
 * recorded answer moved. An item not yet ruled is no finding here: rules come after.
 */
export function checkClosure({ ledger, inventory, index, coverage, runs, slice }) {
  const found = [...placement(inventory, index)] // what ran is the indexed commit's, outside the project
  const plumbing = new Set((inventory.guards ?? []).filter((g) => g.role === 'plumbing').map((g) => g.id))
  for (const i of (ledger.items ?? []).filter((i) => i.slice === slice)) {
    if (!i.pinnable || i.pinned || i.dead || i.accepted || i.disposition === 'drop' || plumbing.has(i.ref) || i.ref.startsWith('AB-')) continue
    const why = !i.reached ? 'no test reaches it' : i.mutant === 'killed' ? 'its mutant was killed by no test that cites it and was green on the source' : i.mutant === 'survived' ? 'its mutant survived: no test notices it change' : i.mutant === 'invalid' ? 'its mutant was invalid' : 'no mutant was run for it'
    found.push(error('item-open', `${i.ref}: ${why}`))
  }
  const ids = inventoryIds(inventory)
  for (const name of new Set((runs ?? []).flatMap((r) => r.tests.map((t) => t.name)))) for (const id of idsIn(name)) if (!ids.has(id)) found.push(error('test-reference', `${name} cites ${id}, which the inventory lacks`))
  for (const path of coverage?.unmapped ?? []) found.push(error('coverage-unmapped', `the coverage report names ${path}, which maps onto no file of the checkout, or onto several`))
  if (coverage) found.push(...branches(inventory, index, ledger.slices, slice, coverage.files).filter((f) => f.code === 'branch-uncovered'))
  found.push(...moved(ledger, runs))
  return found
}

/** recovery-consistency, at recover-gate: the recovered Prd and rules against the inventory, the ledger and the decisions. */
export function checkRecovery({ prd, rules, inventory, ledger, decisions = {}, lastPrd, slice }) {
  const found = []
  const ids = inventoryIds(inventory)
  for (const r of rules?.rules ?? []) {
    const source = r.source ?? ''
    if (r.status === 'active' && !/^(inventory|decision):/.test(source)) found.push(error('rule-unsourced', `${r.id} is sourced from "${source}", neither inventory: nor decision:`))
    if (source.startsWith('inventory:')) for (const id of idsIn(source)) if (!ids.has(id)) found.push(error('unknown-inventory-item', `${r.id} cites ${id}, which the inventory lacks`))
  }
  for (const c of prd?.capabilities ?? []) for (const id of idsIn(c.description)) if (!ids.has(id)) found.push(error('unknown-inventory-item', `${c.id} names ${id}, which the inventory lacks`))
  const nonGoals = (prd?.nonGoals ?? []).join('\n')
  const named = (text, id) => cites(text, id) // whole words: CAP-30 never names CAP-3
  const kept = new Set((prd?.capabilities ?? []).map((c) => c.id))
  for (const c of lastPrd?.capabilities ?? []) if (!kept.has(c.id) && !named(nonGoals, c.id)) found.push(error('capability-dropped', `${c.id} of the product's last Prd is gone, and no non-goal names it`))
  for (const d of decisions.dispositions ?? []) {
    const rule = (rules?.rules ?? []).find((r) => r.id === d.ref)
    if (d.ref.startsWith('CAP-') && d.disposition === 'drop' && (kept.has(d.ref) || !named(nonGoals, d.ref))) found.push(error('disposition-mismatch', `${d.ref} is dropped, but the Prd still lists it or no non-goal names it`))
    if (d.ref.startsWith('BR-') && d.disposition !== 'keep' && rule?.status !== 'deprecated') found.push(error('disposition-mismatch', `${d.ref} is decided ${d.disposition}, but the rule is still ${rule ? rule.status : 'missing'}`))
    if (d.ref.startsWith('BR-') && d.disposition === 'change' && !(rules?.rules ?? []).some((r) => r.status === 'active' && (r.source ?? '').startsWith('decision:') && named(r.source, d.ref))) found.push(error('disposition-mismatch', `${d.ref} is changed, but no active rule sourced "decision: ... ${d.ref}" replaces it`))
  }
  // every Slice's: an earlier Slice's item the inventory dropped stays open until decided, and no other gate sees it
  for (const i of (ledger.items ?? []).filter((i) => i.account === 'open')) found.push(error('item-unaccounted', `${i.ref}${i.slice === slice ? '' : ` (${i.slice})`} is open: ${i.reason ?? 'not accounted for'}`))
  const cut = ledger.slices?.find((s) => s.id === slice)
  const prose = [...(prd?.capabilities ?? []).map((c) => c.description), nonGoals].join('\n')
  for (const ep of cut?.entryPoints ?? []) if (!idsIn(prose).includes(ep)) found.push(warning('entry-point-uncited', `${ep} is named by no capability and no non-goal`))
  return found
}

/** parity-consistency, at parity-gate: every difference explained, the verdict held, the rewrite's driver citing what it maps. */
export function checkParity({ ledger, slice, driver, prd }) {
  const found = []
  for (const d of ledger.differences ?? []) if (!d.cause) found.push(error('parity-unexplained', `${d.test}: the source answered ${JSON.stringify(d.source)}, the rewrite ${JSON.stringify(d.rewrite)}, and no change of a rule nor an Issue explains it`))
  if (!ledger.rewrite) found.push(error('parity-verdict', 'no rewrite run was compared in this ledger revision: compute-ledger runs after run-rewrite'))
  const v = ledger.verdict?.result
  if (v === 'fail' || !v) found.push(error('parity-verdict', `the Slice's verdict is ${v ?? 'missing'}: ${ledger.verdict?.rule ?? 'no ledger computed'}`))
  if (v === 'concerns' && !(ledger.concerns?.accepted && ledger.concerns.reason?.trim())) found.push(error('parity-verdict', `the Slice's verdict is concerns (${ledger.verdict.rule}) and no human accepted them with a reason`))
  // a rewrite driver in the suite means the interface changed: its methods must be bound and must cite what they map
  if (ledger.suite?.drivers?.rewrite && !driver) found.push(error('driver-uncited', 'the suite has a rewrite driver, and its methods were not bound to the gate'))
  if (driver) {
    for (const m of driver.methods ?? []) if (!/^EP-\d+$/.test(m.entryPoint ?? '') || !/^EL-\d+$/.test(m.element ?? '')) found.push(error('driver-uncited', `the rewrite driver's ${m.name} cites ${m.entryPoint ?? 'no entry point'} and ${m.element ?? 'no Design element'}: each method cites both`))
    const dropped = idsIn((prd?.nonGoals ?? []).join('\n'))
    const cut = ledger.slices?.find((s) => s.id === slice)
    for (const ep of cut?.entryPoints ?? []) if (!(driver.methods ?? []).some((m) => m.entryPoint === ep) && !dropped.includes(ep)) found.push(error('driver-uncited', `${ep} has no rewrite driver method and is no non-goal`))
  }
  return found
}
