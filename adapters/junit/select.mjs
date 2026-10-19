// The Change set and the selection of one test level for junit/v1 (36-test-levels.md); apart from index.mjs so tests import it
// without starting the Adapter.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, matchesGlob } from 'node:path'

/** The lines that differ from `head`, untracked files whole: file → Set of line numbers in the tree; a deleted file maps to an empty set. */
export function changeSet(cwd, head) {
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '-c', 'core.quotepath=off', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] })
  const changes = new Map()
  let from, file
  for (const line of git('diff', '--unified=0', '--no-color', '--no-ext-diff', '--no-renames', head, '--').split('\n')) {
    if (line.startsWith('--- ')) from = line === '--- /dev/null' ? undefined : line.slice(6)
    else if (line.startsWith('+++ ')) {
      file = line === '+++ /dev/null' ? from : line.slice(6)
      if (!changes.has(file)) changes.set(file, new Set())
    } else if (line.startsWith('@@')) {
      const [, start, count] = /\+(\d+)(?:,(\d+))?/.exec(line)
      for (let i = 0; i < Number(count ?? 1); i++) changes.get(file).add(Number(start) + i)
    }
  }
  for (const f of git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean)) {
    const n = readFileSync(join(cwd, f), 'utf8').split('\n').length
    changes.set(f, new Set(Array.from({ length: n }, (_, i) => i + 1)))
  }
  return changes
}

const matches = (file, globs) => globs.some((g) => matchesGlob(file, g))

/** The changed files a level tests: under its `paths` and still in the tree. */
export const touched = (changes, paths = ['**'], cwd) => [...(changes?.keys() ?? [])].filter((f) => matches(f, paths) && (!cwd || existsSync(join(cwd, f))))

/** What one level runs: {mode: none | affected | full, reason}. `tier` round, baseline or plan; `held` the level whose new red holds this one;
 * `named` the record's tests of this level; `changes` the Change set, absent without a baseline commit. */
export function select({ tier, level, config, changes, named = [], held }) {
  if (tier === 'baseline') return { mode: 'full', reason: 'baseline' }
  if (tier === 'plan') return level === 'unit' && !config.affected ? { mode: 'none', reason: 'the last round ran every unit test over the same tree' } : { mode: 'full', reason: 'plan tier' }
  if (held) return { mode: 'none', reason: `held: ${held}` }
  if (!changes) return { mode: 'full', reason: 'no Change set: no baseline commit' }
  const full = [...changes.keys()].find((f) => matches(f, config.fullOn ?? []))
  if (full) return { mode: 'full', reason: `fullOn: ${full}` }
  const files = touched(changes, config.paths)
  if (files.length || named.length) {
    const why = files.length ? `${files.length} changed file${files.length > 1 ? 's' : ''}` : `${named.length} named test${named.length > 1 ? 's' : ''}`
    return config.affected ? { mode: 'affected', reason: why } : { mode: 'full', reason: why }
  }
  return { mode: 'none', reason: 'untouched' }
}

/** A program with `{base}` replaced by the baseline commit and a `{files}` argument by one argument per file. */
export const expand = (program, { base = '', files = [] }) => program.flatMap((a) => (a === '{files}' ? files : [a.replaceAll('{base}', base)]))

/** The names a record gives for one level: a bare name is a unit test. */
export const namedFor = (record, level) => (record?.verifies ?? []).flatMap((r) => r.tests ?? []).filter((t) => (typeof t === 'string' ? level === 'unit' : t.level === level)).map((t) => (typeof t === 'string' ? t : t.name))

const key = (c) => `${c.classname} > ${c.name}`
const isRed = (c) => c.status === 'failed' || c.status === 'errored'
/** The names no case of `tests` answers, as checkAcceptance matches them. */
export const unmatched = (names, tests) => names.filter((n) => !tests.some((c) => c.name === n || key(c) === n))
/** Red cases its baseline did not have red; every red one without a baseline. */
export function newRed(tests, baseline) {
  const before = new Set((baseline?.tests ?? []).filter(isRed).map(key))
  return new Set(tests.filter(isRed).map(key).filter((k) => !before.has(k))).size
}
