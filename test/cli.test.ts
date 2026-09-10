import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { type RequestListener, createServer } from 'node:http'
import { type Server, type Socket, createServer as createSocketServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run } from '../src/cli.ts'
import { CONFIG_FILE, findRepoRoot } from '../src/config.ts'
import { Host } from '../src/host.ts'
import { AvailabilityJudge } from '../src/workspaceAvailability.ts'
import type { WorkspaceEntry } from '../src/workspaceRegistry.ts'
import { MINIMAL_CONFIG, boundPort, freePort, makeRepo } from './helpers.ts'

/**
 * The `persimmon` command (design-00004 §2): the startup handshake of
 * design-00003 §8, the service it now runs in this very process, and the three
 * registry subcommands. The Go original of these cases is
 * `cli/internal/hostproc/hostproc_test.go` and the `add` / `remove` / `list`
 * half of `cli/main_test.go`; they are translated here rather than re-invented,
 * so the port back to one artefact cannot quietly change what was asserted
 * (plan-00034 T1).
 *
 * Every case calls `run(argv)` in this process — that is what the signature is
 * for (spec-00012-FR-3) — with `HOME` and `PORT` stubbed and the cwd moved,
 * because the registry path is derived from the home directory and takes no
 * environment variable of its own (design-00003 §2). What `bin/persimmon.js`
 * does with the returned code is `test/startup.test.ts`'s and
 * `test/host.test.ts`'s, spawned for real.
 */

// Booting a whole board in-process runs well past vitest's default five seconds
// when the suite runs its files side by side.
vi.setConfig({ testTimeout: 30_000 })

/** A config that loads as YAML and fails validation: `memo` is not a declared type (spec-00001-FR-15). */
const INVALID_CONFIG = `types:
  idea: { kind: living }
relations: [parent]
flow:
  idea:
    - { next: memo, carry: parent }
focus:
  idea: is it worth doing, and for whom
agents:
  claude: { command: claude }
`

/** This repository, which spec-00011-FR-20 calls the first workspace. */
const REPO_ROOT = realpathSync(findRepoRoot(process.cwd()))

const made: string[] = []
const hosts: Host[] = []
const listeners: Array<() => Promise<void>> = []
const booted: Array<Promise<number>> = []
const chmodded: string[] = []
const enteredFrom = process.cwd()

afterEach(async () => {
  // Every boot holds the process open until it is signalled; that is the exit
  // path under test, and it is also the only way to give the board back.
  if (booted.length > 0) {
    process.emit('SIGINT')
    await Promise.all(booted.splice(0))
  }
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.chdir(enteredFrom)
  for (const host of hosts.splice(0)) await host.shutdown()
  for (const close of listeners.splice(0)) await close()
  for (const dir of chmodded.splice(0)) chmodSync(dir, 0o700)
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Fixtures. `hostproc_test.go`'s `setup`, `projectDir`, `newStub`, `created`
// and `noRegistry`, and `main_test.go`'s `newHarness`, `newFakeHost`,
// `strangerOn`, `portOf`, `projectAt`, `printed`, `gitRepo` and `mustGetwd`.
// `freePort` / `boundPort` / `makeRepo` are `test/helpers.ts`'s already.

/** A home directory of this test's own, which is where the registry lands (`setup`, `newHarness`). */
function makeHome(): string {
  // `realpath` because macOS puts the temporary directory behind a symlink and
  // the registry stores the resolved path (design-00003 §2).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wb-home-')))
  made.push(dir)
  return dir
}

/**
 * A directory a registration accepts and the judgement can call `available`:
 * a git repository of its own with a flow config in it (`projectAt`, `gitRepo`).
 * The config's content is not read on the start path — an invalid one registers
 * and opens all the same (spec-00011-AC-13.5, spec-00011-AC-13.7).
 */
function makeProject(config = MINIMAL_CONFIG): string {
  const { repoRoot } = makeRepo({})
  made.push(repoRoot)
  const path = realpathSync(repoRoot)
  writeFileSync(join(path, CONFIG_FILE), config)
  return path
}

/** A directory with no flow config at it or above it: the command starts there with no workspace (`projectDir`'s opposite). */
function makeElsewhere(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wb-elsewhere-')))
  made.push(dir)
  return dir
}

const registryPathOf = (home: string): string => join(home, '.persimmon', 'workspaces.json')

/** The registry as it stands on disk, or null when the command wrote none (`noRegistry`). */
function registryOf(home: string): { workspaces: WorkspaceEntry[] } | null {
  try {
    return JSON.parse(readFileSync(registryPathOf(home), 'utf8'))
  } catch {
    return null
  }
}

function writeRegistry(home: string, workspaces: WorkspaceEntry[] | string): void {
  mkdirSync(join(home, '.persimmon'), { recursive: true })
  const text = typeof workspaces === 'string' ? workspaces : JSON.stringify({ version: 1, workspaces })
  writeFileSync(registryPathOf(home), text)
}

/** Where the command reads the world from: `HOME` for the registry and `PORT` for the handshake. */
function world({ home, port, cwd }: { home: string; port: number; cwd: string }): void {
  vi.stubEnv('HOME', home)
  vi.stubEnv('PORT', String(port))
  process.chdir(cwd)
}

/** What one run of the command settled on and printed. */
interface Run {
  code: number
  stdout: string
  stderr: string
}

/**
 * One run of the command with its streams captured (`printed`, and its stderr
 * twin). `console.log` / `console.error` rather than `process.stdout.write`
 * throughout, which is what makes this fixture able to see anything at all.
 */
async function runCli(...argv: string[]): Promise<Run> {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => void out.push(parts.join(' ')))
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => void err.push(parts.join(' ')))
  const code = await run(argv)
  return { code, stdout: out.join('\n'), stderr: err.join('\n') }
}

/**
 * The form that keeps serving: the promise is the command's exit code, settled
 * only by the shutdown or by the listen that failed. Its first printed line is
 * the address (spec-00012-AC-3.1).
 */
function boot(): { exit: Promise<number>; printed: string[] } {
  const printed: string[] = []
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => void printed.push(parts.join(' ')))
  const exit = run([])
  booted.push(exit)
  return { exit, printed }
}

/**
 * A server of this test's own, given back when the case is over. Its open
 * sockets are destroyed by hand: a holder that never answered still has the
 * connection the probe made, and `close()` alone waits for it.
 */
function held<T extends Server>(server: T): T {
  const open: Socket[] = []
  server.on('connection', (socket: Socket) => void open.push(socket))
  listeners.push(
    () =>
      new Promise((resolve) => {
        for (const socket of open) socket.destroy()
        server.close(() => resolve())
      }),
  )
  return server
}

/** The address line, once the board is listening. */
async function addressOf(printed: string[]): Promise<string> {
  await vi.waitFor(() => expect(printed.length).toBeGreaterThan(0), { timeout: 20_000, interval: 25 })
  return printed[0] as string
}

/** A persimmon already running on a port of its own, sharing this home's registry (`newFakeHost`, but the real thing). */
async function runningHost(home: string): Promise<number> {
  mkdirSync(join(home, '.persimmon'), { recursive: true })
  const host = new Host({ registryPath: registryPathOf(home), version: '9.9.9' })
  hosts.push(host)
  // Bound to the address the command dials, so the port is this host's own (issue-00028).
  return await boundPort(host.listen(0, '127.0.0.1'))
}

/**
 * A stub of the process already on the port (`newStub` + `newFakeHost`): it
 * answers `/api/instance` as a persimmon and lets a case dictate what the
 * workspace routes reply, which is how a refusal (422) and a write that failed
 * (500) are put in front of the command (design-00003 §5).
 */
async function stubHost(
  routes: {
    app?: string
    version?: string
    post?: (body: string) => { status: number; body: unknown }
    get?: () => { status: number; body: unknown }
    remove?: (id: string) => { status: number; body: unknown }
  } = {},
): Promise<{ port: number; posted: string[]; deleted: string[] }> {
  const posted: string[] = []
  const deleted: string[] = []
  const handler: RequestListener = (request, response) => {
    const url = request.url ?? '/'
    const answer = (status: number, body: unknown): void => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }
    if (url === '/api/instance') {
      answer(200, { app: routes.app ?? 'persimmon', version: routes.version ?? '9.9.9', pid: 1 })
      return
    }
    if (url === '/api/workspaces' && request.method === 'GET') {
      const { status, body } = routes.get?.() ?? { status: 200, body: { workspaces: [] } }
      answer(status, body)
      return
    }
    if (url === '/api/workspaces') {
      let body = ''
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        posted.push(body)
        const { path } = JSON.parse(body || '{}')
        const created = { status: 201, body: { workspace: { id: 'demo', name: 'demo', path } } }
        const { status, body: reply } = routes.post?.(body) ?? created
        answer(status, reply)
      })
      return
    }
    const id = url.slice('/api/workspaces/'.length)
    deleted.push(id)
    const dropped = { status: 200, body: { workspace: { id, name: id, path: `/work/${id}` } } }
    const { status, body } = routes.remove?.(id) ?? dropped
    answer(status, body)
  }
  const server = held(createServer(handler))
  return { port: await boundPort(server.listen(0, '127.0.0.1')), posted, deleted }
}

/** Somebody who is not a persimmon holding the port: it answers, so the probe reads it as occupied (`strangerOn`). */
async function strangerOn(answer: RequestListener = (_request, response) => response.end('not persimmon')): Promise<number> {
  const server = held(createServer(answer))
  return await boundPort(server.listen(0, '127.0.0.1'))
}

/** A TCP service that accepts and never answers: the probe times out, which is «taken» too (`hostproc_test.go`'s silent holder). */
async function silentHolderOn(): Promise<number> {
  const server = held(createSocketServer())
  return await boundPort(server.listen(0, '127.0.0.1'))
}

/** A port a plain socket holds, so a `listen` on it raises EADDRINUSE. */
async function heldPort(): Promise<number> {
  const server = held(createSocketServer())
  return await boundPort(server.listen(0, '127.0.0.1'))
}

/** The probe answering «nobody is there» however the port really stands: the race spec-00011-AC-15.5 is about. */
function probeReadsItFree(): void {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(refused)
}

/** The commit the stubbed template repository answers every lookup with (`stubTemplateRepo`). */
const STUB_SHA = 'abc1230000000000000000000000000000000000'

/** A tarball in the shape codeload serves a branch: every entry under one wrapper directory, which `--strip-components=1` strips. */
function tarball(tree: Record<string, string>): Buffer {
  const staging = makeElsewhere()
  for (const [rel, body] of Object.entries(tree)) {
    const path = join(staging, 'root', rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
  }
  const done = spawnSync('tar', ['-czf', '-', '-C', staging, 'root'], { maxBuffer: 64 * 1024 * 1024 })
  expect(done.status, String(done.stderr)).toBe(0)
  return done.stdout
}

/**
 * The template repository the scaffold fetches (`stubTemplateRepo`): one tarball
 * per branch and a fixed commit for every lookup, with every outgoing request
 * pointed at it. The loopback calls of the handshake go where they were
 * addressed, so a case can scaffold and register in the same run. What was asked
 * for is given back, which is how the template coordinate is observed.
 */
async function stubTemplateRepo(trees: Record<string, Record<string, string>>): Promise<string[]> {
  const asked: string[] = []
  // Every tree carries a flow config because the real template does.
  const archives = new Map(Object.entries(trees).map(([ref, tree]) => [ref, tarball({ [CONFIG_FILE]: MINIMAL_CONFIG, ...tree })]))
  const server = held(
    createServer((request, response) => {
      const path = (request.url ?? '').replace(/^\//, '')
      asked.push(path)
      if (path.startsWith('repos/')) return void response.end(`${STUB_SHA}\n`)
      const archive = archives.get(path.replace(/^.*\/tar\.gz\/(?:refs\/heads\/)?/, ''))
      if (archive === undefined) return void response.writeHead(404).end('not found')
      response.end(archive)
    }),
  )
  const port = await boundPort(server.listen(0, '127.0.0.1'))
  const real = globalThis.fetch
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = new URL(String(input))
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return real(input, init)
    url.protocol = 'http:'
    url.host = `127.0.0.1:${port}`
    return real(url, init)
  })
  return asked
}

/** The marker each stub branch carries, so «the content came from <branch>» is a single assertion (`sourced`). */
const sourced = (branch: string): Record<string, string> => ({ 'SOURCE.md': `${branch}\n` })

/** The branch the project at `<parent>/<name>` was scaffolded from (`source`). */
const source = (parent: string, name: string): string => readFileSync(join(parent, name, 'SOURCE.md'), 'utf8').trim()

/** `new` run from `dir` with a world of this case's own (`newInWith`): a home nobody else shares and the default port. */
async function newInWith(env: Record<string, string>, dir: string, ...args: string[]): Promise<Run> {
  vi.stubEnv('HOME', makeHome())
  vi.stubEnv('PORT', '')
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  process.chdir(dir)
  return await runCli('new', ...args)
}

/** `new` run from `dir`, for the cases that only care what was scaffolded (`newIn`). */
const newIn = async (dir: string, ...args: string[]): Promise<Run> => await newInWith({}, dir, ...args)

/** A project `update` will take: the creation marker, and one file to leave alone. */
function markedProject(commit = STUB_SHA): string {
  const dir = makeElsewhere()
  writeFileSync(join(dir, '.ainpt.json'), `${JSON.stringify({ template: 'acme/tpl', ref: 'main', commit }, null, 2)}\n`)
  writeFileSync(join(dir, 'README.md'), 'mine\n')
  return dir
}

/** The availability column of `list`'s output, which is its last cell on each row. */
function availabilities(stdout: string): string[] {
  return stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.trim().split(/\s+/).at(-1) as string)
}

// ---------------------------------------------------------------------------

describe('the probe: who holds the port', () => {
  // spec-00011-AC-15.1 (TestProbeReadsWhoHoldsThePort, TestRefusesAPortItCannotHave):
  // a 200 from somebody else is «taken», not «one of ours»
  it('reports the port as occupied when the service on it is not a persimmon', async () => {
    const home = makeHome()
    const port = await strangerOn()
    world({ home, port, cwd: makeProject() })

    const result = await runCli()

    expect(result.code).toBe(1)
    expect(result.stderr).toBe(`persimmon: port ${port} is already in use`)
    expect(result.stdout).toBe('')
    expect(registryOf(home)).toBeNull()
  })

  // spec-00011-AC-15.2 (TestProbeReadsASilentHolderAsOccupied): the holder never
  // answers, and a timeout is «taken» — reading it as anything else is what
  // would start a second process on a held port
  it('reports the port as occupied, in bounded time, when nothing on it answers', async () => {
    const home = makeHome()
    const port = await silentHolderOn()
    world({ home, port, cwd: makeProject() })
    const started = Date.now()

    const result = await runCli()

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`port ${port} is already in use`)
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(registryOf(home)).toBeNull()
  })

  // spec-00011-AC-15.1, the two remaining rows of TestProbeReadsWhoHoldsThePort:
  // a non-200 and an answer that is not JSON are «taken» just the same
  it.each([
    ['a non-200', ((_request, response) => response.writeHead(500).end('no')) as RequestListener],
    ['an answer that is not JSON', ((_request, response) => response.end('<html>')) as RequestListener],
  ])('reports the port as occupied on %s', async (_name, answer) => {
    const port = await strangerOn(answer)
    world({ home: makeHome(), port, cwd: makeProject() })

    const result = await runCli()

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`port ${port} is already in use`)
  })
})

describe('persimmon, with a process already on the port', () => {
  // spec-00011-AC-14.1 and spec-00011-AC-14.2 (TestJoinsTheProcessOnThePort):
  // no second service, the address is the command's to print because the port is
  // known, and the registration goes through the running process — so its
  // switcher shows the entry at once and this side never writes the file.
  // spec-00012-AC-3.4 with it: nothing here enters a listening state.
  it('registers through the process already running and starts no second one', async () => {
    const home = makeHome()
    const port = await runningHost(home)
    const path = makeProject()
    world({ home, port, cwd: path })

    const result = await runCli()

    expect(result.code).toBe(0)
    const listed = await (await fetch(`http://127.0.0.1:${port}/api/workspaces`)).json()
    expect(listed.workspaces.map((row: WorkspaceEntry) => row.path)).toEqual([path])
    expect(result.stdout).toBe(
      `persimmon: http://localhost:${port}/w/${listed.workspaces[0].id} — persimmon 9.9.9 is already running`,
    )
  })

  // spec-00011-AC-14.3 (TestJoinsOutsideEveryProject), and spec-00011-AC-13.2 /
  // spec-00011-AC-13.3's command half with it: a cwd in no project registers
  // nothing at all and the address is the entry point — which of the registered
  // workspaces the page then opens there is web/test/workspaceSwitcher.test.tsx's
  it('prints the running process entry point when the cwd is in no project', async () => {
    const home = makeHome()
    const port = await runningHost(home)
    world({ home, port, cwd: makeElsewhere() })

    const result = await runCli()

    expect(result.code).toBe(0)
    expect(result.stdout).toBe(`persimmon: http://localhost:${port}/ — persimmon 9.9.9 is already running`)
    expect(registryOf(home)?.workspaces ?? []).toEqual([])
  })

  // spec-00012-AC-4.4 (TestTheJoinPathIsTakenDownByTheSignal): on the join path
  // there is no service of this process's own, so the command installs no
  // handler at all and the signal's default disposition is what takes it down;
  // the process it was joining is untouched
  it('installs no shutdown handler of its own on the join path', async () => {
    const home = makeHome()
    const port = await runningHost(home)
    world({ home, port, cwd: makeProject() })

    const result = await runCli()

    expect(result.code).toBe(0)
    expect(process.listenerCount('SIGINT')).toBe(0)
    expect(process.listenerCount('SIGTERM')).toBe(0)
    const instance = await (await fetch(`http://127.0.0.1:${port}/api/instance`)).json()
    expect(instance.app).toBe('persimmon')
  })

  // spec-00011-AC-15.3 (TestReportsARegistrationTheProcessRefused): the
  // registration went to the running process and came back refused (422) or
  // failed (500); the reason is the process's sentence to say, and the command
  // reports it and starts nothing
  it.each([
    ['a refusal', 422, { error: `the directory holds no ${CONFIG_FILE}: /work/demo` }, `persimmon: the directory holds no ${CONFIG_FILE}: /work/demo`],
    ['a write that failed', 500, { error: 'workspace registry: could not be written' }, 'persimmon: workspace registry: could not be written'],
    ['a refusal with nothing to say', 500, {}, 'persimmon: POST /api/workspaces answered 500'],
  ])('reports %s the running process gave, and listens not', async (_name, status, body, want) => {
    const home = makeHome()
    const { port } = await stubHost({ post: () => ({ status, body }) })
    world({ home, port, cwd: makeProject() })

    const result = await runCli()

    expect(result.code).toBe(1)
    expect(result.stderr).toBe(want)
    expect(result.stdout).toBe('')
    expect(registryOf(home)).toBeNull()
  })

  // TestPostReportsAConnectionItCannotMake — no AC of its own: the probe said
  // running a moment ago and the process is gone by now, which is reported like
  // any other refusal (spec-00011-FR-15)
  it('reports a registration nobody is there to take', async () => {
    const home = makeHome()
    const { port } = await stubHost()
    world({ home, port, cwd: makeProject() })
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).endsWith('/api/instance')) return await real(input, init)
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    })

    const result = await runCli()

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('fetch failed')
    expect(registryOf(home)).toBeNull()
  })
})

describe('persimmon, with nobody on the port', () => {
  // spec-00011-AC-13.1 and spec-00011-AC-13.6, and spec-00012-AC-3.1 with them:
  // the project the cwd sits in is registered, this very process enters the
  // listening state on the port `PORT` names, the address it prints is the
  // command's own stdout, and the command does not return while it serves
  it('registers the project the cwd is in and serves it on the port itself', async () => {
    const home = makeHome()
    const port = await freePort()
    const path = makeProject()
    const nested = join(path, 'docs', 'spec')
    mkdirSync(nested, { recursive: true })
    world({ home, port, cwd: nested })

    const { exit, printed } = boot()
    const line = await addressOf(printed)

    const registered = registryOf(home)?.workspaces ?? []
    expect(registered.map((entry) => entry.path)).toEqual([path])
    expect(line).toBe(`persimmon: http://localhost:${port}/w/${registered[0]?.id}`)
    const instance = await (await fetch(`http://127.0.0.1:${port}/api/instance`)).json()
    expect(instance.app).toBe('persimmon')
    // Still serving: the command returns when the service stops and not before.
    await expect(Promise.race([exit, Promise.resolve('serving')])).resolves.toBe('serving')
  })

  // spec-00011-AC-13.5 and spec-00011-AC-13.7's command half: a project whose
  // flow config is invalid registers and the board comes up on its own
  // `/w/<id>` all the same. What the page shows there is
  // web/test/workspaceSwitcher.test.tsx's.
  it('registers a project whose flow config is invalid and listens all the same', async () => {
    const home = makeHome()
    const port = await freePort()
    const path = makeProject(INVALID_CONFIG)
    world({ home, port, cwd: path })

    const line = await addressOf(boot().printed)

    const registered = registryOf(home)?.workspaces ?? []
    expect(registered.map((entry) => entry.path)).toEqual([path])
    expect(line).toBe(`persimmon: http://localhost:${port}/w/${registered[0]?.id}`)
  })

  // spec-00011-AC-13.4 (TestLaunchesWithNoWorkspaceOutsideEveryProject, whose
  // address line this inherits): a cwd in no project is a start with no
  // workspace, not an error — nothing is registered and the board comes up on
  // the entry point
  it('starts with no workspace when the cwd is in no project', async () => {
    const home = makeHome()
    const port = await freePort()
    world({ home, port, cwd: makeElsewhere() })

    const line = await addressOf(boot().printed)

    expect(line).toBe(`persimmon: http://localhost:${port}/`)
    expect(registryOf(home)).toBeNull()
  })

  // spec-00011-AC-15.6 (TestReportsARegistrationTheFileRefused): the registry
  // file itself refused the write, so the reason is reported and no service is
  // started — the same treatment spec-00011-AC-15.3 gives a registration the
  // running process refused
  it.skipIf(process.getuid?.() === 0)('reports a registration the registry file refused, and listens not', async () => {
    const home = makeHome()
    const port = await freePort()
    mkdirSync(join(home, '.persimmon'))
    chmodSync(join(home, '.persimmon'), 0o500)
    chmodded.push(join(home, '.persimmon'))
    world({ home, port, cwd: makeProject() })

    const result = await runCli()

    expect(result.code).toBe(1)
    expect(result.stderr).toMatch(/EACCES|permission denied/)
    expect(result.stdout).toBe('')
    await expect(fetch(`http://127.0.0.1:${port}/api/instance`)).rejects.toThrow()
  })

  // spec-00011-AC-15.5 and spec-00012-AC-3.3 (the EADDRINUSE backstop of
  // spec-00011-FR-15): the port was free when it was probed and is not any more.
  // The command reports it and exits non-zero — it neither stays in the
  // foreground nor moves to another port — and the entry it wrote on the way is
  // left where it is: the registration happens before the listen, `add` is
  // idempotent, and the project really is there.
  it('reports a port taken between the probe and the listen, and keeps the entry it wrote', async () => {
    const home = makeHome()
    const port = await heldPort()
    const path = makeProject()
    world({ home, port, cwd: path })
    probeReadsItFree()

    const result = await runCli()

    expect(result.code).toBe(1)
    expect(result.stderr).toBe(`persimmon: port ${port} is already in use`)
    expect(registryOf(home)?.workspaces.map((entry) => entry.path)).toEqual([path])
  })
})

describe('the shutdown of the service this process runs', () => {
  /** `host.shutdown()` held open, so «the command did not exit first» is an assertion and not a race. */
  function heldShutdown(): { release: () => void; calls: () => number } {
    const original = Host.prototype.shutdown
    let release = (): void => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const spy = vi.spyOn(Host.prototype, 'shutdown').mockImplementation(async function (this: Host) {
      await gate
      return await original.call(this)
    })
    return { release, calls: () => spy.mock.calls.length }
  }

  // spec-00012-AC-4.1 (TestForwardsSIGINTAndDoesNotExitFirst): the wrap-up runs
  // and the process does not exit before it is done. What the wrap-up then does
  // per running session is spec-00011-FR-16's, proved at that level in
  // server.test.ts; nothing is running here to wrap up.
  it('wraps up on SIGINT and does not exit before the shutdown is done', async () => {
    world({ home: makeHome(), port: await freePort(), cwd: makeProject() })
    const { exit, printed } = boot()
    await addressOf(printed)
    const shutdown = heldShutdown()

    process.emit('SIGINT')
    await vi.waitFor(() => expect(shutdown.calls()).toBe(1))
    await expect(Promise.race([exit, Promise.resolve('still wrapping up')])).resolves.toBe('still wrapping up')

    shutdown.release()
    await expect(exit).resolves.toBe(0)
    booted.splice(0)
  })

  // spec-00012-AC-4.2 (TestForwardsSIGTERM): SIGTERM wraps up the same way, and
  // the process exits after it rather than being killed by the signal
  it('wraps up on SIGTERM and exits with 0 once it is done', async () => {
    world({ home: makeHome(), port: await freePort(), cwd: makeProject() })
    const { exit, printed } = boot()
    await addressOf(printed)

    process.emit('SIGTERM')

    await expect(exit).resolves.toBe(0)
    booted.splice(0)
  })

  // spec-00012-AC-4.3: a second signal of the same kind joins the wrap-up
  // already running — it neither starts a second one from the command's side
  // nor cuts the first one short, which is the impatient exit that would lose
  // the commit this handler exists to protect
  it('joins a second SIGINT into the wrap-up already running', async () => {
    world({ home: makeHome(), port: await freePort(), cwd: makeProject() })
    const { exit, printed } = boot()
    await addressOf(printed)
    const shutdown = heldShutdown()

    process.emit('SIGINT')
    await vi.waitFor(() => expect(shutdown.calls()).toBe(1))
    process.emit('SIGINT')
    await expect(Promise.race([exit, Promise.resolve('still wrapping up')])).resolves.toBe('still wrapping up')

    shutdown.release()
    await expect(exit).resolves.toBe(0)
    booted.splice(0)
  })
})

describe('persimmon add', () => {
  // spec-00011-AC-20.4 (TestAddRegistersThisRepositoryAtItsRoot): this
  // repository's own root registers, and the whole judgement — flow config
  // validator included, which now lives in this very process (design-00004 §4)
  // — calls it available
  it('registers this repository at its root and judges it available', async () => {
    const home = makeHome()
    world({ home, port: await freePort(), cwd: REPO_ROOT })

    const result = await runCli('add')

    expect(result.code).toBe(0)
    const registered = registryOf(home)?.workspaces ?? []
    expect(registered.map((entry) => entry.path)).toEqual([REPO_ROOT])
    expect(result.stdout).toBe(JSON.stringify(registered[0]))
    expect(new AvailabilityJudge().judge(registered[0] as WorkspaceEntry, false).availability).toBe('available')
  })

  // spec-00011-AC-2.3, the idempotence the registration of `new` rests on
  it('adds a registered directory again with the same entry and a zero exit', async () => {
    const home = makeHome()
    const path = makeProject()
    world({ home, port: await freePort(), cwd: makeElsewhere() })

    const first = await runCli('add', path)
    const second = await runCli('add', path, '--name', 'Demo')

    expect([first.code, second.code]).toEqual([0, 0])
    expect(second.stdout).toBe(first.stdout)
    expect(registryOf(home)?.workspaces).toHaveLength(1)
  })

  // spec-00011-AC-2.1 through the running process (design-00003 §8): it writes,
  // so its switcher sees the entry
  it('registers through the process already running, under the name it was given', async () => {
    const home = makeHome()
    const port = await runningHost(home)
    const path = makeProject()
    world({ home, port, cwd: makeElsewhere() })

    const result = await runCli('add', path, '--name', 'Demo')

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).name).toBe('Demo')
    const listed = await (await fetch(`http://127.0.0.1:${port}/api/workspaces`)).json()
    expect(listed.workspaces.map((row: WorkspaceEntry) => row.path)).toEqual([path])
  })

  // spec-00011-AC-15.1 for `add`: it writes, and a stranger on the port leaves
  // it unknown whether a persimmon holds the same registry, so it refuses
  it('refuses to write while a stranger holds the port', async () => {
    const home = makeHome()
    const port = await strangerOn()
    world({ home, port, cwd: makeElsewhere() })

    const result = await runCli('add', makeProject())

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`port ${port} is already in use`)
    expect(registryOf(home)).toBeNull()
  })

  // The exit code is the parser layer's, one for all eight subcommands
  // (spec-00012-FR-12); before the port these three exited 1.
  it.each([
    ['a second path', ['add', '/one', '/two']],
    ['an unknown flag', ['add', '--frobnicate']],
    ['a `--name` with no value', ['add', '--name']],
  ])('refuses %s with the usage line', async (_name, argv) => {
    world({ home: makeHome(), port: await freePort(), cwd: makeElsewhere() })

    const result = await runCli(...argv)

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('usage: persimmon')
  })
})

describe('persimmon remove', () => {
  // spec-00011-AC-4.1, the command half: the entry goes and the directory does not
  it('drops the entry the path names and prints it', async () => {
    const home = makeHome()
    const path = makeProject()
    world({ home, port: await freePort(), cwd: makeElsewhere() })
    await runCli('add', path)

    const result = await runCli('remove', path)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).path).toBe(path)
    expect(registryOf(home)?.workspaces).toEqual([])
    expect(readFileSync(join(path, CONFIG_FILE), 'utf8')).toBe(MINIMAL_CONFIG)
  })

  // TestDeleteDropsTheEntryThroughTheProcess (spec-00011-AC-4.1 through the
  // running process): the path form is looked up as an id, and the entry the
  // process dropped is what comes back
  it('removes through the process already running, by path', async () => {
    const home = makeHome()
    const port = await runningHost(home)
    const path = makeProject()
    world({ home, port, cwd: makeElsewhere() })
    await runCli('add', path)

    const result = await runCli('remove', path)

    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).path).toBe(path)
    const listed = await (await fetch(`http://127.0.0.1:${port}/api/workspaces`)).json()
    expect(listed.workspaces).toEqual([])
  })

  // TestDeleteReportsWhatTheProcessRefused — no AC of its own: whether a running
  // session forbids the removal is the process's check, and its refusal is the
  // sentence the user reads (spec-00011-FR-5)
  it('reports what the running process refused', async () => {
    const { port } = await stubHost({
      get: () => ({ status: 200, body: { workspaces: [{ id: 'demo', name: 'demo', path: '/work/demo' }] } }),
      remove: (id) => ({ status: 409, body: { error: `workspace ${id} has a running session` } }),
    })
    world({ home: makeHome(), port, cwd: makeElsewhere() })

    const result = await runCli('remove', 'demo')

    expect(result.code).toBe(1)
    expect(result.stderr).toBe('persimmon: workspace demo has a running session')
  })

  it('reports an id the running process does not hold', async () => {
    const { port } = await stubHost()
    world({ home: makeHome(), port, cwd: makeElsewhere() })

    const result = await runCli('remove', 'ghost')

    expect(result.code).toBe(1)
    expect(result.stderr).toBe('persimmon: workspace "ghost" is not registered')
  })

  // 2, not the 1 of the hand-written parsing (spec-00012-FR-12).
  it.each([
    ['nothing to remove', ['remove']],
    ['a second argument', ['remove', 'a', 'b']],
  ])('refuses %s with the usage line', async (_name, argv) => {
    world({ home: makeHome(), port: await freePort(), cwd: makeElsewhere() })

    const result = await runCli(...argv)

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('usage: persimmon')
  })

  it('refuses to write while a stranger holds the port', async () => {
    const port = await strangerOn()
    world({ home: makeHome(), port, cwd: makeElsewhere() })

    const result = await runCli('remove', 'demo')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain(`port ${port} is already in use`)
  })
})

describe('persimmon list', () => {
  // spec-00011-AC-21.1: every entry with its availability, and a zero exit
  it('lists every entry with its availability', async () => {
    const home = makeHome()
    const path = makeProject()
    const gone = join(makeElsewhere(), 'gone')
    writeRegistry(home, [
      { id: 'alpha', name: 'alpha', path },
      { id: 'demo', name: 'demo', path: gone },
    ])
    world({ home, port: await freePort(), cwd: makeElsewhere() })

    const result = await runCli('list')

    expect(result.code).toBe(0)
    const lines = result.stdout.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toBe(`alpha  alpha  ${path.padEnd(Math.max(path.length, gone.length))}  available`)
    expect(lines[1]).toBe(`demo   demo   ${gone.padEnd(Math.max(path.length, gone.length))}  missing`)
  })

  // spec-00011-AC-21.2
  it('prints an empty list on an empty registry', async () => {
    world({ home: makeHome(), port: await freePort(), cwd: makeElsewhere() })

    const result = await runCli('list')

    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
  })

  // spec-00011-AC-15.4: `list` neither writes nor wants the port, so a stranger
  // on it is no reason to refuse — the file is read instead and the exit is 0
  it('reads the file and exits 0 while a stranger holds the port', async () => {
    const home = makeHome()
    const path = makeProject()
    writeRegistry(home, [{ id: 'alpha', name: 'alpha', path }])
    world({ home, port: await strangerOn(), cwd: makeElsewhere() })

    const result = await runCli('list')

    expect(result.code).toBe(0)
    expect(availabilities(result.stdout)).toEqual(['available'])
  })

  // spec-00011-AC-21.5: the availability comes from one implementation
  // (design-00004 §4), so the process's answer and this process's own reading of
  // the file say the same thing about the same registry
  it('gives the same availability with a process running and without one', async () => {
    const home = makeHome()
    const broken = makeProject(INVALID_CONFIG)
    const alpha = makeProject()
    writeRegistry(home, [
      { id: 'broken', name: 'broken', path: broken },
      { id: 'alpha', name: 'alpha', path: alpha },
    ])
    const port = await runningHost(home)

    world({ home, port, cwd: makeElsewhere() })
    const throughTheProcess = await runCli('list')
    world({ home, port: await freePort(), cwd: makeElsewhere() })
    const fromTheFile = await runCli('list')

    expect([throughTheProcess.code, fromTheFile.code]).toEqual([0, 0])
    expect(availabilities(throughTheProcess.stdout)).toEqual(['invalidConfig', 'available'])
    expect(availabilities(fromTheFile.stdout)).toEqual(availabilities(throughTheProcess.stdout))
  })

  // TestWorkspacesReportsWhatTheProcessRefused — no AC of its own: a refusal is
  // the process's sentence to say, and the bare status only when it gave none
  it.each([
    ['the sentence it gave', 500, { error: 'the registry file is not readable JSON' }, 'persimmon: the registry file is not readable JSON'],
    ['the bare status when it gave none', 404, {}, 'persimmon: GET /api/workspaces answered 404'],
  ])('reports %s', async (_name, status, body, want) => {
    const { port } = await stubHost({ get: () => ({ status, body }) })
    world({ home: makeHome(), port, cwd: makeElsewhere() })

    const result = await runCli('list')

    expect(result.code).toBe(1)
    expect(result.stderr).toBe(want)
  })
})

describe('persimmon new', () => {
  // spec-00013-AC-1.1 (TestNewTakesTheBaseTemplateByDefault)
  it('takes the base template by default', async () => {
    await stubTemplateRepo({ main: sourced('main') })
    const dir = makeElsewhere()

    expect((await newIn(dir, 'demo')).code).toBe(0)

    expect(source(dir, 'demo')).toBe('main')
  })

  // spec-00013-AC-1.2 (TestNewTakesTheLanguageBranchForLang)
  it('takes the lang/<lang> branch for --lang', async () => {
    await stubTemplateRepo({ 'lang/go': sourced('lang/go') })
    const dir = makeElsewhere()

    expect((await newIn(dir, 'svc', '--lang', 'go')).code).toBe(0)

    expect(source(dir, 'svc')).toBe('lang/go')
  })

  // spec-00013-AC-1.3 (TestNewTakesTheVariantBranchForLangAndVariant)
  it('takes the lang/<lang>/<variant> branch for --lang with --variant', async () => {
    await stubTemplateRepo({ 'lang/java/ddd': sourced('lang/java/ddd') })
    const dir = makeElsewhere()

    expect((await newIn(dir, 'app', '--lang', 'java', '--variant', 'ddd')).code).toBe(0)

    expect(source(dir, 'app')).toBe('lang/java/ddd')
  })

  // spec-00013-AC-1.4 (TestNewLetsRefOverrideTheBranchLangImplies)
  it('lets --ref override the branch --lang implies', async () => {
    await stubTemplateRepo({ 'lang/go': sourced('lang/go'), spike: sourced('spike') })
    const dir = makeElsewhere()

    expect((await newIn(dir, 'demo', '--lang', 'go', '--ref', 'spike')).code).toBe(0)

    expect(source(dir, 'demo')).toBe('spike')
  })

  // spec-00013-AC-1.5 (TestNewCreatesTheProjectUnderDir)
  it('creates the project under --dir', async () => {
    await stubTemplateRepo({ main: sourced('main') })
    const cwd = makeElsewhere()
    const work = makeElsewhere()

    expect((await newIn(cwd, 'demo', '--dir', work)).code).toBe(0)

    expect(source(work, 'demo')).toBe('main')
    expect(existsSync(join(cwd, 'demo'))).toBe(false)
  })

  // spec-00013-AC-1.6 (TestNewTakesTheTemplateCoordinateFromTheEnvironment)
  it('takes the template coordinate from the environment', async () => {
    const asked = await stubTemplateRepo({ main: sourced('main') })
    const dir = makeElsewhere()

    expect((await newInWith({ AINPT_OWNER: 'acme', AINPT_REPO: 'tpl' }, dir, 'demo')).code).toBe(0)

    expect(asked).toContain('acme/tpl/tar.gz/refs/heads/main')
    expect(source(dir, 'demo')).toBe('main')
  })

  // spec-00013-AC-1.7 (TestNewAcceptsSetMoreThanOnce)
  it('accepts --set more than once', async () => {
    await stubTemplateRepo({
      main: {
        'template.json': '{"vars": {"MODULE_PATH": {"prompt": "module"}}, "substitute": ["go.mod"]}',
        'go.mod': 'module {{MODULE_PATH}} // {{EXTRA}}\n',
      },
    })
    const dir = makeElsewhere()

    expect((await newIn(dir, 'demo', '--set', 'MODULE_PATH=example.com/x', '--set', 'EXTRA=1')).code).toBe(0)

    expect(readFileSync(join(dir, 'demo', 'go.mod'), 'utf8')).toBe('module example.com/x // 1\n')
  })

  // spec-00013-AC-1.8 (TestNewAcceptsFlagsBeforeTheProjectName)
  it('accepts a flag written before the project name', async () => {
    await stubTemplateRepo({ 'lang/go': sourced('lang/go') })
    const before = makeElsewhere()

    expect((await newIn(before, '--lang', 'go', 'demo')).code).toBe(0)

    expect(source(before, 'demo')).toBe('lang/go')
  })

  // spec-00013-AC-1.9, spec-00012-AC-15.1's shape on `new`: a long flag written
  // with one dash is normalised before the parse (spec-00012-FR-15)
  it('reads a long flag written with a single dash', async () => {
    await stubTemplateRepo({ 'lang/go': sourced('lang/go') })
    const dir = makeElsewhere()

    expect((await newIn(dir, 'svc', '-lang', 'go')).code).toBe(0)

    expect(source(dir, 'svc')).toBe('lang/go')
  })

  // spec-00013-AC-4.1 (TestNewRefusesVariantWithoutLang): a flag combination the
  // command recognises and cannot use is a usage error too — exit 2
  // (spec-00012-FR-12's closing paragraph)
  it('refuses --variant without --lang', async () => {
    const dir = makeElsewhere()

    const result = await newIn(dir, 'app', '--variant', 'ddd')

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('--variant requires --lang')
    expect(readdirSync(dir)).toEqual([])
  })

  // spec-00013-AC-4.2, spec-00012-AC-12.5 (TestNewWithoutANamePrintsTheUsage)
  it('prints the usage of the subcommand when <name> is missing', async () => {
    const dir = makeElsewhere()

    const result = await newIn(dir)

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('usage: persimmon new')
    expect(readdirSync(dir)).toEqual([])
  })

  // spec-00013-AC-4.3, spec-00012-AC-12.1 (TestNewRefusesASetValueWithoutAnEquals):
  // the fragment is the one `setFlag.Set` printed, word for word
  it('refuses a --set value with no equals sign', async () => {
    const dir = makeElsewhere()

    const result = await newIn(dir, 'demo', '--set', 'BAD')

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('expected KEY=VALUE, got "BAD"')
    expect(readdirSync(dir)).toEqual([])
  })

  // spec-00013-FR-4/FR-5: what the scaffold refused is reported in its own
  // words, under the "error: " prefix the command has always printed, and the
  // exit is 1 — a template that is not there is no usage error
  it('reports what the scaffold refused', async () => {
    await stubTemplateRepo({ main: sourced('main') })
    const dir = makeElsewhere()

    const result = await newIn(dir, 'demo', '--ref', 'nope')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('error:')
    expect(existsSync(join(dir, 'demo'))).toBe(false)
  })

  // spec-00013-AC-4.4, issue-00037 (TestNewRejectsASecondPositionalArgument):
  // the second positional used to be swallowed
  it('rejects a second positional argument', async () => {
    const dir = makeElsewhere()

    const result = await newIn(dir, 'demo', 'extra')

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('"extra"')
    expect(result.stderr).toContain('usage: persimmon new')
    expect(readdirSync(dir)).toEqual([])
  })
})

describe('persimmon update', () => {
  // spec-00013-AC-4.5, issue-00037: `cmdUpdate` had the same silent drop `new` had
  it('rejects a positional argument', async () => {
    const dir = markedProject()
    process.chdir(dir)

    const result = await runCli('update', 'extra')

    expect(result.code).toBe(2)
    expect(result.stderr).toContain('update takes no positional arguments')
    expect(result.stderr).toContain('"extra"')
    expect(readdirSync(dir).sort()).toEqual(['.ainpt.json', 'README.md'])
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('mine\n')
  })

  // TestUpdateOutsideAProjectItCreatedIsReported: a directory with no creation
  // marker is not a project the command made (spec-00013-FR-9)
  it('reports a directory it did not create', async () => {
    process.chdir(makeElsewhere())

    const result = await runCli('update')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('error:')
    expect(result.stderr).toContain('.ainpt.json')
  })

  // spec-00013-FR-9: the merge is `src/scaffold.ts`'s; what the command layer
  // owns is reaching it with `--dir` and exiting 0 on what it settled
  it('takes the directory --dir names and exits 0 on a project already up to date', async () => {
    await stubTemplateRepo({})
    const dir = markedProject()
    process.chdir(makeElsewhere())

    const result = await runCli('update', '--dir', dir)

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Already up to date.')
  })
})

describe('version and help', () => {
  const declared = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version as string

  // spec-00012-AC-9.1: the version is this package's own, not a build-injected one
  it('prints the version of this package', async () => {
    const result = await runCli('version')

    expect(result.code).toBe(0)
    expect(result.stdout).toBe(`persimmon ${declared}`)
  })

  // spec-00012-AC-9.2, spec-00012-AC-15.2: `-v` is a subcommand of the closed
  // set, so it must be settled before the parse rather than normalised to `--v`
  it.each(['-v', '--version'])('answers to %s with the same line', async (spelling) => {
    const result = await runCli(spelling)

    expect(result.code).toBe(0)
    expect(result.stdout).toBe(`persimmon ${declared}`)
  })

  // spec-00012-AC-1.2 (TestHelpListsExactlyTheClosedSubcommandSet). The listing is
  // complete here; `list-langs` itself lands in plan-00034 T4
  it.each(['help', '-h', '--help'])('lists exactly the closed subcommand set for %s', async (spelling) => {
    const result = await runCli(spelling)

    expect(result.code).toBe(0)
    const block = result.stdout.split('Usage:\n')[1] as string
    const listed = []
    for (const line of block.split('\n')) {
      const fields = line.trim().split(/\s+/).filter(Boolean)
      if (fields.length === 0) break
      expect(fields[0]).toBe('persimmon')
      listed.push(fields[1] ?? '')
    }
    expect(listed.sort()).toEqual(['', 'add', 'help', 'list', 'list-langs', 'new', 'remove', 'update', 'version'])
  })

  // design-00004 §2's ruling on where the usage goes, which is a change from the
  // Go original: the normal exit writes stdout, every error path writes stderr
  it('writes the usage to stdout on the way out and to stderr on a refusal', async () => {
    world({ home: makeHome(), port: await freePort(), cwd: makeElsewhere() })

    const asked = await runCli('help')
    const refused = await runCli('frobnicate')

    expect(asked.stderr).toBe('')
    expect(asked.stdout).toContain('Usage:')
    expect(refused.stdout).toBe('')
    expect(refused.stderr).toContain('Usage:')
  })

  // plan-00034 T4 lands `list-langs`; until then the dispatch says so rather
  // than answering as if it had listed something
  it('says list-langs is not implemented yet', async () => {
    const result = await runCli('list-langs')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('not implemented yet')
  })
})

describe('an unknown subcommand', () => {
  // spec-00012-AC-2.1 (TestAnUnknownSubcommandIsRefusedAndLeavesTheRegistryAlone):
  // named, then the usage, exit 1 — not the 2 a usage error takes
  it('is named, printed the usage and refused with 1', async () => {
    const home = makeHome()
    writeRegistry(home, [{ id: 'alpha', name: 'alpha', path: '/alpha' }])
    world({ home, port: await freePort(), cwd: makeElsewhere() })

    const result = await runCli('frobnicate')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unknown command "frobnicate"')
    expect(result.stderr).toContain('Usage:')
    expect(registryOf(home)?.workspaces).toEqual([{ id: 'alpha', name: 'alpha', path: '/alpha' }])
  })

  // spec-00012-AC-2.2 (TestAPathLikeFirstArgumentIsAnUnknownSubcommand)
  it('is what a path-like first argument is', async () => {
    const home = makeHome()
    const dir = makeElsewhere()
    mkdirSync(join(dir, 'some-project'))
    world({ home, port: await freePort(), cwd: dir })

    const result = await runCli('./some-project')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unknown command "./some-project"')
    expect(registryOf(home)).toBeNull()
  })

  // spec-00012-FR-2, spec-00012-FR-14: the judgement is made before the port is
  // resolved, so an unusable PORT does not answer for it
  it('is refused as such even with an unusable PORT', async () => {
    world({ home: makeHome(), port: 4173, cwd: makeElsewhere() })
    vi.stubEnv('PORT', 'abc')

    const result = await runCli('frobnicate')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('unknown command "frobnicate"')
    expect(result.stderr).not.toContain('PORT must be a port number')
  })
})

describe('a usage error on a subcommand the command knows', () => {
  /** A registry with one entry, and what it holds afterwards — every case below leaves it alone. */
  async function registered(): Promise<{ home: string; before: WorkspaceEntry[] }> {
    const home = makeHome()
    const before = [{ id: 'alpha', name: 'alpha', path: '/alpha' }]
    writeRegistry(home, before)
    world({ home, port: await freePort(), cwd: makeElsewhere() })
    return { home, before }
  }

  // spec-00012-AC-12.2 (an unknown flag), spec-00012-AC-12.3 (a flag with no
  // value), spec-00012-AC-12.6 (a missing positional): all 2, where the
  // hand-written parsing they replace exited 1
  it.each([
    ['spec-00012-AC-12.2, an unknown flag', ['add', '--frobnicate']],
    ['spec-00012-AC-12.3, a flag with no value', ['add', '--name']],
    ['spec-00012-AC-12.6, a missing positional', ['remove']],
  ])('exits 2 on %s', async (_name, argv) => {
    const { home, before } = await registered()

    const result = await runCli(...argv)

    expect(result.code).toBe(2)
    expect(result.stderr).not.toBe('')
    expect(registryOf(home)?.workspaces).toEqual(before)
  })

  // spec-00012-AC-12.4, issue-00037: the one place this FR changes whether a
  // call runs at all — `list extra` swallowed the argument and exited 0
  it('exits 2 on a positional `list` does not read, and prints no listing', async () => {
    const { home } = await registered()

    const result = await runCli('list', 'extra')

    expect(result.code).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('list takes no positional arguments')
    expect(registryOf(home)?.workspaces).toHaveLength(1)
  })

  // spec-00012-AC-15.1: the normalisation is the parser layer's, so `add` reads
  // `-name` too — before the port it was refused as an unknown flag
  it('reads a single-dash long flag on `add`, which used to be refused', async () => {
    const home = makeHome()
    const path = makeProject()
    world({ home, port: await freePort(), cwd: makeElsewhere() })

    const result = await runCli('add', path, '-name', 'alpha')

    expect(result.code).toBe(0)
    expect(registryOf(home)?.workspaces).toEqual([{ id: expect.any(String), name: 'alpha', path }])
  })
})

describe('an unusable PORT', () => {
  // spec-00012-AC-13.1: nothing is listened on, and the start path registers nothing
  it('refuses the start path with one sentence', async () => {
    const home = makeHome()
    world({ home, port: 4173, cwd: makeProject() })
    vi.stubEnv('PORT', 'abc')

    const result = await runCli()

    expect(result.code).toBe(1)
    expect(result.stderr).toBe('persimmon: PORT must be a port number, got "abc"')
    expect(registryOf(home)).toBeNull()
  })

  // spec-00012-AC-13.2 and spec-00012-AC-13.3: one outside each bound, neither
  // folded back into the default (TestThePortIsTheEnvironmentOrTheDefault)
  it.each(['65536', '0'])('refuses `add` on PORT=%s rather than falling back to 4173', async (port) => {
    const home = makeHome()
    writeRegistry(home, [])
    world({ home, port: 4173, cwd: makeProject() })
    vi.stubEnv('PORT', port)

    const result = await runCli('add')

    expect(result.code).toBe(1)
    expect(result.stderr).toBe(`persimmon: PORT must be a port number, got ${JSON.stringify(port)}`)
    expect(registryOf(home)?.workspaces).toEqual([])
  })

  // spec-00012-AC-14.3: `list` probes the port, so it is not one of the four
  // dispatched before the port is resolved
  it('refuses `list`, which probes the port', async () => {
    world({ home: makeHome(), port: 4173, cwd: makeElsewhere() })
    vi.stubEnv('PORT', 'abc')

    const result = await runCli('list')

    expect(result.code).toBe(1)
    expect(result.stderr).toContain('PORT must be a port number')
  })

  // spec-00012-AC-14.1: `help` and `version` never read the port, and `update`
  // fails on its own account rather than on this one (spec-00012-FR-14)
  it.each([
    ['help', 0],
    ['version', 0],
    ['update', 1],
  ])('does not stop `%s`', async (command, code) => {
    world({ home: makeHome(), port: 4173, cwd: makeElsewhere() })
    vi.stubEnv('PORT', 'abc')

    const result = await runCli(command)

    expect(result.code).toBe(code)
    expect(result.stderr).not.toContain('PORT must be a port number')
  })
})

describe('the command as an executable', () => {
  // spec-00012 §7: a subcommand must not pay for a whiteboard service it never
  // uses, and the assertion is that the module graph was not evaluated — not a
  // timing threshold (design-00004 §11)
  it('does not evaluate the server module graph on the list path', async () => {
    let evaluated = false
    vi.doMock('../src/host.ts', () => {
      evaluated = true
      return { Host: class {} }
    })
    vi.resetModules()
    try {
      const fresh = await import('../src/cli.ts')
      world({ home: makeHome(), port: await freePort(), cwd: makeElsewhere() })
      vi.spyOn(console, 'log').mockImplementation(() => {})

      await expect(fresh.run(['list'])).resolves.toBe(0)

      expect(evaluated).toBe(false)
    } finally {
      vi.doUnmock('../src/host.ts')
      vi.resetModules()
    }
  })

  /**
   * spec-00012 §7: `bin/` is outside the coverage gate's `include`, so the rule
   * that keeps it from becoming that gate's escape hatch — nothing in there
   * beyond reading `process.argv`, calling `lib/cli.js` and exiting with what it
   * returns — is asserted here rather than left to a reviewer.
   */
  it('keeps bin/persimmon.js a thin entry point', () => {
    const source = readFileSync(new URL('../bin/persimmon.js', import.meta.url), 'utf8')
    const code = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('#!'))

    expect(code.length).toBeLessThanOrEqual(15)
    const imports = code.filter((line) => /\b(import|require)\b/.test(line))
    expect(imports).toEqual(["import { run } from '../lib/cli.js'"])
  })
})
