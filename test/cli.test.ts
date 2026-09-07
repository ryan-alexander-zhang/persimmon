import { type ChildProcess, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { type Server, type Socket, createServer as createSocketServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_FILE } from '../src/config.ts'
import { Host } from '../src/host.ts'
import { MINIMAL_CONFIG, freePort, makeRepo } from './helpers.ts'

/**
 * The `persimmon` command of design-00003 §8: the start handshake, the
 * registration that goes through a process already running, and the three
 * subcommands. Every case spawns the real entry point with `HOME` pointed at a
 * temporary directory, because the registry path is derived from the home
 * directory and takes no environment variable of its own (design-00003 §2).
 */

// A spawned node process that loads the whole server tree runs well past
// vitest's default five seconds when the suite runs its files side by side.
vi.setConfig({ testTimeout: 30_000 })

const ENTRY = new URL('../bin/persimmon.js', import.meta.url).pathname

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

const made: string[] = []
const children: ChildProcess[] = []
const hosts: Host[] = []
const held: Array<{ close: (callback: () => void) => void }> = []

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL')
  for (const host of hosts.splice(0)) await host.shutdown()
  for (const server of held.splice(0)) await new Promise((resolve) => server.close(() => resolve(null)))
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A home directory of this test's own, which is where the registry lands. */
function makeHome(): string {
  // `realpath` because macOS puts the temporary directory behind a symlink and
  // the registry stores the resolved path (design-00003 §2).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wb-home-')))
  made.push(dir)
  return dir
}

/** A git repository with a flow config: a directory the CLI reads as a project. */
function makeProject(config = MINIMAL_CONFIG): string {
  const { repoRoot } = makeRepo({})
  made.push(repoRoot)
  const path = realpathSync(repoRoot)
  writeFileSync(join(path, CONFIG_FILE), config)
  return path
}

/** A directory with no flow config at it or above it: the CLI starts there with no workspace. */
function makeElsewhere(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wb-elsewhere-')))
  made.push(dir)
  return dir
}

const registryPathOf = (home: string): string => join(home, '.persimmon', 'workspaces.json')

interface Row {
  id: string
  name: string
  path: string
}

/** The registry as it stands on disk, or null when the command wrote none. */
function registryOf(home: string): { workspaces: Row[] } | null {
  try {
    return JSON.parse(readFileSync(registryPathOf(home), 'utf8'))
  } catch {
    return null
  }
}

function writeRegistry(home: string, text: string): void {
  mkdirSync(join(home, '.persimmon'), { recursive: true })
  writeFileSync(registryPathOf(home), text)
}

interface Invocation {
  cwd: string
  home: string
  port: number
}

/**
 * The command as a user runs it, for the forms that print and exit. Spawned
 * rather than `spawnSync`: a case with a host running in this very process has
 * to be able to answer the child's handshake while the child runs.
 */
async function run(
  args: string[],
  { cwd, home, port }: Invocation,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [ENTRY, ...args], {
    cwd,
    env: { ...process.env, HOME: home, PORT: String(port) },
    timeout: 20_000,
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (data) => {
    stdout += String(data)
  })
  child.stderr.on('data', (data) => {
    stderr += String(data)
  })
  const status = await new Promise<number | null>((resolve) => child.on('exit', resolve))
  return { status, stdout, stderr }
}

/** The form that keeps listening: its first line of output, and the child to kill afterwards. */
async function boot({ cwd, home, port }: Invocation): Promise<string> {
  const child = spawn(process.execPath, [ENTRY], {
    cwd,
    env: { ...process.env, HOME: home, PORT: String(port) },
  })
  children.push(child)
  let noise = ''
  child.stderr.on('data', (data) => {
    noise += String(data)
  })
  return await new Promise<string>((resolve, reject) => {
    child.stdout.once('data', (data) => resolve(String(data).trim()))
    child.once('exit', (code) => reject(new Error(`persimmon exited ${code}: ${noise}`)))
  })
}

/**
 * Somebody who is not a persimmon, holding the port until the test is over. Its
 * open sockets are destroyed by hand: a server that never answered still has the
 * connection, and `close()` alone waits for it.
 */
function hold(server: Server, port: number): void {
  const open: Socket[] = []
  server.on('connection', (socket) => open.push(socket))
  server.listen(port)
  held.push({
    close: (done) => {
      for (const socket of open) socket.destroy()
      server.close(() => done())
    },
  })
}

/** A persimmon already running on a port of its own, sharing this home's registry. */
async function runningHost(home: string): Promise<number> {
  const host = new Host({ registryPath: registryPathOf(home), version: '9.9.9' })
  hosts.push(host)
  const server = host.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  return (server.address() as { port: number }).port
}

describe('persimmon, with no subcommand', () => {
  // spec-00011-AC-13.1, and spec-00011-AC-13.6 with it: the port is the one `PORT` names
  it('registers the project the cwd is in and serves it on the port', async () => {
    const path = makeProject()
    const home = makeHome()
    const port = await freePort()
    const nested = join(path, 'docs', 'spec')
    mkdirSync(nested, { recursive: true })

    const line = await boot({ cwd: nested, home, port })

    const registry = registryOf(home)
    expect(registry?.workspaces.map(({ path: at }) => at)).toEqual([path])
    expect(line).toBe(`persimmon: http://localhost:${port}/w/${registry?.workspaces[0]?.id}`)
    const instance = await (await fetch(`http://localhost:${port}/api/instance`)).json()
    expect(instance.app).toBe('persimmon')
  })

  // spec-00011-AC-13.5, and spec-00011-AC-13.7's command half: the address
  // printed is that broken project's own `/w/<id>`. What the page then shows
  // there is web/test/workspaceSwitcher.test.tsx's.
  it('registers a project whose flow config is invalid and listens all the same', async () => {
    const path = makeProject(INVALID_CONFIG)
    const home = makeHome()
    const port = await freePort()

    const line = await boot({ cwd: path, home, port })

    const registry = registryOf(home)
    expect(registry?.workspaces.map(({ path: at }) => at)).toEqual([path])
    expect(line).toBe(`persimmon: http://localhost:${port}/w/${registry?.workspaces[0]?.id}`)
  })

  // spec-00011-AC-14.1
  it('registers through the process already running and starts no second one', async () => {
    const home = makeHome()
    const port = await runningHost(home)
    const path = makeProject()

    const result = await run([], { cwd: path, home, port })

    expect(result.status).toBe(0)
    const registry = registryOf(home)
    expect(registry?.workspaces.map(({ path: at }) => at)).toEqual([path])
    expect(result.stdout).toContain(`http://localhost:${port}/w/${registry?.workspaces[0]?.id}`)
    expect(result.stdout).toContain('is already running')
  })

  // spec-00011-AC-14.3
  it('prints the running process entry point when the cwd is in no project', async () => {
    const home = makeHome()
    const port = await runningHost(home)

    const result = await run([], { cwd: makeElsewhere(), home, port })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`http://localhost:${port}/ —`)
    expect(registryOf(home)).toBeNull()
  })

  // spec-00011-AC-15.1
  it('reports the port as occupied when the server on it is not a persimmon', async () => {
    const port = await freePort()
    hold(createServer((_request, response) => response.end('not persimmon')), port)
    const home = makeHome()

    const result = await run([], { cwd: makeProject(), home, port })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`port ${port} is already in use`)
    expect(registryOf(home)).toBeNull()
  })

  // spec-00011-AC-15.2
  it('reports the port as occupied, in bounded time, when nothing on it answers', async () => {
    const port = await freePort()
    hold(createSocketServer(), port)
    const started = Date.now()

    const result = await run([], { cwd: makeProject(), home: makeHome(), port })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`port ${port} is already in use`)
    expect(Date.now() - started).toBeLessThan(15_000)
  })

  // spec-00011-AC-15.3
  it.skipIf(process.getuid?.() === 0)('reports a registration the running process refused, and listens not', async () => {
    const home = makeHome()
    mkdirSync(join(home, '.persimmon'))
    const port = await runningHost(home)
    chmodSync(join(home, '.persimmon'), 0o500)

    const result = await run([], { cwd: makeProject(), home, port })
    chmodSync(join(home, '.persimmon'), 0o700)

    expect(result.status).toBe(1)
    expect(result.stderr).toMatch(/EACCES|permission denied/)
    expect(result.stdout).not.toContain('http://localhost')
  })
})

describe('persimmon add', () => {
  // spec-00011-AC-2.1
  it('registers the given directory and prints the entry', async () => {
    const path = makeProject()
    const home = makeHome()

    const result = await run(['add', path], { cwd: makeElsewhere(), home, port: await freePort() })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({ id: expect.stringMatching(/^[a-z0-9-]+$/), name: expect.any(String), path })
    expect(registryOf(home)?.workspaces.map(({ path: at }) => at)).toEqual([path])
  })

  // spec-00011-AC-2.3 — the idempotence `ainpt new`'s registration step rests on
  it('adds a registered directory again with the same entry and a zero exit', async () => {
    const path = makeProject()
    const home = makeHome()
    const elsewhere = makeElsewhere()
    const port = await freePort()

    const first = await run(['add', path], { cwd: elsewhere, home, port })
    const second = await run(['add', path], { cwd: elsewhere, home, port })

    expect([first.status, second.status]).toEqual([0, 0])
    expect(second.stdout).toBe(first.stdout)
    expect(registryOf(home)?.workspaces).toHaveLength(1)
  })

  // spec-00011-AC-2.4
  it('defaults the path to the project the cwd is in', async () => {
    const path = makeProject()
    const home = makeHome()
    const nested = join(path, 'docs', 'spec')
    mkdirSync(nested, { recursive: true })

    const result = await run(['add'], { cwd: nested, home, port: await freePort() })

    expect(result.status).toBe(0)
    expect(registryOf(home)?.workspaces.map(({ path: at }) => at)).toEqual([path])
  })

  // spec-00011-AC-3.2
  it('refuses a directory that holds no flow config, naming what is missing', async () => {
    const plain = makeElsewhere()
    const home = makeHome()

    const result = await run(['add', plain], { cwd: makeElsewhere(), home, port: await freePort() })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(CONFIG_FILE)
    expect(registryOf(home)).toBeNull()
  })

  // spec-00011-AC-2.1 through the running process (design-00003 §8): it writes, so its switcher sees the entry
  it('registers through the process already running when there is one', async () => {
    const home = makeHome()
    const port = await runningHost(home)
    const path = makeProject()

    const result = await run(['add', path, '--name', 'Demo'], { cwd: makeElsewhere(), home, port })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).name).toBe('Demo')
    const listed = await (await fetch(`http://localhost:${port}/api/workspaces`)).json()
    expect(listed.workspaces.map(({ path: at }: Row) => at)).toEqual([path])
  })
})

describe('persimmon remove', () => {
  // spec-00011-AC-5.2
  it('reports an id that is not registered and leaves the registry alone', async () => {
    const home = makeHome()
    writeRegistry(home, `${JSON.stringify({ version: 1, workspaces: [] }, null, 2)}\n`)
    const before = readFileSync(registryPathOf(home), 'utf8')

    const result = await run(['remove', 'ghost'], { cwd: makeElsewhere(), home, port: await freePort() })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not registered')
    expect(readFileSync(registryPathOf(home), 'utf8')).toBe(before)
  })

  // spec-00011-AC-4.1, the command half: the entry goes and the directory does not
  it('drops the entry the path names and prints it', async () => {
    const path = makeProject()
    const home = makeHome()
    const elsewhere = makeElsewhere()
    const port = await freePort()
    await run(['add', path], { cwd: elsewhere, home, port })

    const result = await run(['remove', path], { cwd: elsewhere, home, port })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).path).toBe(path)
    expect(registryOf(home)?.workspaces).toEqual([])
    expect(readFileSync(join(path, CONFIG_FILE), 'utf8')).toBe(MINIMAL_CONFIG)
  })

  // spec-00011-AC-4.1 through the running process (design-00003 §8): the path form is looked up as an id
  it('removes through the process already running, by path', async () => {
    const home = makeHome()
    const port = await runningHost(home)
    const path = makeProject()
    const elsewhere = makeElsewhere()
    await run(['add', path], { cwd: elsewhere, home, port })

    const result = await run(['remove', path], { cwd: elsewhere, home, port })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).path).toBe(path)
    const listed = await (await fetch(`http://localhost:${port}/api/workspaces`)).json()
    expect(listed.workspaces).toEqual([])
  })
})

/**
 * `persimmon list` from a directory that is no project of its own — which is
 * also the observable half of spec-00011-AC-20.1 and spec-00011-AC-20.2. The
 * install forms themselves (a global install, and a one-off npm run) are not
 * reachable from a suite that runs the entry point out of the work tree: they
 * are verified by the 实测 plan-00027 §Detailed Acceptance Path 第 7 项 obliges,
 * and spec-00011 §7 counts AC-20.2 unverified until it passes.
 */
describe('persimmon list', () => {
  // spec-00011-AC-21.1
  it('lists every entry with its availability', async () => {
    const path = makeProject()
    const home = makeHome()
    const gone = join(makeElsewhere(), 'gone')
    writeRegistry(
      home,
      JSON.stringify({
        version: 1,
        workspaces: [
          { id: 'alpha', name: 'alpha', path },
          { id: 'demo', name: 'demo', path: gone },
        ],
      }),
    )

    const result = await run(['list'], { cwd: makeElsewhere(), home, port: await freePort() })

    expect(result.status).toBe(0)
    const lines = result.stdout.trim().split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('alpha')
    expect(lines[0]).toContain('available')
    expect(lines[1]).toContain(gone)
    expect(lines[1]).toContain('missing')
  })

  // spec-00011-AC-21.2
  it('prints an empty list on an empty registry', async () => {
    const result = await run(['list'], { cwd: makeElsewhere(), home: makeHome(), port: await freePort() })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
  })
})

describe('an ill-formed registry', () => {
  // spec-00011-AC-18.1
  it('refuses the start, naming the file and the problem, and rewrites nothing', async () => {
    const home = makeHome()
    writeRegistry(home, 'not json at all')

    const result = await run([], { cwd: makeProject(), home, port: await freePort() })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(registryPathOf(home))
    expect(result.stderr).toContain('not readable JSON')
    expect(readFileSync(registryPathOf(home), 'utf8')).toBe('not json at all')
  })

  // spec-00011-AC-18.2
  it('refuses `list` on a duplicated id, naming it', async () => {
    const home = makeHome()
    const path = makeProject()
    writeRegistry(
      home,
      JSON.stringify({
        version: 1,
        workspaces: [
          { id: 'demo', name: 'demo', path },
          { id: 'demo', name: 'other', path: makeElsewhere() },
        ],
      }),
    )

    const result = await run(['list'], { cwd: makeElsewhere(), home, port: await freePort() })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('"demo"')
    expect(result.stderr).toContain('registered twice')
  })

  // spec-00011-AC-18.3
  it('refuses `add` when `~/.persimmon` is a file, naming the path', async () => {
    const home = makeHome()
    writeFileSync(join(home, '.persimmon'), 'not a directory\n')

    const result = await run(['add', makeProject()], { cwd: makeElsewhere(), home, port: await freePort() })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(registryPathOf(home))
  })
})
