import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Lock, type Options, copyTree, create, excluded, mergeTree, prepareUpdate, resolveRef, update } from '../src/scaffold.ts'

/**
 * The equivalent translation of `cli/internal/scaffold/scaffold_test.go`, plus
 * the cases the three new requirements and the 90/90/90 bar ask for.
 * `TestUpdateMergesOnAMachineWithoutNode`:1090 is the one case not translated:
 * it proved that `update` needs git and not Node, which stopped meaning anything
 * once the command itself became a Node program (plan-00034 T2b).
 *
 * The template repository is a real local HTTP server for every case that
 * fetches: `fetch` is spied on and its origin rewritten, so both
 * codeload.github.com and api.github.com are answered without touching the
 * network.
 */

const STUB_OWNER = 'acme'
const STUB_REPO = 'tpl'
const BASE_SHA = 'abc1230000000000000000000000000000000000'
const HEAD_SHA = 'def4560000000000000000000000000000000000'

/** The real `tar`, resolved while PATH is still whole, for {@link withoutGit}. */
const TAR = spawnSync('sh', ['-c', 'command -v tar']).stdout.toString().trim()

const made: string[] = []
const servers: Server[] = []
const REAL_PATH = process.env.PATH

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const server of servers.splice(0)) server.close()
  process.env.PATH = REAL_PATH
  vi.restoreAllMocks()
})

/** A temporary directory, removed after the test. */
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'persimmon-test-'))
  made.push(dir)
  return dir
}

/** Materialises a map of slash-separated paths to contents under root. */
function writeTree(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
  }
}

function exists(root: string, rel: string): boolean {
  try {
    lstatSync(join(root, rel))
    return true
  } catch {
    return false
  }
}

/** Materialises rel as a symlink to target, the shape CLAUDE.md -> AGENTS.md has. */
function writeLink(root: string, rel: string, target: string): void {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path)
}

/** Fails the test unless rel is a symlink, then returns what it points at. */
function linkTarget(root: string, rel: string): string {
  const path = join(root, rel)
  expect(lstatSync(path).isSymbolicLink(), `${rel} is a regular file, not a symlink`).toBe(true)
  return readlinkSync(path)
}

function readFile(root: string, rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

/**
 * A tarball in the shape codeload serves a branch: every entry under one
 * top-level wrapper directory, which `--strip-components=1` strips. Built by
 * `tar` itself, eagerly — a case that takes `tar` off PATH must still be served
 * an archive.
 */
function tarball(tree: Record<string, string>): Buffer {
  const staging = tmp()
  mkdirSync(join(staging, 'root'), { recursive: true })
  writeTree(join(staging, 'root'), tree)
  const done = spawnSync('tar', ['-czf', '-', '-C', staging, 'root'], { maxBuffer: 64 * 1024 * 1024 })
  expect(done.status, String(done.stderr)).toBe(0)
  return done.stdout
}

/**
 * Serves the template repository's two endpoints and points every outgoing
 * request at them for the test's duration. `heads` answers the commit lookup for
 * a ref (one missing from it answers 404, which is how a failed lookup is
 * provoked); `trees` holds the tree behind each ref, keyed by branch name and by
 * commit sha.
 */
async function stubGitHub(heads: Record<string, string>, trees: Record<string, Record<string, string>>): Promise<void> {
  const archives = new Map(Object.entries(trees).map(([ref, tree]) => [ref, tarball(tree)]))
  const commitPrefix = `repos/${STUB_OWNER}/${STUB_REPO}/commits/`
  const downloadPrefix = `${STUB_OWNER}/${STUB_REPO}/tar.gz/`

  const server = createServer((req, res) => {
    const path = (req.url ?? '').replace(/^\//, '')
    if (path.startsWith(commitPrefix)) {
      const sha = heads[path.slice(commitPrefix.length)]
      if (sha === undefined) return void res.writeHead(404).end('not found')
      return void res.end(`${sha}\n`)
    }
    if (path.startsWith(downloadPrefix)) {
      const archive = archives.get(path.slice(downloadPrefix.length).replace(/^refs\/heads\//, ''))
      if (archive === undefined) return void res.writeHead(404).end('not found')
      return void res.end(archive)
    }
    res.writeHead(404).end('not found')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  servers.push(server)

  const port = (server.address() as AddressInfo).port
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input))
    url.protocol = 'http:'
    url.host = `127.0.0.1:${port}`
    return real(url, init)
  })
}

/**
 * Collects what the command printed. It must be `console.log` on the other side:
 * a `process.stdout.write` would leave this fixture with nothing to show and the
 * output assertions passing on an empty string (plan-00034, cross-task rules).
 */
function capture(): () => string {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
  return () => spy.mock.calls.map((call) => call.join(' ')).join('\n')
}

/** Scaffolds a project out of tree into a fresh parent directory. */
async function runNew(
  overrides: Partial<Options>,
  tree: Record<string, string>,
): Promise<{ dir: string; parent: string; out: string; error?: Error }> {
  const options: Options = { name: 'demo', dir: tmp(), owner: STUB_OWNER, repo: STUB_REPO, ...overrides }
  const ref = resolveRef(options)
  await stubGitHub({ [ref]: HEAD_SHA }, { [ref]: tree })
  const out = capture()
  let error: Error | undefined
  await create(options).catch((thrown: Error) => {
    error = thrown
  })
  return { dir: join(options.dir as string, options.name), parent: options.dir as string, out: out(), error }
}

/** The creation marker as `new` writes it — and as a project scaffolded by ainpt before the move carries it. */
function marker(sha: string): string {
  return `{\n  "template": "${STUB_OWNER}/${STUB_REPO}",\n  "ref": "main",\n  "commit": "${sha}"\n}\n`
}

function readLock(dir: string): Lock {
  return JSON.parse(readFile(dir, '.ainpt.json')) as Lock
}

/** Runs `update` with its output captured, the way the command layer will call it. */
async function runUpdate(dir: string): Promise<{ out: string; error?: Error }> {
  const out = capture()
  let error: Error | undefined
  await update(dir).catch((thrown: Error) => {
    error = thrown
  })
  return { out: out(), error }
}

/** Points the stub repository at the tree the branch held at the marker's merge base and the tree it holds now. */
async function stubUpdateRepo(base: Record<string, string>, head: Record<string, string>): Promise<void> {
  await stubGitHub({ main: HEAD_SHA }, { [BASE_SHA]: base, main: head })
}

/**
 * A PATH holding `tar` and nothing else. The Go cases emptied PATH outright, but
 * the port unpacks the template with a shelled-out `tar`: emptying PATH would
 * fail the download instead of the merge, and prove nothing about
 * spec-00013-FR-12.
 */
function withoutGit(): void {
  const bin = tmp()
  symlinkSync(TAR, join(bin, 'tar'))
  process.env.PATH = bin
}

/** Empties PATH so a spawned prerequisite is not found, the way the Go cases did with t.Setenv. */
function withoutPath(): void {
  process.env.PATH = tmp()
}

describe('the exclusion set', () => {
  // A glob is not obliged to match at every depth: `*` never crosses a
  // separator, so this pattern describes the directory and not the file one
  // level below it. Anything that tests files alone considers that file
  // un-excluded (the asymmetry that made the update walk wrong).
  it('matches the directory but not the file beneath it', () => {
    const pattern = ['docs/*/[^A-Z]*']
    expect(excluded('docs/reference/axon-framework', pattern)).toBe(true)
    expect(excluded('docs/reference/axon-framework/20260708161438-ddd-notes.md', pattern)).toBe(false)
    expect(excluded('docs/design/design-00001-x.md', pattern)).toBe(true)
    expect(excluded('docs/design/README.md', pattern)).toBe(false)

    // A trailing-slash entry is matched by the prefix branch instead, which does
    // hold at every depth — this is why .github/ never leaked while the glob above did.
    for (const rel of ['.github', '.github/workflows', '.github/workflows/ci.yml']) {
      expect(excluded(rel, ['.github/']), rel).toBe(true)
    }
  })

  // spec-00013-FR-15 / spec-00013-FR-16: every value here was read off Go's
  // filepath.Match, and the whole function was cross-checked against a copy of
  // scaffold.go:223-238 over 22,650 pattern/path pairs while cli/ was still in
  // the tree (plan-00034, "实测义务").
  it.each([
    // `*` and `?` do not cross a separator...
    { pattern: '*', rel: 'a/b', want: false },
    { pattern: '?', rel: '/', want: false },
    { pattern: '*/*', rel: 'a/b', want: true },
    // ...but a character class is not separator-constrained.
    { pattern: '[^A-Z]', rel: '/', want: true },
    { pattern: '[/]', rel: '/', want: true },
    // `!` is a literal member of a class; the negation character is `^` alone.
    { pattern: '[!A-Z]', rel: 'A', want: true },
    { pattern: '[^A-Z]x', rel: 'ax', want: true },
    // A backslash escapes the character after it.
    { pattern: 'a\\*b', rel: 'a*b', want: true },
    { pattern: 'a\\*b', rel: 'axb', want: false },
    // Ranges, negation, and an inverted range that can never match.
    { pattern: '[a-c]x', rel: 'bx', want: true },
    { pattern: '[^a-c]x', rel: 'zx', want: true },
    { pattern: '[c-a]x', rel: 'bx', want: false },
    { pattern: '[^c-a]x', rel: 'bx', want: true },
    // A backslash escapes inside a class too.
    { pattern: '[\\]]y', rel: ']y', want: true },
    { pattern: '[a-b\\]]y', rel: ']y', want: true },
    // Malformed patterns are neither a match nor an error.
    { pattern: '[a-', rel: 'a', want: false },
    { pattern: '[]a]', rel: 'a', want: false },
    { pattern: '[a', rel: 'a', want: false },
    { pattern: '[\\', rel: 'a', want: false },
    { pattern: '*[', rel: 'ab', want: false },
    { pattern: 'x\\', rel: 'x', want: false },
    // ...except against a path whose literal name is the pattern: that is the
    // string half of the test, which a malformed glob does not disable.
    { pattern: '[a-', rel: '[a-', want: true },
  ])('matches $pattern against $rel as filepath.Match does', ({ pattern, rel, want }) => {
    expect(excluded(rel, [pattern])).toBe(want)
  })

  it('skips an empty pattern rather than excluding everything', () => {
    expect(excluded('README.md', ['/', '', 'nothing'])).toBe(false)
  })
})

describe('copyTree', () => {
  // Creation has the same hazard as update: reading a file follows the link.
  it('preserves symlinks', () => {
    const src = tmp()
    const dst = join(tmp(), 'proj')
    writeTree(src, { 'AGENTS.md': 'x\n' })
    writeLink(src, 'CLAUDE.md', 'AGENTS.md')

    copyTree(src, dst, [])

    expect(linkTarget(dst, 'CLAUDE.md')).toBe('AGENTS.md')
  })
})

describe('resolveRef', () => {
  it('names the branch each combination of flags asks for', () => {
    const base: Options = { name: 'demo', owner: STUB_OWNER, repo: STUB_REPO }
    expect(resolveRef({ ...base, ref: 'wip' })).toBe('wip')
    expect(resolveRef({ ...base, ref: 'wip', lang: 'go' })).toBe('wip')
    expect(resolveRef({ ...base, lang: 'java', variant: 'ddd' })).toBe('lang/java/ddd')
    expect(resolveRef({ ...base, lang: 'go' })).toBe('lang/go')
    expect(resolveRef(base)).toBe('main')
  })
})

describe('new', () => {
  // spec-00013-AC-2.1: an exclude pattern naming a directory keeps the whole tree out.
  it('skips an excluded directory', async () => {
    const { dir, error } = await runNew(
      {},
      { 'template.json': '{"exclude": [".github/"]}', '.github/workflows/ci.yml': 'on: push\n', 'README.md': 'hi\n' },
    )

    expect(error).toBeUndefined()
    expect(exists(dir, '.github'), '.github was copied, but the manifest excludes it').toBe(false)
    expect(exists(dir, 'README.md'), 'README.md is not excluded and was not copied').toBe(true)
  })

  // spec-00013-AC-2.2: .git and template.json are never copied, and need no exclude entry.
  it('never copies the git directory or the manifest', async () => {
    const { dir, error } = await runNew({}, { 'template.json': '{}', '.git/config': '[core]\n', 'README.md': 'hi\n' })

    expect(error).toBeUndefined()
    for (const rel of ['.git', 'template.json']) {
      expect(exists(dir, rel), `${rel} was copied; it must never reach a scaffolded project`).toBe(false)
    }
  })

  // spec-00013-AC-2.3: a placeholder in a substituted file becomes the project name.
  it('substitutes placeholders in the listed files', async () => {
    const { dir, error } = await runNew({}, { 'template.json': '{"substitute": ["README.md"]}', 'README.md': '# {{PROJECT_NAME}}\n' })

    expect(error).toBeUndefined()
    expect(readFile(dir, 'README.md')).toBe('# demo\n')
  })

  // spec-00013-AC-2.4: a variable's own default is placeholder-expanded, so a
  // default of {{name}} resolves to the project name.
  it('expands placeholders inside a variable default', async () => {
    const { dir, error } = await runNew(
      {},
      {
        'template.json': '{"vars": {"ARTIFACT_ID": {"default": "{{name}}"}}, "substitute": ["pom.xml"]}',
        'pom.xml': '<artifactId>{{ARTIFACT_ID}}</artifactId>\n',
      },
    )

    expect(error).toBeUndefined()
    expect(readFile(dir, 'pom.xml')).toBe('<artifactId>demo</artifactId>\n')
  })

  // spec-00013-AC-2.5: a post_create step gated on a language is skipped when no
  // language was asked for.
  it('skips a post_create step gated on another language', async () => {
    const { dir, error } = await runNew(
      {},
      { 'template.json': '{"post_create": [{"cmd": "touch went-go", "when_lang": "go"}]}', 'README.md': 'hi\n' },
    )

    expect(error).toBeUndefined()
    expect(exists(dir, 'went-go'), 'the step ran, but it is gated on --lang go and no language was given').toBe(false)
  })

  // spec-00013-AC-2.6: the same step runs, inside the new project, when the language matches.
  it('runs a post_create step gated on the chosen language', async () => {
    const { dir, error } = await runNew(
      { lang: 'go' },
      { 'template.json': '{"post_create": [{"cmd": "touch went-go", "when_lang": "go"}]}', 'README.md': 'hi\n' },
    )

    expect(error).toBeUndefined()
    expect(exists(dir, 'went-go'), 'the step is gated on --lang go, which was given, and did not run in the project').toBe(true)
  })

  // A variant gate is read the same way as a language gate.
  it('skips a post_create step gated on another variant', async () => {
    const { dir, error } = await runNew(
      { lang: 'java', variant: 'ddd' },
      {
        'template.json': '{"post_create": [{"cmd": "touch went-hex", "when_variant": "hex"}, {"cmd": "touch went-ddd", "when_variant": "ddd"}]}',
        'README.md': 'hi\n',
      },
    )

    expect(error).toBeUndefined()
    expect(exists(dir, 'went-hex')).toBe(false)
    expect(exists(dir, 'went-ddd')).toBe(true)
  })

  // spec-00013-AC-2.7: post_create steps run in declaration order — the second
  // here can only succeed after the first, and the third only after the second.
  it('runs post_create steps in declaration order', async () => {
    const { dir, error } = await runNew(
      {},
      {
        'template.json':
          '{"post_create": [{"cmd": "printf one > first"}, {"cmd": "cp first second"}, {"cmd": "cp second third"}]}',
        'README.md': 'hi\n',
      },
    )

    expect(error, 'a later step ran before the one it depends on').toBeUndefined()
    expect(readFile(dir, 'third')).toBe('one')
  })

  // spec-00013-AC-2.8: a substitute entry the branch does not actually have is skipped.
  it('ignores a substitute entry the branch does not have', async () => {
    const { dir, error } = await runNew(
      {},
      { 'template.json': '{"substitute": ["ABSENT.md", "README.md"]}', 'README.md': '# {{PROJECT_NAME}}\n' },
    )

    expect(error, 'a listed but absent file must not fail the scaffold').toBeUndefined()
    expect(readFile(dir, 'README.md')).toBe('# demo\n')
  })

  // spec-00013-AC-3.1: the creation marker records where the project came from,
  // down to the commit that becomes the merge base.
  it('records the template coordinate, ref and base commit', async () => {
    const { dir, error } = await runNew({ lang: 'go' }, { 'README.md': 'hi\n' })

    expect(error).toBeUndefined()
    const lock = readLock(dir)
    expect(lock.template).toBe(`${STUB_OWNER}/${STUB_REPO}`)
    expect(lock.ref).toBe('lang/go')
    expect(lock.lang).toBe('go')
    expect(lock.commit).toBe(HEAD_SHA)
  })

  // spec-00013-AC-3.2: the marker's variable table carries the resolved variables
  // but not name, which follows the project's own name rather than the template.
  it('records the resolved variables without name', async () => {
    const { dir, error } = await runNew({ sets: { MODULE_PATH: 'example.com/x' } }, { 'README.md': 'hi\n' })

    expect(error).toBeUndefined()
    expect(readLock(dir).vars).toEqual({ MODULE_PATH: 'example.com/x', PROJECT_NAME: 'demo' })
  })

  // The marker's bytes are part of the contract: a project scaffolded before the
  // port carries exactly this file, so its shape may not drift (spec-00013-FR-3).
  it('writes the creation marker as indented json with a trailing newline', async () => {
    const { dir } = await runNew({ variant: 'ddd', lang: 'java' }, { 'README.md': 'hi\n' })

    expect(readFile(dir, '.ainpt.json')).toBe(
      `{\n  "template": "acme/tpl",\n  "ref": "lang/java/ddd",\n  "lang": "java",\n  "variant": "ddd",\n  "commit": "${HEAD_SHA}",\n  "vars": {\n    "PROJECT_NAME": "demo"\n  }\n}\n`,
    )
  })

  // A --set wins over both the project name and a variable's declared default.
  it('takes PROJECT_NAME and a declared variable from --set', async () => {
    const { dir, error } = await runNew(
      { sets: { PROJECT_NAME: 'renamed', ARTIFACT_ID: 'chosen' } },
      { 'template.json': '{"vars": {"ARTIFACT_ID": {"default": "{{name}}"}}, "substitute": ["README.md"]}', 'README.md': '{{PROJECT_NAME}} {{ARTIFACT_ID}}\n' },
    )

    expect(error).toBeUndefined()
    expect(readFile(dir, 'README.md')).toBe('renamed chosen\n')
  })

  // A step declaring no command at all is the empty command, as it was in Go.
  it('runs a post_create step with no command as the empty command', async () => {
    const { dir, out, error } = await runNew({}, { 'template.json': '{"post_create": [{"when_lang": ""}]}', 'README.md': 'hi\n' })

    expect(error).toBeUndefined()
    expect(out).toContain('post-create: ')
    expect(exists(dir, 'README.md')).toBe(true)
  })

  // Without --dir the project is created under the working directory.
  it('creates the project under the working directory by default', async () => {
    const parent = tmp()
    await stubGitHub({ main: HEAD_SHA }, { main: { 'README.md': 'hi\n' } })
    capture()
    const cwd = process.cwd()
    process.chdir(parent)

    try {
      await create({ name: 'demo', owner: STUB_OWNER, repo: STUB_REPO })
    } finally {
      process.chdir(cwd)
    }

    expect(exists(parent, 'demo/README.md')).toBe(true)
  })

  // spec-00013-AC-5.1: an existing target is refused without touching what is inside it.
  it('refuses a target that already exists', async () => {
    const parent = tmp()
    writeTree(join(parent, 'demo'), { 'mine.txt': 'mine\n' })

    const { dir, error } = await runNew({ dir: parent }, { 'README.md': 'hi\n' })

    expect(error?.message).toContain('already exists')
    expect(readFile(dir, 'mine.txt')).toBe('mine\n')
    expect(exists(dir, 'README.md'), 'the template was copied into the existing directory').toBe(false)
  })

  // spec-00013-AC-5.2: a branch that does not exist is reported with the pointer
  // to the listing, and no project directory is left behind.
  it('reports a missing branch and points at the listing', async () => {
    const parent = tmp()
    await stubGitHub({ main: HEAD_SHA }, { main: { 'README.md': 'hi\n' } })
    const out = capture()

    await expect(create({ name: 'demo', dir: parent, lang: 'rust', owner: STUB_OWNER, repo: STUB_REPO })).rejects.toThrow(
      /persimmon list-langs/,
    )

    expect(out()).toContain('Fetching acme/tpl@lang/rust')
    expect(exists(parent, 'demo'), 'demo was created even though the branch could not be fetched').toBe(false)
  })

  // spec-00013-AC-5.3: a declared variable with neither a default nor a --set
  // fails with the flag to pass, and never prompts.
  it('reports a missing required variable', async () => {
    const { parent, error } = await runNew(
      {},
      { 'template.json': '{"vars": {"MODULE_PATH": {"prompt": "Go module path"}}}', 'README.md': 'hi\n' },
    )

    expect(error?.message).toContain('--set MODULE_PATH=VALUE')
    expect(exists(parent, 'demo'), 'demo was created before the variables were resolved').toBe(false)
  })

  // A variable gated on a language nobody asked for is not required at all.
  it('ignores a required variable gated on another language', async () => {
    const { dir, error } = await runNew(
      {},
      {
        'template.json': '{"vars": {"MODULE_PATH": {"prompt": "p", "when_lang": "go"}, "GROUP": {"prompt": "p", "when_variant": "ddd"}}}',
        'README.md': 'hi\n',
      },
    )

    expect(error).toBeUndefined()
    expect(readLock(dir).vars).toEqual({ PROJECT_NAME: 'demo' })
  })

  // spec-00013-AC-5.4: a failing post_create step is reported by the step that
  // failed, and the project is left without a creation marker.
  it('reports which post_create step failed and writes no marker', async () => {
    const { dir, error } = await runNew(
      {},
      { 'template.json': '{"post_create": [{"cmd": "touch kept"}, {"cmd": "exit 3"}]}', 'README.md': 'hi\n' },
    )

    expect(error?.message).toContain('post_create "exit 3"')
    expect(exists(dir, '.ainpt.json'), 'a creation marker was written even though the scaffold failed').toBe(false)
  })

  // spec-00013-AC-5.5: that failure does not roll back — what was copied stays
  // put for the user to delete.
  it('leaves what it already copied after a post_create failure', async () => {
    const { dir, error } = await runNew(
      {},
      { 'template.json': '{"post_create": [{"cmd": "touch kept"}, {"cmd": "exit 3"}]}', 'README.md': 'hi\n' },
    )

    expect(error).toBeDefined()
    for (const rel of ['README.md', 'kept']) {
      expect(exists(dir, rel), `${rel} is gone; the command must not roll back`).toBe(true)
    }
  })

  // spec-00013-AC-5.6: a branch that fetches but whose commit cannot be resolved
  // is not a failure — the project is created, with a warning and an empty merge base.
  it('warns and leaves the base empty when the commit cannot be resolved', async () => {
    const parent = tmp()
    await stubGitHub({}, { main: { 'README.md': 'hi\n' } })
    const out = capture()

    await create({ name: 'demo', dir: parent, owner: STUB_OWNER, repo: STUB_REPO })

    expect(out()).toContain('warning: could not record template commit')
    expect(readLock(join(parent, 'demo')).commit).toBe('')
  })

  // spec-00013-AC-15.1: `*` does not cross a separator.
  it('excludes README.md but not docs/a.md for the pattern *.md', async () => {
    const { dir, error } = await runNew({}, { 'template.json': '{"exclude": ["*.md"]}', 'README.md': 'hi\n', 'docs/a.md': 'hi\n' })

    expect(error).toBeUndefined()
    expect(exists(dir, 'README.md')).toBe(false)
    expect(exists(dir, 'docs/a.md')).toBe(true)
  })

  // spec-00013-AC-15.2: a character class is not separator-constrained, so
  // `[^A-Z]` matches `/`.
  it('excludes docs/draft.md for the pattern docs[^A-Z]draft.md', async () => {
    const { dir, error } = await runNew({}, { 'template.json': '{"exclude": ["docs[^A-Z]draft.md"]}', 'docs/draft.md': 'hi\n' })

    expect(error).toBeUndefined()
    expect(exists(dir, 'docs/draft.md')).toBe(false)
  })

  // spec-00013-AC-15.3: `!` is a literal member of a class, not a negation.
  it('excludes !y.md but not ay.md for the pattern [!x]y.md', async () => {
    const { dir, error } = await runNew({}, { 'template.json': '{"exclude": ["[!x]y.md"]}', '!y.md': 'hi\n', 'ay.md': 'hi\n' })

    expect(error).toBeUndefined()
    expect(exists(dir, '!y.md')).toBe(false)
    expect(exists(dir, 'ay.md')).toBe(true)
  })

  // spec-00013-AC-15.4: a pattern is anchored end to end, not a prefix test.
  it('keeps README.md for the pattern READM', async () => {
    const { dir, error } = await runNew({}, { 'template.json': '{"exclude": ["READM"]}', 'README.md': 'hi\n' })

    expect(error).toBeUndefined()
    expect(exists(dir, 'README.md')).toBe(true)
  })

  // spec-00013-AC-15.6: the trailing slash is trimmed and the literal-string half
  // carries the file beneath the directory — filepath.Match(".github",
  // ".github/workflows/ci.yml") is false, so a glob-only implementation would
  // drop the directory and let the file through, failing AC-2.1 silently.
  it('excludes a file beneath a directory named with a trailing slash', async () => {
    const { dir, error } = await runNew(
      {},
      { 'template.json': '{"exclude": [".github/"]}', '.github/workflows/ci.yml': 'on: push\n', 'README.md': 'hi\n' },
    )

    expect(error).toBeUndefined()
    expect(exists(dir, '.github/workflows/ci.yml')).toBe(false)
    expect(exists(dir, 'README.md')).toBe(true)
  })

  // spec-00013-AC-15.7: neither half of the test hits the path `docs/a.md` — the
  // literal half wants the whole segment or a `doc?/` prefix, and the glob half
  // is anchored with `?` not crossing a separator. Neither file lands all the
  // same: the walk tests directories too and `doc?` matches the directory `docs`
  // (filepath.Match("doc?", "docs") = true, cross-checked against Go), so the
  // subtree is pruned whole, while the file `dock` is hit by the glob half
  // directly.
  it('prunes the docs directory and excludes the file dock, for the pattern doc?', async () => {
    expect(excluded('docs/a.md', ['doc?'])).toBe(false)
    expect(excluded('docs', ['doc?'])).toBe(true)
    expect(excluded('dock', ['doc?'])).toBe(true)

    const { dir, error } = await runNew(
      {},
      { 'template.json': '{"exclude": ["doc?"]}', 'docs/a.md': 'hi\n', dock: 'hi\n', 'README.md': 'hi\n' },
    )

    expect(error).toBeUndefined()
    expect(exists(dir, 'docs')).toBe(false)
    expect(exists(dir, 'docs/a.md')).toBe(false)
    expect(exists(dir, 'dock')).toBe(false)
    expect(exists(dir, 'README.md')).toBe(true)
  })

  // spec-00013-AC-16.1: a malformed pattern matches nothing and reports nothing.
  it('builds the project anyway when an exclude pattern is malformed', async () => {
    const { dir, error, out } = await runNew({}, { 'template.json': '{"exclude": ["[a-"]}', 'README.md': 'hi\n' })

    expect(error).toBeUndefined()
    expect(exists(dir, 'README.md')).toBe(true)
    expect(out).toContain('Created')
  })

  // spec-00013-AC-17.1: tar is the command's own prerequisite for unpacking the
  // template, and without it nothing at all is laid down.
  it('reports a missing tar and creates nothing', async () => {
    const parent = tmp()
    await stubGitHub({ main: HEAD_SHA }, { main: { 'README.md': 'hi\n' } })
    capture()
    withoutPath()

    await expect(create({ name: 'demo', dir: parent, owner: STUB_OWNER, repo: STUB_REPO })).rejects.toThrow(/tar is not on PATH/)

    expect(exists(parent, 'demo')).toBe(false)
  })

  it('reports an archive tar cannot unpack', async () => {
    const parent = tmp()
    await stubGitHub({ main: HEAD_SHA }, {})
    // The branch download answers 404 for a tree the stub does not hold, so an
    // unpackable body needs a stub of its own.
    vi.mocked(globalThis.fetch).mockResolvedValue(new Response('not a tarball'))
    capture()

    await expect(create({ name: 'demo', dir: parent, owner: STUB_OWNER, repo: STUB_REPO })).rejects.toThrow(/tar failed to unpack/)
  })
})

describe('update', () => {
  // spec-00013-AC-9.9: when the branch is still at the base commit nothing is
  // fetched or changed.
  it('reports a project already up to date', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'mine\n' })
    await stubGitHub({ main: BASE_SHA }, {})

    const { out, error } = await runUpdate(dir)

    expect(error).toBeUndefined()
    expect(out).toContain('Already up to date')
    expect(readFile(dir, 'README.md')).toBe('mine\n')
  })

  // spec-00013-AC-11.1: a directory with no creation marker is refused, untouched.
  it('refuses a directory with no creation marker', async () => {
    const dir = tmp()
    writeTree(dir, { 'README.md': 'mine\n' })

    const { error } = await runUpdate(dir)

    expect(error?.message).toContain('no .ainpt.json')
    expect(readFile(dir, 'README.md')).toBe('mine\n')
  })

  // spec-00013-AC-11.2: a marker that is not valid JSON is refused, untouched.
  it('refuses a creation marker that is not valid json', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': '{oops', 'README.md': 'mine\n' })

    const { error } = await runUpdate(dir)

    expect(error?.message).toContain('parse .ainpt.json')
    expect(readFile(dir, 'README.md')).toBe('mine\n')
  })

  // spec-00013-AC-11.3: a marker with an empty merge base — what AC-5.6 produces
  // — has no common ancestor to merge against.
  it('refuses a creation marker with an empty base', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(''), 'README.md': 'mine\n' })

    const { error } = await runUpdate(dir)

    expect(error?.message).toContain('no base commit')
    expect(readFile(dir, 'README.md')).toBe('mine\n')
  })

  // issue-00034 / spec-00013-AC-11.4, spec-00013-AC-11.5, spec-00013-AC-11.6: the
  // creation marker's template coordinate must be exactly owner/repo. Counting
  // the segments a split returned lets an empty owner (`/repo`) and a third
  // segment (`owner/repo/extra`) through; the check is three conditions, and it
  // runs before any request goes out.
  it.each(['norepo', '/repo', 'owner/', 'owner/repo/extra'])('refuses the template coordinate %s', async (template) => {
    const dir = tmp()
    const written = `{"template":"${template}","ref":"main","commit":"abc123"}\n`
    writeTree(dir, { '.ainpt.json': written, 'README.md': 'mine\n' })
    const sent = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no request may go out before the coordinate is checked'))

    const { error } = await runUpdate(dir)

    expect(error?.message).toContain('owner/repo')
    expect(sent, 'the coordinate must be checked before any request goes out').not.toHaveBeenCalled()
    expect(readFile(dir, '.ainpt.json')).toBe(written)
    expect(readFile(dir, 'README.md')).toBe('mine\n')
  })

  it('refuses a creation marker with no template coordinate at all', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': '{"ref":"main","commit":"abc123"}\n' })

    const { error } = await runUpdate(dir)

    expect(error?.message).toContain('expected owner/repo')
  })

  it('reports a ref whose commit cannot be resolved', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'mine\n' })
    await stubGitHub({}, {})

    const { error } = await runUpdate(dir)

    expect(error?.message).toContain('resolve sha for main')
  })

  // spec-00013-AC-17.2: with the upstream commit ahead of the base, update
  // reaches the unpacking step — and without tar it fails there, with the project
  // and its base untouched.
  it('reports a missing tar and changes nothing', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'mine\n' })
    await stubGitHub({ main: HEAD_SHA }, { [BASE_SHA]: { 'README.md': 'base\n' }, main: { 'README.md': 'upstream\n' } })
    const out = capture()
    withoutPath()

    await expect(prepareUpdate(dir)).rejects.toThrow(/tar is not on PATH/)

    expect(out()).toContain('Updating acme/tpl@main: abc1230 -> def4560')
    expect(readFile(dir, 'README.md')).toBe('mine\n')
    expect(readLock(dir).commit).toBe(BASE_SHA)
  })

  // The two upstream trees the merge runs between, and the manifest that decides
  // what it may touch, are what the first half hands on (plan-00034 T2b).
  it('hands on both template trees and the upstream manifest', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'mine\n' })
    await stubGitHub(
      { main: HEAD_SHA },
      {
        [BASE_SHA]: { 'README.md': 'base\n' },
        main: { 'template.json': '{"exclude": ["docs/"]}', 'README.md': 'upstream\n' },
      },
    )
    capture()

    const ready = await prepareUpdate(dir)

    made.push(ready?.oldSrc as string, ready?.newSrc as string)
    expect(ready?.newSHA).toBe(HEAD_SHA)
    expect(ready?.lock.commit).toBe(BASE_SHA)
    expect(ready?.manifest.exclude).toEqual(['docs/', '.git', 'template.json'])
    expect(readFile(ready?.oldSrc as string, 'README.md')).toBe('base\n')
    expect(readFile(ready?.newSrc as string, 'README.md')).toBe('upstream\n')
  })

  // A base short enough to print whole is printed whole.
  it('prints a short base commit as it stands', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': `{"template":"acme/tpl","ref":"main","commit":"abc12"}\n` })
    await stubGitHub({ main: HEAD_SHA }, {})
    const out = capture()

    await runUpdate(dir)

    expect(out()).toContain('Updating acme/tpl@main: abc12 -> def4560')
  })

  it('reports an upstream branch it cannot download', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'mine\n' })
    // The base tree is served and the branch is not, so the failure lands on the
    // second download, after the first has already been unpacked.
    await stubGitHub({ main: HEAD_SHA }, { [BASE_SHA]: { 'README.md': 'base\n' } })
    capture()

    const { error } = await runUpdate(dir)

    expect(error?.message).toContain('404')
  })

  it('defaults to the working directory when no directory is named', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'mine\n' })
    await stubGitHub({ main: BASE_SHA }, {})
    const cwd = process.cwd()
    process.chdir(dir)
    const out = capture()

    try {
      await prepareUpdate()
      await prepareUpdate('')
    } finally {
      process.chdir(cwd)
    }

    expect(out()).toContain('Already up to date')
  })
})

describe('mergeTree', () => {
  // spec-00013-AC-10.3: an exclude pattern that names a directory keeps the whole
  // tree out of the merge, not just the files the glob itself matches. Creation
  // prunes an excluded directory, so update has to prune it the same way or it
  // reinstates exactly what creation dropped.
  it('prunes excluded directories', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    // Both are new upstream — absent from the base — so the deletion rule does
    // not apply and pruning is the only thing that can keep the notes out.
    writeTree(oldSrc, { 'AGENTS.md': 'x\n' })
    writeTree(newSrc, {
      'AGENTS.md': 'x\n',
      'docs/reference/README.md': 'kept\n',
      'docs/reference/axon-framework/20260708161438-ddd-notes.md': 'notes\n',
    })
    writeTree(dir, { 'AGENTS.md': 'x\n' })

    const result = mergeTree(dir, oldSrc, newSrc, ['docs/*/[^A-Z]*'])

    expect(exists(dir, 'docs/reference/axon-framework/20260708161438-ddd-notes.md'), 'the walk did not prune the excluded directory').toBe(false)
    expect(exists(dir, 'docs/reference/README.md'), 'nothing excludes docs/reference/README.md').toBe(true)
    expect(result.added).toBe(1)
  })

  // spec-00013-AC-10.1: a file the base has and the project does not was deleted
  // on purpose, so it is not rebuilt and the summary counts it as left empty.
  // Everything template.json's post_create deletes lands here; treating it as a
  // new upstream file resurrects it on every update, forever.
  it('leaves deliberate deletions deleted', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    const tree = { 'scaffold/pom.xml': '<project/>\n', 'scripts/new-app.sh': '#!/bin/sh\n' }
    writeTree(oldSrc, tree)
    writeTree(newSrc, tree)
    // dir is empty: post_create removed both at creation time.

    const result = mergeTree(dir, oldSrc, newSrc, [])

    for (const rel of Object.keys(tree)) expect(exists(dir, rel), `${rel} was resurrected`).toBe(false)
    expect(result.added).toBe(0)
    expect(result.kept).toBe(2)
  })

  // spec-00013-AC-9.7: an upstream file absent from the base and absent from the
  // project arrives verbatim and is counted as an addition — the other side of
  // the same rule.
  it('adds files new since the base', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    writeTree(oldSrc, { 'AGENTS.md': 'old\n' })
    writeTree(newSrc, { 'AGENTS.md': 'old\n', 'SECURITY.md': 'new\n' })
    writeTree(dir, { 'AGENTS.md': 'old\n' })

    const result = mergeTree(dir, oldSrc, newSrc, [])

    expect(readFile(dir, 'SECURITY.md')).toBe('new\n')
    expect(result.added).toBe(1)
    expect(result.kept).toBe(0)
  })

  // spec-00013-AC-9.7: a symlink must arrive as a symlink. Reading it would
  // follow it and write a second, independent copy of AGENTS.md under the name
  // CLAUDE.md, which then drifts on the next edit — the one outcome the link
  // exists to prevent.
  it('adds a symlink without copying its target', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    writeTree(oldSrc, { 'AGENTS.md': 'x\n' })
    writeTree(newSrc, { 'AGENTS.md': 'x\n' })
    writeLink(newSrc, 'nested/CLAUDE.md', 'AGENTS.md')
    writeTree(dir, { 'AGENTS.md': 'x\n' })

    const result = mergeTree(dir, oldSrc, newSrc, [])

    expect(linkTarget(dir, 'nested/CLAUDE.md')).toBe('AGENTS.md')
    expect(result.added).toBe(1)
  })

  // spec-00013-AC-10.1: the deletion rule holds for symlinks too — a link the
  // base has and the project has not is not put back.
  it('leaves a deleted symlink deleted', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    writeLink(oldSrc, 'CLAUDE.md', 'AGENTS.md')
    writeLink(newSrc, 'CLAUDE.md', 'AGENTS.md')

    const result = mergeTree(dir, oldSrc, newSrc, [])

    expect(exists(dir, 'CLAUDE.md'), 'the project had deleted the link').toBe(false)
    expect(result.kept).toBe(1)
    expect(result.added).toBe(0)
  })

  // spec-00013-AC-10.6: the template has not touched the link since the base and
  // the project retargeted it, so the project side stands and nothing is
  // reported as a conflict.
  //
  // This is also where writing through a link does real damage: `git merge-file`
  // follows the link before writing, so merging CLAUDE.md here would fold the
  // template's AGENTS.md delta into whatever the project pointed the link at —
  // HOUSE-RULES.md would come back holding the template's text and a set of
  // conflict markers it never asked for.
  it('keeps a retargeted link and spares what it points at', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    writeTree(oldSrc, { 'AGENTS.md': 'one\ntwo\n' })
    writeLink(oldSrc, 'CLAUDE.md', 'AGENTS.md')
    writeTree(newSrc, { 'AGENTS.md': 'one\ntwo\nthree\n' })
    writeLink(newSrc, 'CLAUDE.md', 'AGENTS.md')
    writeTree(dir, { 'AGENTS.md': 'one\ntwo\n', 'HOUSE-RULES.md': 'house rules\n' })
    writeLink(dir, 'CLAUDE.md', 'HOUSE-RULES.md')

    const result = mergeTree(dir, oldSrc, newSrc, [])

    expect(linkTarget(dir, 'CLAUDE.md')).toBe('HOUSE-RULES.md')
    expect(readFile(dir, 'HOUSE-RULES.md'), 'the merge wrote through the link').toBe('house rules\n')
    expect(result.conflicts, 'the template did not touch the link').toEqual([])
    expect(result.merged).toBe(2)
  })

  // spec-00013-FR-10 ("其余报为冲突"): when both sides moved the link there is
  // nothing to merge and nowhere to put markers, so the project's link stands and
  // the divergence is reported for a human to settle.
  it('reports a link both sides moved', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    writeLink(oldSrc, 'CLAUDE.md', 'AGENTS.md')
    writeLink(newSrc, 'CLAUDE.md', 'GUIDELINES.md')
    writeLink(dir, 'CLAUDE.md', 'HOUSE-RULES.md')

    const result = mergeTree(dir, oldSrc, newSrc, [])

    expect(linkTarget(dir, 'CLAUDE.md')).toBe('HOUSE-RULES.md')
    expect(result.conflicts).toEqual(['CLAUDE.md (symlink -> GUIDELINES.md upstream; left as the project had it)'])
  })

  // spec-00013-AC-10.4: upstream and the project point the link at the same
  // target, so the link passes untouched — and so does the file it points at,
  // which is what writing the merge result through the link would have clobbered.
  it('leaves an agreeing link and its target alone', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    for (const src of [oldSrc, newSrc]) {
      writeTree(src, { 'AGENTS.md': 'template\n' })
      writeLink(src, 'CLAUDE.md', 'AGENTS.md')
    }
    writeTree(dir, { 'AGENTS.md': 'mine\n' })
    writeLink(dir, 'CLAUDE.md', 'AGENTS.md')

    const result = mergeTree(dir, oldSrc, newSrc, [])

    expect(linkTarget(dir, 'CLAUDE.md')).toBe('AGENTS.md')
    expect(readFile(dir, 'AGENTS.md'), 'the merge overwrote the link target').toBe('mine\n')
    expect(result.conflicts, 'both sides agree on the target').toEqual([])
  })

  // spec-00013-AC-10.5: upstream moved the link since the base and the project
  // put a plain file of its own in its place. There is nowhere to put conflict
  // markers, so the project side stands as it is and the divergence is reported.
  it('reports a link the project replaced with a file', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    writeLink(oldSrc, 'CLAUDE.md', 'AGENTS.md')
    writeLink(newSrc, 'CLAUDE.md', 'GUIDELINES.md')
    writeTree(dir, { 'CLAUDE.md': 'house rules\n' })

    const result = mergeTree(dir, oldSrc, newSrc, [])

    expect(readFile(dir, 'CLAUDE.md')).toBe('house rules\n')
    expect(result.conflicts).toEqual(['CLAUDE.md (symlink -> GUIDELINES.md upstream; left as the project had it)'])
  })

  // spec-00013-AC-10.5: the same when the link is new since the base — there is
  // no base link to read, so the project's file is reported rather than replaced.
  it('reports a link new since the base that the project already occupies', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    writeTree(oldSrc, { 'AGENTS.md': 'x\n' })
    writeTree(newSrc, { 'AGENTS.md': 'x\n' })
    writeLink(newSrc, 'CLAUDE.md', 'AGENTS.md')
    writeTree(dir, { 'AGENTS.md': 'x\n', 'CLAUDE.md': 'house rules\n' })

    const result = mergeTree(dir, oldSrc, newSrc, [])

    expect(readFile(dir, 'CLAUDE.md')).toBe('house rules\n')
    expect(result.conflicts).toEqual(['CLAUDE.md (symlink -> AGENTS.md upstream; left as the project had it)'])
  })

  // spec-00013-AC-9.1: a local edit and a non-overlapping upstream edit to the
  // same file both end up in it — the reason update is a merge and not a copy.
  it('keeps local edits while folding in upstream', () => {
    const [dir, oldSrc, newSrc] = [tmp(), tmp(), tmp()]
    writeTree(oldSrc, { 'README.md': 'title\nbody\nfooter\n' })
    writeTree(newSrc, { 'README.md': 'title\nbody\nfooter upstream\n' })
    writeTree(dir, { 'README.md': 'title mine\nbody\nfooter\n' })

    const result = mergeTree(dir, oldSrc, newSrc, [])

    expect(result.merged).toBe(1)
    expect(result.conflicts).toEqual([])
    expect(readFile(dir, 'README.md')).toContain('title mine')
    expect(readFile(dir, 'README.md')).toContain('footer upstream')
  })
})

describe('the three-way merge', () => {
  // spec-00013-AC-3.3: the marker's name and format are unchanged, so a project
  // scaffolded before the move into this repository updates with no migration.
  it('handles a project scaffolded before the move', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'mine\nbody\n' })
    await stubUpdateRepo({ 'README.md': 'title\nbody\n' }, { 'README.md': 'title\nbody upstream\n' })

    const { out, error } = await runUpdate(dir)

    expect(error).toBeUndefined()
    expect(out).toContain('Merged 1 file(s)')
  })

  // spec-00013-AC-9.2: an overlapping edit leaves conflict markers, and the
  // command lists the file with what to do about it.
  it('leaves conflict markers and lists the file', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nmine\nc\n' })
    await stubUpdateRepo({ 'README.md': 'a\nb\nc\n' }, { 'README.md': 'a\nupstream\nc\n' })

    const { out } = await runUpdate(dir)

    const merged = readFile(dir, 'README.md')
    // The base label is only printed in --diff3 mode, which the port does not
    // ask for any more than Go did; the other two are what a reader sees.
    expect(merged).toContain('<<<<<<< yours')
    expect(merged).toContain('>>>>>>> template (new)')
    expect(out).toContain('1 file(s) have conflicts to resolve:')
    expect(out).toContain('  README.md')
    expect(out).toContain('Resolve each, then commit. Text files carry <<<<<<< markers.')
  })

  // spec-00013-AC-9.3: a conflict is not a failure — the markers are in the
  // working tree and the command returns normally.
  it('succeeds even when it leaves a conflict', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nmine\nc\n' })
    await stubUpdateRepo({ 'README.md': 'a\nb\nc\n' }, { 'README.md': 'a\nupstream\nc\n' })

    const { error } = await runUpdate(dir)

    expect(error, 'a conflict left in the tree is not a failure').toBeUndefined()
  })

  // spec-00013-AC-9.4: the merge base advances even when the merge left a
  // conflict, so the next update continues from this upstream commit.
  it('advances the base after a conflict', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nmine\nc\n' })
    await stubUpdateRepo({ 'README.md': 'a\nb\nc\n' }, { 'README.md': 'a\nupstream\nc\n' })

    await runUpdate(dir)

    expect(readLock(dir).commit).toBe(HEAD_SHA)
  })

  // spec-00013-AC-9.5: and it advances after a clean merge.
  it('advances the base after a clean merge', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'mine\nb\nc\n' })
    await stubUpdateRepo({ 'README.md': 'a\nb\nc\n' }, { 'README.md': 'a\nb\nupstream\n' })

    const { out } = await runUpdate(dir)

    expect(out).toContain('No conflicts. Review the diff and commit.')
    expect(readLock(dir).commit).toBe(HEAD_SHA)
  })

  // spec-00013-AC-9.6: a file the template never had is the project's own and is
  // not touched.
  it("leaves the project's own files alone", async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nb\nc\n', 'NOTES.md': 'mine only\n' })
    await stubUpdateRepo({ 'README.md': 'a\nb\nc\n' }, { 'README.md': 'a\nb\nupstream\n' })

    await runUpdate(dir)

    expect(readFile(dir, 'NOTES.md')).toBe('mine only\n')
  })

  // spec-00013-AC-9.8: an upstream file that is new since the base but already
  // exists in the project is merged against an empty ancestor rather than
  // overwritten.
  it('merges an upstream addition that the project already has', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'SECURITY.md': 'mine\n' })
    await stubUpdateRepo({}, { 'SECURITY.md': 'upstream\n' })

    const { out } = await runUpdate(dir)

    expect(out).toContain('Merged 1 file(s), added 0 new file(s).')
    const merged = readFile(dir, 'SECURITY.md')
    expect(merged).toContain('mine')
    expect(merged).toContain('<<<<<<<')
  })

  // spec-00013-AC-10.1: the summary names the files the project had deleted.
  it('reports the files it left deleted', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nb\nc\n' })
    await stubUpdateRepo(
      { 'README.md': 'a\nb\nc\n', 'scripts/new-app.sh': '#!/bin/sh\n' },
      { 'README.md': 'a\nb\nupstream\n', 'scripts/new-app.sh': '#!/bin/sh\n' },
    )

    const { out } = await runUpdate(dir)

    expect(out).toContain('Left 1 file(s) alone that this project had deleted.')
    expect(exists(dir, 'scripts/new-app.sh')).toBe(false)
  })

  // spec-00013-AC-9.10: --dir names the project to merge, from anywhere.
  it('merges the directory it was pointed at', async () => {
    const elsewhere = tmp()
    writeTree(elsewhere, { 'README.md': 'not the project\n' })
    const proj = join(tmp(), 'proj')
    writeTree(proj, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nb\nc\n' })
    await stubUpdateRepo({ 'README.md': 'a\nb\nc\n' }, { 'README.md': 'a\nb\nupstream\n' })
    const cwd = process.cwd()
    process.chdir(elsewhere)

    try {
      await runUpdate(proj)
    } finally {
      process.chdir(cwd)
    }

    expect(readFile(proj, 'README.md')).toContain('upstream')
    expect(readFile(elsewhere, 'README.md'), 'the working directory was merged instead').toBe('not the project\n')
  })

  // spec-00013-AC-10.2: the exclusion set comes from this upstream branch's
  // manifest, so a pattern the template added after creation takes effect
  // immediately.
  it('honours an exclude pattern the template added after creation', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nb\nc\n', 'docs/vendor/x.md': 'mine\n' })
    await stubUpdateRepo(
      { 'template.json': '{}', 'README.md': 'a\nb\nc\n', 'docs/vendor/x.md': 'base\n' },
      {
        'template.json': '{"exclude": ["docs/vendor/"]}',
        'README.md': 'a\nb\nupstream\n',
        'docs/vendor/x.md': 'upstream\n',
      },
    )

    const { out } = await runUpdate(dir)

    expect(readFile(dir, 'docs/vendor/x.md'), 'it was left out of the merge').toBe('mine\n')
    expect(out).toContain('Merged 1 file(s)')
  })

  // spec-00013-AC-15.5: the negated character class that kept a batch of files
  // out at creation keeps them out here too — `excluded` is the one judgement
  // both sides share, so nothing creation dropped is pushed back in.
  it('honours a negated character class on the update side too', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nb\nc\n' })
    await stubUpdateRepo(
      { 'template.json': '{"exclude": ["docs/*/[^A-Z]*"]}', 'README.md': 'a\nb\nc\n' },
      {
        'template.json': '{"exclude": ["docs/*/[^A-Z]*"]}',
        'README.md': 'a\nb\nupstream\n',
        'docs/reference/README.md': 'kept\n',
        'docs/reference/axon-framework/notes.md': 'notes\n',
      },
    )

    const { out } = await runUpdate(dir)

    expect(exists(dir, 'docs/reference/axon-framework/notes.md'), 'the excluded tree came back on update').toBe(false)
    expect(readFile(dir, 'docs/reference/README.md')).toBe('kept\n')
    expect(out).toContain('Merged 1 file(s), added 1 new file(s).')
  })

  // spec-00013-AC-16.2: a malformed pattern is not a match and not an error on
  // the update side either — the merge finishes as if it were not there.
  it('treats a malformed exclude pattern as no match', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nb\nc\n' })
    await stubUpdateRepo(
      { 'template.json': '{}', 'README.md': 'a\nb\nc\n' },
      { 'template.json': '{"exclude": ["*["]}', 'README.md': 'a\nb\nupstream\n' },
    )

    const { out, error } = await runUpdate(dir)

    expect(error).toBeUndefined()
    expect(out).toContain('Merged 1 file(s)')
    expect(readFile(dir, 'README.md')).toContain('upstream')
  })

  // spec-00013-AC-12.1: git does the three-way merge, so without git on PATH the
  // command fails on the first file that needs merging — AAA.md here, which the
  // walk reaches first.
  it('fails on the first merge when git is missing', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'AAA.md': 'a\nb\nc\n', 'ZZZ.md': 'a\nb\nc\n' })
    await stubUpdateRepo(
      { 'AAA.md': 'a\nb\nc\n', 'ZZZ.md': 'a\nb\nc\n' },
      { 'AAA.md': 'a\nb\nup\n', 'ZZZ.md': 'a\nb\nup\n' },
    )
    withoutGit()

    const { error } = await runUpdate(dir)

    expect(error?.message).toContain('merge AAA.md')
    expect(readFile(dir, 'ZZZ.md'), 'the walk went on past the failure').toBe('a\nb\nc\n')
  })

  // spec-00013-AC-12.2: and the base does not advance, so a rerun starts from the
  // same place.
  it('leaves the base where it was when git is missing', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nb\nc\n' })
    await stubUpdateRepo({ 'README.md': 'a\nb\nc\n' }, { 'README.md': 'a\nb\nupstream\n' })
    withoutGit()

    const { error } = await runUpdate(dir)

    expect(error, 'the missing-git failure').toBeDefined()
    expect(readLock(dir).commit).toBe(BASE_SHA)
  })

  // spec-00013-AC-12.3: what landed before the failing merge stays — there is no
  // pre-flight check for git, because an update that only adds files needs none,
  // and there is no rollback of the half-updated tree.
  it('leaves the half-updated tree behind when git is missing', async () => {
    const dir = tmp()
    writeTree(dir, { '.ainpt.json': marker(BASE_SHA), 'README.md': 'a\nb\nc\n' })
    await stubUpdateRepo(
      { 'README.md': 'a\nb\nc\n' },
      { 'AAA-new.md': 'brand new\n', 'README.md': 'a\nb\nupstream\n' },
    )
    withoutGit()

    const { error } = await runUpdate(dir)

    expect(error?.message).toContain('merge README.md')
    expect(readFile(dir, 'AAA-new.md'), 'the command must not roll back').toBe('brand new\n')
  })
})
