import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gunzipSync } from 'node:zlib'

/**
 * Fetches a template branch and materialises a project from it — the port of
 * `5527313:cli/internal/scaffold/scaffold.go` (decision-00020 §2, design-00004 §6). The
 * semantics of `new`, the messages, and the `.ainpt.json` creation marker are
 * unchanged from the Go implementation; what changed is the mechanism, and only
 * where the standard libraries do not correspond: the tarball is unpacked by
 * shelling out to `tar --strip-components=1` (which is what Go's `stripFirst`
 * did by hand, so that function is gone with it), and `filepath.Match` is a
 * hand-written translator to `RegExp` (see {@link excluded}).
 */

/** One scaffold run's inputs. Go: `scaffold.Options`. */
export interface Options {
  name: string
  lang?: string
  variant?: string
  dir?: string
  ref?: string
  owner: string
  repo: string
  sets?: Record<string, string>
}

/**
 * Where a project came from, so `persimmon update` can three-way merge later
 * template changes. Written as `.ainpt.json` in the project root; the file name
 * and the field order are those of the Go `Lock` struct, so a project scaffolded
 * before the port needs no migration step (spec-00013-FR-3).
 */
export interface Lock {
  template: string
  ref: string
  lang?: string
  variant?: string
  commit: string
  vars?: Record<string, string>
}

interface VarSpec {
  prompt?: string
  default?: string
  when_lang?: string
  when_variant?: string
}

interface Step {
  cmd?: string
  when_lang?: string
  when_variant?: string
}

/** A template branch's `template.json`, as the scaffold reads it. */
export interface Manifest {
  exclude: string[]
  vars: Record<string, VarSpec>
  substitute: string[]
  post_create: Step[]
}

/** An external prerequisite the command calls itself is missing (spec-00013-FR-17). */
class MissingToolError extends Error {}

/** Scaffolds a new project into `<dir>/<name>`. Go: `scaffold.Run`. */
export async function create(options: Options): Promise<void> {
  const ref = resolveRef(options)
  console.log(`Fetching ${options.owner}/${options.repo}@${ref} ...`)
  const src = await fetchTemplate(options.owner, options.repo, `refs/heads/${ref}`).catch((error: unknown) => {
    // A missing `tar` is not a template that could not be found, and the pointer
    // at the listing would be advice that cannot help (spec-00013-FR-17).
    if (error instanceof MissingToolError) throw error
    throw new Error(`${asMessage(error)}\n(run \`persimmon list-langs\` to see available templates)`)
  })

  try {
    const manifest = loadManifest(src)
    const target = join(options.dir ?? '', options.name)
    if (existsSync(target)) throw new Error(`target "${target}" already exists`)

    const vars = resolveVars(manifest, options)
    copyTree(src, target, manifest.exclude)
    substitute(target, manifest.substitute, vars)
    runSteps(target, manifest.post_create, vars, options.lang ?? '', options.variant ?? '')
    await writeLock(target, options, ref, vars)
    console.log(`\nCreated ${target}`)
  } finally {
    rmSync(src, { recursive: true, force: true })
  }
}

/** The branch a run reads its template from. Go: `resolveRef`. */
export function resolveRef(options: Options): string {
  if (options.ref) return options.ref
  if (options.lang && options.variant) return `lang/${options.lang}/${options.variant}`
  if (options.lang) return `lang/${options.lang}`
  return 'main'
}

/**
 * Downloads the branch tarball and unpacks it into a temp dir, stripping the
 * top-level `<repo>-<ref>/` wrapper GitHub adds. Returns the temp root.
 */
async function fetchTemplate(owner: string, repo: string, refPath: string): Promise<string> {
  const url = `https://codeload.github.com/${owner}/${repo}/tar.gz/${refPath}`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`download ${url}: ${response.status} ${response.statusText}`)
  const archive = Buffer.from(await response.arrayBuffer())

  const tmp = mkdtempSync(join(tmpdir(), 'persimmon-'))
  try {
    untar(archive, tmp, url)
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true })
    throw error
  }
  return tmp
}

/**
 * `--strip-components=1` drops the wrapper directory, and tar itself lands the
 * directories, regular files, symlinks and permission bits — the four things the
 * Go reader handled by hand.
 *
 * The gunzip is `node:zlib`'s and not tar's `-z`, because `-z` is not one
 * behaviour: GNU tar execs a separate `gzip` for it while darwin's bsdtar has
 * libz built in, so `-z` made `gzip` an undeclared prerequisite on linux alone
 * (issue-00041). `tar` stays the only command this needs (spec-00013-FR-17).
 */
function untar(archive: Buffer, dir: string, url: string): void {
  let plain: Buffer
  try {
    plain = gunzipSync(archive)
  } catch (error) {
    throw new Error(`${url} did not return a gzip archive: ${asMessage(error)}`)
  }

  const done = spawnSync('tar', ['-xf', '-', '--strip-components=1', '-C', dir], { input: plain })
  if (done.error) {
    if ((done.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new MissingToolError('tar is not on PATH; it is required to unpack the template')
    }
    throw done.error
  }
  if (done.status !== 0) throw new Error(`tar failed to unpack the template: ${String(done.stderr).trim()}`)
}

/** The template branch's manifest. An unreadable or unparseable one is an empty manifest, as it was in Go. */
export function loadManifest(root: string): Manifest {
  const manifest: Manifest = { exclude: [], vars: {}, substitute: [], post_create: [] }
  try {
    Object.assign(manifest, JSON.parse(readFileSync(join(root, 'template.json'), 'utf8')) as Partial<Manifest>)
  } catch {
    // Absent or malformed: the defaults below still hold.
  }
  // These are never copied into a scaffolded project.
  manifest.exclude = [...manifest.exclude, '.git', 'template.json']
  return manifest
}

/** The variable table a run substitutes with. Throws when a declared variable has neither a default nor a `--set`. */
export function resolveVars(manifest: Manifest, options: Options): Record<string, string> {
  const vars: Record<string, string> = { name: options.name }
  for (const [key, value] of Object.entries(options.sets ?? {})) vars[key] = value
  if (vars.PROJECT_NAME === undefined) vars.PROJECT_NAME = options.name

  for (const [key, spec] of Object.entries(manifest.vars)) {
    if (spec.when_lang && spec.when_lang !== (options.lang ?? '')) continue
    if (spec.when_variant && spec.when_variant !== (options.variant ?? '')) continue
    if (vars[key] !== undefined) continue
    if (spec.default) {
      vars[key] = expand(spec.default, vars)
      continue
    }
    throw new Error(`missing required variable "${key}" (pass --set ${key}=VALUE)`)
  }
  return vars
}

function expand(text: string, vars: Record<string, string>): string {
  let out = text
  for (const [key, value] of Object.entries(vars)) out = out.replaceAll(`{{${key}}}`, value)
  return out
}

/**
 * Whether an `exclude` pattern keeps a path out, at creation and at update alike
 * (spec-00013-FR-15). Go: `excluded`, and the shape matters as much as the
 * result: the trailing `/` is trimmed and then **two independent halves** run in
 * turn. The first is a literal string test — equal, or under the pattern plus a
 * `/` — and it is the half that carries `.github/`:
 * `filepath.Match(".github", ".github/workflows/ci.yml")` is `false` while
 * `".github/workflows/ci.yml".startsWith(".github/")` is `true`. Collapsing the
 * two into one glob excludes the directory itself and lets everything beneath it
 * through, which is spec-00013-AC-2.1 failing silently.
 */
export function excluded(rel: string, patterns: string[]): boolean {
  for (const raw of patterns) {
    const pattern = raw.replace(/\/$/, '')
    if (pattern === '') continue
    if (rel === pattern || rel.startsWith(`${pattern}/`)) return true
    if (globMatch(pattern, rel)) return true
  }
  return false
}

const globCache = new Map<string, RegExp | null>()

/**
 * The glob half of {@link excluded}. A pattern Go calls `ErrBadPattern` — `[a-`,
 * `[]a]`, `*[` — is neither a match nor an error, because the Go caller dropped
 * the error return (spec-00013-FR-16).
 */
function globMatch(pattern: string, name: string): boolean {
  if (!globCache.has(pattern)) {
    let compiled: RegExp | null = null
    try {
      compiled = translateGlob(pattern)
    } catch {
      compiled = null
    }
    globCache.set(pattern, compiled)
  }
  return globCache.get(pattern)?.test(name) ?? false
}

/**
 * `filepath.Match` as a `RegExp`. `path.matchesGlob` cannot stand in: Go's
 * `[^A-Z]` is a negated class where Node's is not, and Go's `\*` escapes where
 * Node's does not — both appear in real `exclude` patterns (design-00004 §6).
 *
 * Only `*` and `?` stop at `/`; a character class is not separator-constrained,
 * so `[^A-Z]` and `[/]` both match `/` and `/` is never removed from a class the
 * user wrote. `!` inside a class is a literal member — the negation character is
 * `^` alone, which is where minimatch's reading would have been wrong. The whole
 * pattern is anchored. Throws on the patterns Go rejects.
 */
function translateGlob(pattern: string): RegExp {
  let source = '^'
  let i = 0
  while (i < pattern.length) {
    const char = pattern.charAt(i)
    if (char === '*') {
      source += '[^/]*'
      i += 1
    } else if (char === '?') {
      source += '[^/]'
      i += 1
    } else if (char === '[') {
      const parsed = translateClass(pattern, i)
      source += parsed.source
      i = parsed.next
    } else if (char === '\\') {
      if (i + 1 >= pattern.length) throw new Error(`bad pattern ${pattern}`)
      source += escapeLiteral(pattern.charAt(i + 1))
      i += 2
    } else {
      source += escapeLiteral(char)
      i += 1
    }
  }
  return new RegExp(`${source}$`, 's')
}

/** One `[...]` class, following Go's `getEsc`: `-` and `]` cannot open a range, and the class must be closed and non-empty. */
function translateClass(pattern: string, start: number): { source: string; next: number } {
  let i = start + 1
  const negated = pattern.charAt(i) === '^'
  if (negated) i += 1

  const parts: string[] = []
  let ranges = 0
  for (;;) {
    if (pattern.charAt(i) === ']' && ranges > 0) {
      i += 1
      break
    }
    const lo = readClassChar(pattern, i)
    let hi = lo
    i = lo.next
    if (pattern.charAt(i) === '-') {
      hi = readClassChar(pattern, i + 1)
      i = hi.next
    }
    // Go compares `lo <= r && r <= hi`, so an inverted range simply never
    // matches; a RegExp with one in it would not compile at all.
    if (lo.char <= hi.char) parts.push(lo === hi ? escapeClass(lo.char) : `${escapeClass(lo.char)}-${escapeClass(hi.char)}`)
    ranges += 1
  }

  // Every range was inverted: the class matches nothing, and its negation everything.
  if (parts.length === 0) return { source: negated ? '[\\s\\S]' : '[^\\s\\S]', next: i }
  return { source: `[${negated ? '^' : ''}${parts.join('')}]`, next: i }
}

function readClassChar(pattern: string, at: number): { char: string; next: number } {
  let i = at
  const first = pattern.charAt(i)
  if (first === '' || first === '-' || first === ']') throw new Error(`bad pattern ${pattern}`)
  if (first === '\\') {
    i += 1
    if (i >= pattern.length) throw new Error(`bad pattern ${pattern}`)
  }
  const char = String.fromCodePoint(pattern.codePointAt(i) as number)
  const next = i + char.length
  // Go's getEsc rejects a class character that ends the pattern: the `]` is missing.
  if (next >= pattern.length) throw new Error(`bad pattern ${pattern}`)
  return { char, next }
}

function escapeLiteral(char: string): string {
  return /[.*+?^${}()|[\]\\/]/.test(char) ? `\\${char}` : char
}

function escapeClass(char: string): string {
  return /[\\\]^\-[]/.test(char) ? `\\${char}` : char
}

/**
 * The template tree, minus what the manifest excludes, materialised at `dst`.
 * Go: `copyTree`. An excluded directory is pruned whole, and a symlink is copied
 * as a symlink — reading through it would leave a second, independent copy of
 * its target, the one thing the link exists to avoid.
 */
export function copyTree(src: string, dst: string, exclude: string[]): void {
  for (const entry of walkTree(src, exclude)) {
    const target = join(dst, entry.rel)
    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true, mode: 0o755 })
      continue
    }
    mkdirSync(dirname(target), { recursive: true, mode: 0o755 })
    if (entry.isSymbolicLink) {
      symlinkSync(readlinkSync(entry.path), target)
      continue
    }
    writeFileSync(target, readFileSync(entry.path), { mode: entry.mode })
  }
}

export interface TreeEntry {
  rel: string
  path: string
  isDirectory: boolean
  isSymbolicLink: boolean
  mode: number
}

/**
 * Every path under `root` that the exclusion set lets through, parents before
 * children and in name order — Go's `filepath.Walk` with the `SkipDir` an
 * excluded directory earns, which is why nothing beneath one is ever visited.
 */
export function* walkTree(root: string, exclude: string[], rel = ''): Generator<TreeEntry> {
  for (const name of readdirSync(join(root, rel)).sort()) {
    const childRel = rel === '' ? name : `${rel}/${name}`
    if (excluded(childRel, exclude)) continue
    const path = join(root, childRel)
    const stat = lstatSync(path)
    const entry: TreeEntry = {
      rel: childRel,
      path,
      isDirectory: stat.isDirectory(),
      isSymbolicLink: stat.isSymbolicLink(),
      mode: stat.mode & 0o777,
    }
    yield entry
    if (entry.isDirectory) yield* walkTree(root, exclude, childRel)
  }
}

/** Expands the placeholders in each listed file. A file the branch does not have is skipped quietly. */
export function substitute(root: string, files: string[], vars: Record<string, string>): void {
  for (const file of files) {
    const path = join(root, file)
    let body: string
    try {
      body = readFileSync(path, 'utf8')
    } catch {
      continue // listed but absent — skip quietly
    }
    writeFileSync(path, expand(body, vars), { mode: 0o644 })
  }
}

/** Runs the manifest's `post_create` steps, in declaration order, inside the new project. */
export function runSteps(dir: string, steps: Step[], vars: Record<string, string>, lang: string, variant: string): void {
  for (const step of steps) {
    if (step.when_lang && step.when_lang !== lang) continue
    if (step.when_variant && step.when_variant !== variant) continue
    const cmd = expand(step.cmd ?? '', vars)
    console.log(`  post-create: ${cmd}`)
    const done = spawnSync('sh', ['-c', cmd], { cwd: dir, stdio: 'inherit' })
    if (done.error) throw new Error(`post_create "${cmd}": ${done.error.message}`)
    if (done.status !== 0) throw new Error(`post_create "${cmd}": exited with status ${done.status}`)
  }
}

/** Writes the creation marker. A commit that cannot be resolved is a warning, not a failure (spec-00013-AC-5.6). */
async function writeLock(target: string, options: Options, ref: string, vars: Record<string, string>): Promise<void> {
  let commit = ''
  try {
    commit = await resolveSHA(options.owner, options.repo, ref)
  } catch {
    console.log('  warning: could not record template commit; `persimmon update` will need it set manually')
  }

  // Sorted, because Go marshalled a map and the marker's bytes are part of the
  // contract. `PROJECT_NAME` is always resolved, so the table is never empty and
  // Go's `omitempty` on this field never fired.
  const recorded: Record<string, string> = {}
  for (const key of Object.keys(vars).sort()) {
    if (key !== 'name') recorded[key] = vars[key] as string
  }

  const lock: Lock = {
    template: `${options.owner}/${options.repo}`,
    ref,
    ...(options.lang ? { lang: options.lang } : {}),
    ...(options.variant ? { variant: options.variant } : {}),
    commit,
    vars: recorded,
  }
  writeFileSync(join(target, '.ainpt.json'), `${JSON.stringify(lock, null, 2)}\n`, { mode: 0o644 })
}

async function resolveSHA(owner: string, repo: string, ref: string): Promise<string> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${ref}`
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github.sha' } })
  if (!response.ok) throw new Error(`resolve sha for ${ref}: ${response.status} ${response.statusText}`)
  return (await response.text()).trim()
}

/** What the three-way merge needs, once the project's marker and the upstream trees have been read. */
export interface UpdateContext {
  dir: string
  lock: Lock
  newSHA: string
  oldSrc: string
  newSrc: string
  manifest: Manifest
}

/**
 * The first half of `persimmon update`: the creation marker, the upstream
 * commit, and the two template trees the merge runs between. `null` means the
 * project is already at the upstream commit and there is nothing to merge.
 *
 * Everything that can refuse the run happens before the merge — and the template
 * coordinate is checked before any request goes out (issue-00034). The merge
 * itself, and the removal of the two temp trees, are {@link update}'s.
 */
export async function prepareUpdate(dir = '.'): Promise<UpdateContext | null> {
  const target = dir === '' ? '.' : dir
  let raw: string
  try {
    raw = readFileSync(join(target, '.ainpt.json'), 'utf8')
  } catch {
    throw new Error(`no .ainpt.json in "${target}" — was this project created by persimmon?`)
  }

  let lock: Lock
  try {
    lock = JSON.parse(raw) as Lock
  } catch (error) {
    throw new Error(`parse .ainpt.json: ${asMessage(error)}`)
  }
  if (!lock.commit) throw new Error('.ainpt.json has no base commit; cannot 3-way merge')

  const cut = lock.template?.indexOf('/') ?? -1
  const owner = cut < 0 ? '' : lock.template.slice(0, cut)
  const repo = cut < 0 ? '' : lock.template.slice(cut + 1)
  if (owner === '' || repo === '' || repo.includes('/')) {
    throw new Error(`invalid template "${lock.template}" in .ainpt.json — expected owner/repo`)
  }

  const newSHA = await resolveSHA(owner, repo, lock.ref)
  if (newSHA === lock.commit) {
    console.log('Already up to date.')
    return null
  }
  console.log(`Updating ${lock.template}@${lock.ref}: ${short(lock.commit)} -> ${short(newSHA)}`)

  const oldSrc = await fetchTemplate(owner, repo, lock.commit)
  let newSrc: string
  try {
    newSrc = await fetchTemplate(owner, repo, `refs/heads/${lock.ref}`)
  } catch (error) {
    rmSync(oldSrc, { recursive: true, force: true })
    throw error
  }

  return { dir: target, lock, newSHA, oldSrc, newSrc, manifest: loadManifest(newSrc) }
}

function short(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** What {@link mergeTree} did, for the summary {@link update} prints. Go: `mergeResult`. */
export interface MergeResult {
  added: number
  merged: number
  /** Upstream files left deleted because the project had deleted them. */
  kept: number
  conflicts: string[]
}

/**
 * Folds the template tree at `newSrc` into the project at `dir`, using `oldSrc`
 * — the template as it stood when the project was created or last updated — as
 * the merge base. Go: `mergeTree`.
 *
 * Two rules here are easy to get wrong, and both were, in ways that only show up
 * on the second `persimmon update` of a real project rather than on the first:
 *
 * Exclusions are tested on directories as well as files, and a directory that
 * matches is pruned whole — exactly what {@link copyTree} does at creation, and
 * for the same reason {@link walkTree} is the one walk both share. A pattern is
 * not obliged to match at every depth: `docs/*\/[^A-Z]*` matches the DIRECTORY
 * `docs/reference/axon-framework` and nothing inside it, since `*` never crosses
 * a separator. Testing files alone therefore reinstates on update precisely what
 * creation had dropped (spec-00013-AC-15.5).
 *
 * A file the base has and the project does not was deleted deliberately, and a
 * three-way merge honours a deletion. Everything `template.json`'s `post_create`
 * removes is this case, and treating it as "new upstream file" resurrects it on
 * every update, forever. Only a file absent from the BASE is genuinely new.
 */
export function mergeTree(dir: string, oldSrc: string, newSrc: string, exclude: string[]): MergeResult {
  const result: MergeResult = { added: 0, merged: 0, kept: 0, conflicts: [] }
  let emptyBase = ''

  try {
    for (const entry of walkTree(newSrc, exclude)) {
      if (entry.isDirectory) continue

      const mine = join(dir, entry.rel)
      const base = join(oldSrc, entry.rel)
      const inBase = lexists(base)

      if (entry.isSymbolicLink) {
        mergeSymlink(result, entry, mine, base, inBase)
        continue
      }

      if (!lexists(mine)) {
        if (inBase) {
          result.kept += 1
          continue
        }
        // New upstream file — add it verbatim.
        mkdirSync(dirname(mine), { recursive: true, mode: 0o755 })
        writeFileSync(mine, readFileSync(entry.path), { mode: entry.mode })
        result.added += 1
        continue
      }

      if (!inBase && emptyBase === '') emptyBase = emptyAncestor()
      if (mergeFile(entry.rel, mine, inBase ? base : emptyBase, entry.path)) result.conflicts.push(entry.rel)
      result.merged += 1
    }
  } finally {
    if (emptyBase !== '') rmSync(dirname(emptyBase), { recursive: true, force: true })
  }
  return result
}

/**
 * In-place three-way merge — the project's edits kept, the upstream delta folded
 * in. Returns whether the two overlapped, which is a conflict and not a failure;
 * anything that stops `git` from running at all is (spec-00013-FR-12: on a
 * machine with no `git` the first file that needs merging is where `update`
 * fails, and the half-updated tree stands).
 *
 * The three labels are those of `5527313:cli/internal/scaffold/scaffold.go:520-522`,
 * verbatim: they are what the reader of a conflicted file sees.
 */
function mergeFile(rel: string, mine: string, base: string, theirs: string): boolean {
  const args = ['merge-file', '-L', 'yours', '-L', 'template (old)', '-L', 'template (new)', mine, base, theirs]
  const done = spawnSync('git', args, { stdio: ['ignore', 'ignore', 'inherit'] })
  if (done.error) throw new Error(`merge ${rel}: ${done.error.message}`)
  return done.status !== 0
}

/**
 * The common ancestor for an upstream file that is new since the base but that
 * the project already has: an empty regular file rather than `/dev/null`. The
 * two produce byte-identical conflict output, and a plain file states "the
 * ancestor is empty" without depending on a special file (design-00004 §6).
 */
function emptyAncestor(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'persimmon-base-')), 'empty')
  writeFileSync(path, '')
  return path
}

/**
 * Folds an upstream symlink into the project. Go: `mergeSymlink`. `git
 * merge-file` must not be used here: handed a symlink it writes through to the
 * target, so merging `CLAUDE.md -> AGENTS.md` would overwrite AGENTS.md with the
 * merge result. There is nowhere to put conflict markers either, so a real
 * divergence is reported and the project's link left exactly as it is.
 */
function mergeSymlink(result: MergeResult, entry: TreeEntry, mine: string, base: string, inBase: boolean): void {
  const want = readlinkSync(entry.path)

  if (!lexists(mine)) {
    // Same deletion rule as regular files: only a link absent from the base is new.
    if (inBase) {
      result.kept += 1
      return
    }
    mkdirSync(dirname(mine), { recursive: true, mode: 0o755 })
    symlinkSync(want, mine)
    result.added += 1
    return
  }

  if (readlinkOr(mine) === want) {
    result.merged += 1
    return
  }
  // The project's version differs — a retarget, or a real file put in the link's
  // place. If the template has not touched the link since the base, that
  // difference is the project's own decision and stands; reporting it would
  // conflict on every update.
  if (readlinkOr(base) === want) {
    result.merged += 1
    return
  }
  result.conflicts.push(`${entry.rel} (symlink -> ${want} upstream; left as the project had it)`)
}

/** Whether the path itself exists, without following a link. Go: `os.Lstat` for its error alone. */
function lexists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** What the path points at, or `null` when it is not a symlink at all. */
function readlinkOr(path: string): string | null {
  try {
    return readlinkSync(path)
  } catch {
    return null
  }
}

/**
 * Three-way merges upstream template changes into an existing project. Go:
 * `Update`. Throws on failure, so the command layer's exit code is the presence
 * of a throw — a conflict left in the working tree is not one (spec-00013-FR-9:
 * the markers are in the tree and the base advances, so the next update
 * continues from this upstream commit).
 */
export async function update(dir: string): Promise<void> {
  const ready = await prepareUpdate(dir)
  if (ready === null) return

  let result: MergeResult
  try {
    result = mergeTree(ready.dir, ready.oldSrc, ready.newSrc, ready.manifest.exclude)
  } finally {
    rmSync(ready.oldSrc, { recursive: true, force: true })
    rmSync(ready.newSrc, { recursive: true, force: true })
  }

  const advanced: Lock = { ...ready.lock, commit: ready.newSHA }
  writeFileSync(join(ready.dir, '.ainpt.json'), `${JSON.stringify(advanced, null, 2)}\n`, { mode: 0o644 })

  console.log(`\nMerged ${result.merged} file(s), added ${result.added} new file(s).`)
  if (result.kept > 0) console.log(`Left ${result.kept} file(s) alone that this project had deleted.`)
  if (result.conflicts.length > 0) {
    console.log(`${result.conflicts.length} file(s) have conflicts to resolve:`)
    for (const conflict of result.conflicts) console.log(`  ${conflict}`)
    console.log('Resolve each, then commit. Text files carry <<<<<<< markers.')
    return
  }
  console.log('No conflicts. Review the diff and commit.')
}
