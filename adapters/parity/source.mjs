// The source index of the Rewrite pack (40-pack-rewrite.md): the Source system's checkout read once into a value every
// check binds, since no Gate reads a checkout (14-gate.md). Apart from the Adapters so tests import it without starting one.
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { extname, isAbsolute, join, resolve } from 'node:path'

const git = (cwd, ...args) => execFileSync('git', ['--no-optional-locks', '-c', 'core.quotepath=off', ...args], { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).trimEnd()

/** The git directory the repository's worktrees share, real path; undefined outside a repository. */
function commonDir(dir) {
  try {
    const d = git(dir, 'rev-parse', '--git-common-dir')
    return realpathSync(isAbsolute(d) ? d : resolve(dir, d))
  } catch {
    return undefined
  }
}

/** The text with every comment and string blanked, newlines kept, so a keyword inside one is never read as code. Quotes
 * that open a span closing on a later line (a template literal, a text block, a docstring) carry over; any other string
 * ends at its line, so a Rust lifetime or a stray apostrophe cannot swallow the file. */
function mask(text, { line = [], block = [], spans = [], strings = [] }) {
  let out = ''
  let i = 0
  const at = (s) => text.startsWith(s, i)
  const blank = (s) => s.replace(/[^\n]/g, ' ')
  const skipTo = (close, eol) => {
    const start = i
    for (; i < text.length; i++) {
      if (text[i] === '\\') {
        i++
        continue
      }
      if (eol && text[i] === '\n') break
      if (text.startsWith(close, i)) {
        i += close.length
        break
      }
    }
    out += blank(text.slice(start, i))
  }
  while (i < text.length) {
    const lc = line.find(at)
    if (lc) {
      const end = text.indexOf('\n', i)
      const stop = end === -1 ? text.length : end
      out += blank(text.slice(i, stop))
      i = stop
      continue
    }
    const b = block.find(([o]) => at(o)) ?? spans.find(([o]) => at(o))
    if (b) {
      out += blank(b[0])
      i += b[0].length
      skipTo(b[1], false)
      continue
    }
    const q = strings.find(at)
    if (q) {
      out += ' '
      i += q.length
      skipTo(q, true)
      continue
    }
    out += text[i++]
  }
  return out
}

const spacedTernary = String.raw`\s\?\s(?!extends\b|super\b)[^?:;]*\s:(?!:)`
const c = {
  mask: { line: ['//'], block: [['/*', '*/']], spans: [['"""', '"""'], ['`', '`']], strings: ['"', "'"] },
  // `if` with or without parentheses (Go, Rust, Swift), every `case` arm but a Scala case class, a catch, a Kotlin `when`
  // block (not Mockito's `when(...)` call), a spaced ternary (not `?.`, a nullable type, a wildcard)
  branch: new RegExp(String.raw`\bif\b|\bcase\b(?!\s+(class|object)\b)|\bcatch\b|\bwhen\b\s*(\([^)]*\))?\s*\{|${spacedTernary}`),
}
const languages = {
  java: c, kt: c, kts: c, scala: c, groovy: c, cs: c, go: c, swift: c, dart: c, rs: c, php: c,
  js: c, mjs: c, cjs: c, jsx: c, ts: c, tsx: c, c, cc: c, cpp: c, h: c, hpp: c,
  py: { mask: { line: ['#'], spans: [['"""', '"""'], ["'''", "'''"]], strings: ['"', "'"] }, branch: /^\s*(if|elif|except|case)\b|\bif\b.*\belse\b/ },
  rb: { mask: { line: ['#'], spans: [['=begin', '=end']], strings: ['"', "'"] }, branch: new RegExp(String.raw`^\s*(if|elsif|unless|when|rescue)\b|\b(if|unless)\b\s+\S|${spacedTernary}`) },
  cbl: 'cobol', cob: 'cobol', cpy: 'cobol',
}
// a keyword never inside a data name: `WS-IF-FLAG` is a name, `END-IF` closes a branch and starts none
const word = (k) => String.raw`(?<![\w-])${k}(?![\w-])`
const cobol = new RegExp(['IF', 'WHEN', 'UNTIL', String.raw`INVALID\s+KEY`, String.raw`AT\s+END`, String.raw`ON\s+SIZE\s+ERROR`, String.raw`ON\s+OVERFLOW`, String.raw`ON\s+EXCEPTION`].map(word).join('|'), 'i')

/** COBOL code by line: fixed format drops the sequence and indicator areas and comment lines, free format `*>` comments. */
function cobolCode(text) {
  const free = /^\s*>>\s*SOURCE\s+(FORMAT\s+)?(IS\s+)?FREE\b/im.test(text)
  return text.split(/\r?\n/).map((raw) => {
    let code
    if (free) code = raw
    else if (raw.length > 6 && '*/'.includes(raw[6])) return ''
    else code = raw.slice(7, 72)
    return code.replace(/\*>.*$/, '').replace(/"[^"]*"|'[^']*'/g, '""')
  })
}

/** The lines of a source file that start a branch, by its extension; null for a language with no keyword table. */
export function branchLines(path, text) {
  const lang = languages[extname(path).slice(1).toLowerCase()]
  if (!lang) return null
  const lines = lang === 'cobol' ? cobolCode(text) : mask(text, lang.mask).split(/\r?\n/)
  const branch = lang === 'cobol' ? cobol : lang.branch
  return lines.flatMap((code, i) => (branch.test(code) ? [i + 1] : []))
}

const lineCount = (buf) => {
  let n = 0
  for (const b of buf) if (b === 10) n++
  return buf.length && buf[buf.length - 1] !== 10 ? n + 1 : n
}

/** The checkout's commit and the tracked files it changed, read now: what a run measured is the commit's only if both hold. */
export function sourceState(dir) {
  return { commit: git(dir, 'rev-parse', 'HEAD'), dirty: git(dir, 'status', '--porcelain', '--untracked-files=no', '-z').split('\0').filter(Boolean).map((l) => l.slice(3)) }
}

/** `{commit, dirty, root, gitCommonDir, project: {root, gitCommonDir}, files: {<path>: {lines, branchLines}}}`: every
 * tracked regular file of the checkout; binary files skipped, symlinks not followed; paths relative to the repository root. */
export function indexSource(sourceDir, projectDir) {
  let top
  try {
    top = realpathSync(git(sourceDir, 'rev-parse', '--show-toplevel'))
    git(top, 'rev-parse', '--verify', 'HEAD')
  } catch {
    throw new Error(`${sourceDir} is not a git checkout with a commit: the Source system is read at one commit`)
  }
  const files = {}
  // ponytail: every tracked file is read; a large monorepo pays seconds here, index only the Slice's files if that matters
  for (const path of git(top, 'ls-files', '-z').split('\0').filter(Boolean)) {
    const full = join(top, path)
    let st
    try {
      st = lstatSync(full)
    } catch {
      continue // deleted in the working tree: dirty names it
    }
    if (!st.isFile()) continue // a symlink, read as its target, could leave the repository; a submodule is a directory
    const buf = readFileSync(full)
    if (buf.includes(0)) continue
    files[path] = { lines: lineCount(buf), branchLines: st.size > 4 << 20 ? null : branchLines(path, buf.toString('utf8')) }
  }
  const dirty = git(top, 'status', '--porcelain', '--untracked-files=no', '-z').split('\0').filter(Boolean).map((l) => l.slice(3))
  const project = realpathSync(projectDir)
  return { commit: git(top, 'rev-parse', 'HEAD'), dirty, root: top, gitCommonDir: commonDir(top), project: { root: project, gitCommonDir: commonDir(project) }, files }
}
