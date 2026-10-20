// The mutants of the Rewrite pack (40-pack-rewrite.md): the Tester writes one patch per reached item, the runner applies it
// to a scratch clone of the source and reruns the tests citing the item. Here what is decided without running anything:
// whether a diff keeps to its item's lines and to mutant-rules, and what a mutant's reruns mean. The runner holds the diff
// the clone shows after the patch, not only the patch text: `git apply` may land a hunk at an offset.
import { parseWhere } from './check.mjs'
import { cites } from './ledger.mjs'

/** A unified or git diff as `[{path, created, deleted, renamed, binary, hunks: [{oldStart, oldCount, added: [text]}]}]`.
 * Headers are read only between hunks and a hunk ends when its counts are spent, so a removed line `-- x` (a SQL or COBOL
 * comment) is never taken for a `---` header. */
export function parseDiff(diff) {
  const files = []
  let file
  let hunk
  let old = 0
  let neu = 0
  const open = () => (file = { path: undefined, created: false, deleted: false, renamed: false, binary: false, hunks: [] }, files.push(file), file)
  for (const line of diff.split(/\r?\n/)) {
    if (hunk && (old > 0 || neu > 0)) {
      if (line.startsWith('-')) old--
      else if (line.startsWith('+')) (neu--, hunk.added.push(line.slice(1)))
      else if (line.startsWith(' ') || line === '') (old--, neu--)
      continue // `\ No newline at end of file` changes no count
    }
    hunk = undefined
    const at = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (at && file) {
      ;[old, neu] = [at[2] === undefined ? 1 : Number(at[2]), at[4] === undefined ? 1 : Number(at[4])]
      hunk = { oldStart: Number(at[1]), oldCount: old, added: [] }
      file.hunks.push(hunk)
      continue
    }
    if (line.startsWith('diff --git ')) {
      open().git = true
      const b = / b\/(.*)$/.exec(line) // a header with no ---/+++ (a mode change) still names its file
      if (b) file.path = b[1]
    }
    else if (line.startsWith('--- ')) {
      if (!file || file.hunks.length || (file.path !== undefined && !file.git)) open() // a plain unified diff has no `diff --git` line
      if (line.slice(4).trim() === '/dev/null') file.created = true
    } else if (line.startsWith('+++ ') && file) {
      const p = line.slice(4).trim().replace(/\t.*$/, '')
      if (p === '/dev/null') file.deleted = true
      else file.path = p.replace(/^b\//, '')
    } else if (file && /^new file mode/.test(line)) file.created = true
    else if (file && /^deleted file mode/.test(line)) file.deleted = true
    else if (file && /^(rename|copy) (from|to) /.test(line)) file.renamed = true
    else if (file && (/^Binary files /.test(line) || line === 'GIT binary patch')) file.binary = true
  }
  return files
}

// a mutant that crashes proves only that the app noticed a crash: mutant-rules never add one. A list cannot name every crash
// (a null dereference, a division by a variable); the auditor samples the rest
const crash = /\b(throw|raise|exit|panic|abort|halt|assert|System\.exit|process\.exit|os\._exit|Runtime\.getRuntime)\b|\bSTOP\s+RUN\b|\bGOBACK\b|\/\s*0(?![\d.])|\bwhile\s*\(\s*(true|1)\s*\)|\bfor\s*\(\s*;\s*;\s*\)|\bloop\s*\{|new\s+\w+\s*\[\s*-/i

/** Why a diff is no mutant of the item, or undefined: it creates, deletes, renames no file and holds no binary; every hunk
 * changes or inserts lines inside one of the item's line spans only; at least one line changes; no crash is added. */
export function diffFault(files, where) {
  const spans = (where ?? []).map(parseWhere).filter((w) => w?.from !== undefined)
  if (!files.some((f) => f.hunks.length)) return 'the patch changes no line of the source'
  for (const f of files) {
    if (!f.hunks.length) return `the patch changes ${f.path ?? 'a file'} without changing a line (its mode, say): a mutant changes the item's lines only`
    if (f.created || f.deleted || f.renamed || f.binary) return `the patch ${f.created ? 'creates' : f.deleted ? 'deletes' : f.renamed ? 'renames' : 'changes a binary'} ${f.path ?? 'a file'}: a mutant changes the item's lines only`
    for (const h of f.hunks) {
      // a hunk removing lines spans them; one only inserting sits after oldStart, between it and the next line
      const [a, b] = h.oldCount > 0 ? [h.oldStart, h.oldStart + h.oldCount - 1] : [h.oldStart, h.oldStart]
      const inside = spans.some((s) => s.path === f.path && (h.oldCount > 0 ? a >= s.from && b <= s.to : a >= s.from - 1 && a <= s.to))
      if (!inside) return `the patch changes ${f.path}:${a}${b !== a ? `-${b}` : ''}, outside the item's where`
      const bad = h.added.find((l) => crash.test(l))
      if (bad) return `the patch adds a crash, which mutant-rules forbid: ${bad.trim()}`
    }
  }
  return undefined
}

/** The patch text held to the item's where, before it is applied. */
export const patchFault = (patch, where) => diffFault(parseDiff(patch), where)

/** What a mutant's reruns mean: `killed`, naming the tests citing the item that failed on an assertion; `invalid` when none
 * ran to an answer (the mutant did not build or start); else `survived`. `before` are the tests green on the source. */
export function mutantResult(ref, reruns, before) {
  const citing = reruns.filter((t) => cites(t.name, ref) && before.includes(t.name))
  const failed = citing.filter((t) => t.status === 'failed').map((t) => t.name)
  if (failed.length) return { ref, result: 'killed', failed }
  if (!citing.length || citing.every((t) => t.status === 'errored' || t.status === 'missing')) return { ref, result: 'invalid', failed: [], reason: citing.length ? 'no test citing it ran to an answer: the mutant did not build or start' : 'no test green on the source cites it' }
  return { ref, result: 'survived', failed: [] }
}
