// What one suite level's run left behind (40-pack-rewrite.md): its tests from the JUnit XML, what each observed from the
// observations file, and the source's coverage mapped onto the index. Apart from parity-run/v1 so tests read it directly.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { isReport, reportPath, reports, testCases } from '../junit/read.mjs'
import { mapCoverage, readCoverage } from './coverage.mjs'

/** Before a run: its reports from an earlier one are gone, so a stale file never answers this run. */
export function clearLevel(workspace, level) {
  for (const f of reports(workspace, level.junit)) if (isReport(f)) rmSync(f, { force: true })
  rmSync(reportPath(workspace, level.observations), { force: true })
  if (level.coverage) rmSync(reportPath(workspace, level.coverage), { force: true })
}

/** After a run: `{run: {level, command, exitCode, head, tests, observations, reason?, outputTail?}, coverage?: {files,
 * unmapped}}`. An unreadable report reads as no tests, never as an Adapter error: a red or broken suite is an outcome the
 * ledger records, with the reason and the output's tail when no test was read. `clean` redacts what the run had as secrets. */
export function readLevel({ workspace, name, level, command, exitCode, head, indexFiles, output = '', clean = (s) => s }) {
  const tests = []
  const unread = []
  for (const f of reports(workspace, level.junit).filter(isReport)) {
    try {
      tests.push(...testCases(readFileSync(f, 'utf8')).map(({ name, status }) => ({ name, status })))
    } catch (e) {
      unread.push(`${f}: ${e.message}`)
    }
  }
  let observations = {}
  const obs = reportPath(workspace, level.observations)
  if (existsSync(obs)) {
    try {
      const parsed = JSON.parse(clean(readFileSync(obs, 'utf8')))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) observations = parsed
    } catch {} // an unreadable observations file observes nothing; the tests' statuses still decide
  }
  const reason = unread.length ? `unreadable JUnit XML: ${unread.join('; ')}` : tests.length === 0 ? `no test read from ${level.junit}` : undefined
  const tail = output.split('\n').filter((l) => l.trim()).slice(-50).join('\n')
  const out = { run: { level: name, command: command.map(clean), exitCode, ...(head ? { head } : {}), tests, observations, ...(reason ? { reason, ...(tail ? { outputTail: clean(tail) } : {}) } : {}) } }
  if (level.coverage && indexFiles) {
    const at = reportPath(workspace, level.coverage)
    out.coverage = existsSync(at) ? mapCoverage(readCoverage(readFileSync(at, 'utf8')), indexFiles) : { files: {}, unmapped: [`${level.coverage} (not written by the run)`] }
  }
  return out
}

/** Two levels' mapped coverage as one: a line ran if either level ran it, and a branch was taken if either took it. */
export function mergeCoverage(a, b) {
  const files = structuredClone(a.files)
  for (const [path, lines] of Object.entries(b.files)) {
    const into = (files[path] ??= {})
    for (const [n, l] of Object.entries(lines)) {
      const was = into[n]
      const branches = was?.branches && l.branches ? { covered: Math.max(was.branches.covered, l.branches.covered), total: Math.max(was.branches.total, l.branches.total) } : (was?.branches ?? l.branches)
      into[n] = { hits: Math.max(was?.hits ?? 0, l.hits), ...(branches ? { branches } : {}) }
    }
  }
  return { files, unmapped: [...a.unmapped, ...b.unmapped] }
}
