// The Rewrite pack's checks (40-pack-rewrite.md), pure over the artifacts and values a Gate binds: a SourceInventory, the
// source index index-source read, the human's typed decisions. No Gate reads the checkout (14-gate.md), so nothing here does.
import { isAbsolute, relative, sep } from 'node:path'

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

/** branch-uncovered: a branch line of a file the Slice reaches, inside no guard's or plumbing pattern's line where. */
function branches(inventory, index, slices, slice) {
  const eps = sliceEntryPoints(inventory, slices, slice)
  const files = new Set((inventory.entryPoints ?? []).filter((e) => eps.has(e.id)).flatMap((e) => e.reaches?.files ?? []))
  const ranges = covered(inventory)
  const found = []
  for (const path of [...files].sort()) {
    if (!has(index.files, path)) continue // inventory-location names it
    const read = index.files[path].branchLines
    if (read === null) {
      found.push(warning('branch-unread', `${path}'s branch lines could not be read (no keyword table for its language, or too large): its guards rest on the readers alone`))
      continue
    }
    const lines = read.filter((n) => !(ranges.get(path) ?? []).some(([a, b]) => n >= a && n <= b))
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
