import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { ConfigError, findRepoRoot } from './config.ts'
import { AvailabilityJudge } from './workspaceAvailability.ts'
import { type WorkspaceEntry, WorkspaceRegistry } from './workspaceRegistry.ts'

/**
 * The `persimmon` command (design-00004 §2): the startup handshake and the
 * registry subcommands, in the one process the whiteboard service also runs in
 * (design-00004 §1). `bin/persimmon.js` is a thin entry point that hands over
 * argv and exits with what {@link run} returns, so nothing here calls
 * `process.exit` — an exit code that is returned is one a test can observe
 * (spec-00012-FR-3), and a `process.exit` would take the coverage bookkeeping
 * with it.
 */

const USAGE = 'usage: persimmon [add [path] [--name <name>] | remove <id|path> | list]'

const SIGNALS = ['SIGINT', 'SIGTERM'] as const

/** Everything the command reads from the world, read per call rather than at import (a test moves both). */
interface World {
  /** The port to probe and, with nobody there, the one to listen on (spec-00011-FR-13). */
  port: number
  /**
   * The registry file. It lives in the user's home directory and takes no
   * environment variable of its own (design-00003 §2); a test points `HOME` at a
   * temporary directory, which is what `os.homedir()` reads on POSIX.
   */
  registryPath: string
}

/** One registry entry with the availability beside it, as `list` prints them (design-00003 §5). */
interface Row extends WorkspaceEntry {
  availability: string
}

/** What one of the running process's routes answers with (design-00003 §5). */
interface Answer {
  workspace?: WorkspaceEntry
  workspaces?: Row[]
  error?: string
}

/** Who holds the port (design-00003 §8). */
type Instance = { kind: 'running'; version: string } | { kind: 'free' | 'occupied' }

/**
 * One run of the command; the number is its exit code. The whole registry file
 * refused (spec-00011-FR-18), one add or remove it refused (spec-00011-FR-3,
 * spec-00011-FR-5), or no project above the cwd: each of them is one sentence
 * and a non-zero exit, never a stack.
 */
export async function run(argv: string[]): Promise<number> {
  const [command, ...args] = argv
  const world: World = {
    port: Number(process.env.PORT ?? 4173),
    registryPath: join(homedir(), '.persimmon', 'workspaces.json'),
  }
  try {
    if (command === undefined) return await start(world)
    if (command === 'add') return await add(world, args)
    if (command === 'remove') return await remove(world, args)
    if (command === 'list') return await list(world)
    return fail(USAGE)
  } catch (error) {
    return fail((error as Error).message)
  }
}

/**
 * Start on this port, or hand the work to the process already there
 * (spec-00011-FR-13, spec-00011-FR-14, design-00003 §8). The registration goes
 * through the running process while there is one: its writes are serialised and
 * its switcher shows the new entry at once.
 */
async function start(world: World): Promise<number> {
  const target = projectRoot()
  const instance = await probe(world.port)
  if (instance.kind === 'occupied') throw new Error(occupied(world.port))
  if (instance.kind === 'running') {
    const workspace = target === null ? null : await post(world.port, target)
    // The version is printed and never judged on: an older process is joined
    // all the same, and the user decides whether to restart it (design-00003 §8).
    console.log(`${address(world.port, workspace)} — persimmon ${instance.version} is already running`)
    return 0
  }
  // Before the listen, and the EADDRINUSE backstop below does not roll it back:
  // `add` is idempotent and the project really is there (spec-00011-AC-15.5).
  const workspace = target === null ? null : new WorkspaceRegistry(world.registryPath).add(target)
  return await listen(world, workspace)
}

/**
 * Serve in this very process until a signal wraps it up (spec-00012-FR-3). The
 * promise is the whole point: the address, the EADDRINUSE backstop and the
 * shutdown all arrive in event handlers, and each of them has to be able to
 * settle the command's exit code rather than take the process down itself
 * (spec-00012-AC-3.3, spec-00012-AC-4.2, spec-00012-AC-4.3).
 */
async function listen(world: World, workspace: WorkspaceEntry | null): Promise<number> {
  // Here and nowhere earlier: the subcommand paths must not pay for a server
  // module graph they never use (design-00004 §11, spec-00012 §7).
  const { Host } = await import('./host.ts')
  const host = new Host({ registryPath: world.registryPath, version: version() })
  const server = host.listen(world.port)
  return await new Promise<number>((settle) => {
    const done = (code: number): void => {
      for (const signal of SIGNALS) process.off(signal, stop)
      settle(code)
    }
    /**
     * A normal shutdown wraps up every running session of every workspace before
     * the process goes, so what the agents wrote is committed and their
     * transcripts are on disk (spec-00011-FR-16). `host.shutdown()` is
     * idempotent: a second Ctrl-C joins the one already running rather than
     * exiting out from under it — Node's convention of the second signal being
     * the impatient one is deliberately not followed, because the impatient exit
     * is exactly the lost commit this handler exists to prevent, and the wait is
     * bounded by the signal escalation (issue-00012) rather than by the agents'
     * manners.
     */
    const stop = (): void => void host.shutdown().then(() => done(0))
    server.on('listening', () => console.log(address((server.address() as { port: number }).port, workspace)))
    server.on('error', (error: NodeJS.ErrnoException) => {
      // The backstop for the race between the probe and this listen: the port was
      // free a moment ago and is not any more (spec-00011-FR-15, design-00003 §8).
      const why = error.code === 'EADDRINUSE' ? occupied(world.port) : `cannot listen on port ${world.port} — ${error.message}`
      done(fail(why))
    })
    for (const signal of SIGNALS) process.on(signal, stop)
  })
}

/** `persimmon add [path] [--name <name>]` (spec-00011-FR-2): non-interactive, idempotent, 0 on an entry that was already there. */
async function add(world: World, args: string[]): Promise<number> {
  const { path, name } = parseAdd(args)
  const target = path === undefined ? findRepoRoot(process.cwd()) : resolve(path)
  const instance = await probe(world.port)
  if (instance.kind === 'occupied') throw new Error(occupied(world.port))
  const workspace =
    instance.kind === 'running'
      ? await post(world.port, target, name)
      : new WorkspaceRegistry(world.registryPath).add(target, name)
  console.log(JSON.stringify(workspace))
  return 0
}

/** `persimmon remove <id|path>` (spec-00011-FR-4): the path form is resolved and looked up as an id, so the rest is one code path. */
async function remove(world: World, [idOrPath, ...rest]: string[]): Promise<number> {
  if (idOrPath === undefined || rest.length > 0) throw new Error(USAGE)
  const instance = await probe(world.port)
  if (instance.kind === 'occupied') throw new Error(occupied(world.port))
  if (instance.kind === 'free') {
    console.log(JSON.stringify(new WorkspaceRegistry(world.registryPath).remove(idOrPath)))
    return 0
  }
  const workspaces = (await call(world.port, 'GET', '/api/workspaces')).workspaces as Row[]
  const path = realpathOr(idOrPath)
  const entry = workspaces.find((workspace) => workspace.id === idOrPath || workspace.path === path)
  if (entry === undefined) throw new Error(`workspace ${JSON.stringify(idOrPath)} is not registered`)
  const { workspace } = await call(world.port, 'DELETE', `/api/workspaces/${entry.id}`)
  console.log(JSON.stringify(workspace))
  return 0
}

/**
 * `persimmon list` (spec-00011-FR-21). It writes nothing, so a port held by
 * someone who is not us is no reason to refuse: the file is read instead. `add`
 * and `remove` write, and a foreign process on the port leaves it unknown
 * whether a persimmon holds the same registry — they refuse rather than write
 * blind (design-00003 §8 rules on the running process and the refused
 * connection; this is the reading of what is left).
 *
 * The availability of the file path is this process's own judgement, from the
 * one implementation there is (design-00004 §4): the same class the running
 * process answers with, so both paths say the same thing (spec-00011-AC-21.5).
 */
async function list(world: World): Promise<number> {
  const instance = await probe(world.port)
  const rows =
    instance.kind === 'running'
      ? ((await call(world.port, 'GET', '/api/workspaces')).workspaces as Row[])
      : judged(new WorkspaceRegistry(world.registryPath).read())
  const widths = (['id', 'name', 'path'] as const).map((key) => Math.max(0, ...rows.map((row) => row[key].length)))
  for (const row of rows) {
    const cells = (['id', 'name', 'path'] as const).map((key, at) => row[key].padEnd(widths[at] as number))
    console.log(`${cells.join('  ')}  ${row.availability}`)
  }
  return 0
}

/** Every entry judged as an unopened workspace is (spec-00011-FR-6): no process is running, so none of them is live. */
function judged(entries: WorkspaceEntry[]): Row[] {
  const judge = new AvailabilityJudge()
  return entries.map((entry) => ({ ...entry, ...judge.judge(entry, false) }))
}

/**
 * Who holds the port (design-00003 §8): a running persimmon to hand the work to,
 * nobody, or somebody else. Only a refused connection is «nobody» — a timeout, a
 * reset, a non-200 and another app's answer are all «taken», because a running
 * process busy with a synchronous read can answer late, and reading a timeout as
 * anything but «taken» is what would start a second process on a held port.
 *
 * The address is the one `Host.listen()` binds, so the probe and the bind name
 * the same `(address, port)` pair rather than two different ones (issue-00028).
 */
async function probe(port: number): Promise<Instance> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/instance`, { signal: AbortSignal.timeout(1000) })
    const instance = response.ok ? await response.json().catch(() => null) : null
    return instance?.app === 'persimmon' ? { kind: 'running', version: instance.version } : { kind: 'occupied' }
  } catch (error) {
    return { kind: (error as { cause?: { code?: string } }).cause?.code === 'ECONNREFUSED' ? 'free' : 'occupied' }
  }
}

/** Register through the running process (spec-00011-FR-14); an absolute path, because the answer resolves it in its own cwd. */
async function post(port: number, path: string, name?: string): Promise<WorkspaceEntry> {
  return (await call(port, 'POST', '/api/workspaces', { path: resolve(path), name })).workspace as WorkspaceEntry
}

/**
 * One call to the running process. A refusal is its sentence to say: an add the
 * registry refused answers 422 and a write that failed 500 (design-00003 §5),
 * and the command reports it and exits non-zero without listening
 * (spec-00011-FR-15).
 *
 * On the same address the probe uses, so the whole handshake names one
 * `(address, port)` pair rather than two (issue-00028).
 */
async function call(port: number, method: string, path: string, body?: unknown): Promise<Answer> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(answer.error ?? `${method} ${path} answered ${response.status}`)
  return answer
}

/** The project the cwd is in, or null when it is in none — which is a start with no workspace, not an error (spec-00011-FR-13). */
function projectRoot(): string | null {
  try {
    return findRepoRoot(process.cwd())
  } catch (error) {
    if (error instanceof ConfigError) return null
    throw error
  }
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** The address to open, with the workspace in it (design-00003 §8); a start outside every project prints the entry point. */
function address(at: number, workspace: WorkspaceEntry | null): string {
  return `persimmon: http://localhost:${at}/${workspace === null ? '' : `w/${workspace.id}`}`
}

/** This package's own version, which `GET /api/instance` carries (design-00004 §2). */
function version(): string {
  return createRequire(import.meta.url)('../package.json').version
}

function parseAdd(args: string[]): { path?: string; name?: string } {
  let path: string | undefined
  let name: string | undefined
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at] as string
    if (arg === '--name') {
      name = args[at + 1]
      if (name === undefined) throw new Error(USAGE)
      at += 1
      continue
    }
    if (path !== undefined || arg.startsWith('-')) throw new Error(USAGE)
    path = arg
  }
  return { path, name }
}

const occupied = (port: number): string => `port ${port} is already in use`

/** One sentence on stderr and a non-zero exit code to return, never a stack. */
function fail(message: string): number {
  console.error(`persimmon: ${message}`)
  return 1
}
