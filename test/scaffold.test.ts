import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type Lock, type Options, copyTree, create, excluded, prepareUpdate, resolveRef } from '../src/scaffold.ts'

/**
 * The equivalent translation of `cli/internal/scaffold/scaffold_test.go` for the
 * `new` side and the first half of `update` (plan-00034 T2a), plus the cases the
 * three new requirements and the 90/90/90 bar ask for. The three-way merge and
 * its cases land in T2b.
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

/** Runs `prepareUpdate` with its output captured, the way the command layer will call it. */
async function runUpdate(dir: string): Promise<{ out: string; error?: Error }> {
  const out = capture()
  let error: Error | undefined
  await prepareUpdate(dir).catch((thrown: Error) => {
    error = thrown
  })
  return { out: out(), error }
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
