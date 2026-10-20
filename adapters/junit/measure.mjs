// The unit level's measures over the Change set for junit/v1 (36-test-levels.md): coverage from a Cobertura or JaCoCo XML report,
// mutation from a mutation-testing-elements report; apart from index.mjs so tests import it without starting the Adapter.
import { readFileSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, matchesGlob, relative, resolve } from 'node:path'
import { DOMParser } from '@xmldom/xmldom'

const list = (nodes) => Array.from({ length: nodes.length }, (_, i) => nodes.item(i))
const under = (file, paths = ['**']) => paths.some((g) => matchesGlob(file, g))

/** Sorted line numbers as ranges: 3-5,9. */
export function ranges(lines) {
  const out = []
  for (const n of [...lines].sort((a, b) => a - b)) {
    const last = out.at(-1)
    if (last && n === last[1] + 1) last[1] = n
    else out.push([n, n])
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',')
}

/** A report's path as the Change set names it: relative to the workspace, the real path tried too (a temp dir behind a symlink);
 * else the one changed file it is a suffix of, or that is a suffix of it (PIT's `com/x/Claim.java`, a Go import path). */
function inWorkspace(workspace, path, roots, changes) {
  const bases = [...new Set([resolve(workspace), realpathSync(workspace)])]
  const candidates = isAbsolute(path) ? bases.map((b) => relative(b, path)) : [path, ...roots.flatMap((r) => bases.map((b) => relative(b, resolve(b, r, path))))]
  const found = candidates.find((c) => changes.has(c))
  if (found) return found
  const tail = path.replace(/^\.?\//, '')
  const hits = [...changes.keys()].filter((f) => f.endsWith(`/${tail}`) || tail.endsWith(`/${f}`))
  return hits.length === 1 ? hits[0] : candidates[0]
}

/** A changed file under `paths` the report seems to name, a file of the same name, yet resolved to no changed file: the paths
 * did not map, and counting nothing would pass the minimum unmeasured. */
function unmapped(reported, changes, paths) {
  const changed = [...changes.keys()].filter((f) => under(f, paths) && !reported.has(f))
  const names = new Set([...reported].map((r) => basename(r)))
  const lost = changed.filter((f) => names.has(basename(f)))
  return lost.length ? `the report names ${lost.join(', ')} by a path that resolves to no changed file; nothing was measured there` : undefined
}

/** The changed executable lines the unit tests ran: {min, covered, total, uncovered[]}, or {min, error}. */
export function coverage({ workspace, report, min, changes, paths }) {
  if (!changes) return { min, error: 'no Change set to measure: no baseline commit' }
  let doc
  try {
    doc = new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message) } }).parseFromString(readFileSync(resolve(workspace, report), 'utf8'), 'text/xml')
  } catch (e) {
    return { min, error: `${report} not read: ${e.message}` }
  }
  const root = doc.documentElement?.nodeName
  if (root !== 'coverage' && root !== 'report') return { min, error: `${report} is neither a Cobertura nor a JaCoCo report` }
  const executable = new Map() // file → line → run
  const record = (file, number, run) => {
    const lines = executable.get(file) ?? executable.set(file, new Map()).get(file)
    lines.set(number, lines.get(number) || run)
  }
  if (root === 'coverage') {
    const roots = list(doc.getElementsByTagName('source')).map((s) => s.textContent.trim())
    for (const c of list(doc.getElementsByTagName('class'))) {
      const file = inWorkspace(workspace, c.getAttribute('filename'), roots, changes)
      for (const l of list(c.getElementsByTagName('line'))) record(file, Number(l.getAttribute('number')), Number(l.getAttribute('hits')) > 0)
    }
  } else {
    // JaCoCo: a sourcefile under its package's path, a line run when any instruction on it was covered
    for (const p of list(doc.getElementsByTagName('package'))) {
      for (const s of list(p.getElementsByTagName('sourcefile'))) {
        const file = inWorkspace(workspace, [p.getAttribute('name'), s.getAttribute('name')].filter(Boolean).join('/'), [], changes)
        for (const l of list(s.getElementsByTagName('line'))) record(file, Number(l.getAttribute('nr')), Number(l.getAttribute('ci')) > 0)
      }
    }
  }
  const lost = unmapped(new Set(executable.keys()), changes, paths)
  if (lost) return { min, error: lost }
  let covered = 0
  let total = 0
  const uncovered = []
  for (const [file, changed] of changes) {
    const lines = executable.get(file)
    if (!lines || !under(file, paths)) continue // a file the report omits counts no line
    const missed = [...changed].filter((n) => lines.has(n) && !lines.get(n))
    total += [...changed].filter((n) => lines.has(n)).length
    covered += [...changed].filter((n) => lines.get(n)).length
    if (missed.length) uncovered.push({ file, lines: ranges(missed) })
  }
  return { min, covered, total, uncovered }
}

const statuses = { Killed: 'killed', Survived: 'survived', NoCoverage: 'noCoverage', Timeout: 'timeout' } // errors and ignored ones score nothing

/** The mutants on the Change set's lines: counts, the score and the survivors, or {min, command, error}. Every mutant without a Change set.
 * The report is mutation-testing-elements JSON, or a script assigning it. */
export function mutation({ workspace, report, min, changes, paths, command }) {
  let json
  try {
    const text = readFileSync(resolve(workspace, report), 'utf8')
    // PIT's plugin writes the report as a script assigning it (html2/report.js): the JSON is the object it assigns
    json = /^\s*[{[]/.test(text) ? JSON.parse(text) : JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  } catch (e) {
    return { min, command, error: `${report} not read: ${e.message}` }
  }
  if (!json || typeof json.files !== 'object') return { min, command, error: `${report} is not a mutation-testing-elements report` }
  const counts = { killed: 0, survived: 0, noCoverage: 0, timeout: 0 }
  const survivors = []
  const files = Object.entries(json.files).map(([path, f]) => [inWorkspace(workspace, path, [], changes ?? new Map()), f])
  const lost = changes && unmapped(new Set(files.map(([file]) => file)), changes, paths)
  if (lost) return { min, command, error: lost }
  for (const [file, f] of files) {
    const changed = changes?.get(file)
    if (!under(file, paths) || (changes && !changed)) continue
    for (const m of f.mutants ?? []) {
      const line = m.location?.start?.line
      const status = statuses[m.status]
      if (!status || (changed && !changed.has(line))) continue
      counts[status]++
      if (status === 'survived' || status === 'noCoverage') survivors.push({ file, line, mutator: m.mutatorName })
    }
  }
  const scored = counts.killed + counts.timeout + counts.survived + counts.noCoverage
  return { min, command, ...counts, ...(scored ? { score: Math.round(((counts.killed + counts.timeout) / scored) * 10000) / 100 } : {}), survivors }
}
