#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { ConfigError, findRepoRoot } from '../lib/config.js'
import { Host } from '../lib/host.js'
import { AvailabilityJudge } from '../lib/workspaceAvailability.js'
import { WorkspaceRegistry } from '../lib/workspaceRegistry.js'

const { version } = createRequire(import.meta.url)('../package.json')
const port = Number(process.env.PORT ?? 4173)
// The registry lives in the user's home directory and takes no environment
// variable of its own (design-00003 §2); a test points `HOME` at a temporary
// directory, which is what `os.homedir()` reads on POSIX.
const registryPath = join(homedir(), '.persimmon', 'workspaces.json')

const USAGE = 'usage: persimmon [add [path] [--name <name>] | remove <id|path> | list]'
const occupied = () => `port ${port} is already in use`

const [command, ...args] = process.argv.slice(2)

try {
  if (command === undefined) await start()
  else if (command === 'add') await add(args)
  else if (command === 'remove') await remove(args)
  else if (command === 'list') await list()
  else fail(USAGE)
} catch (error) {
  // The whole registry file refused (spec-00011-FR-18), one add or remove it
  // refused (spec-00011-FR-3, spec-00011-FR-5), or no project above the cwd:
  // each of them is one sentence and a non-zero exit, never a stack.
  fail(error.message)
}

/**
 * Start on this port, or hand the work to the process already there
 * (spec-00011-FR-13, spec-00011-FR-14, design-00003 §8). The registration goes
 * through the running process while there is one: its writes are serialised and
 * its switcher shows the new entry at once.
 */
async function start() {
  const target = projectRoot()
  const instance = await probe()
  if (instance.kind === 'occupied') fail(occupied())
  if (instance.kind === 'running') {
    const workspace = target === null ? null : await post(target)
    // The version is printed and never judged on: an older process is joined
    // all the same, and the user decides whether to restart it (design-00003 §8).
    console.log(`${address(port, workspace)} — persimmon ${instance.version} is already running`)
    return
  }
  const workspace = target === null ? null : new WorkspaceRegistry(registryPath).add(target)
  const host = new Host({ registryPath, version })
  const server = host.listen(port)
  server.on('listening', () => console.log(address(server.address().port, workspace)))
  server.on('error', (error) => {
    // The backstop for the race between the probe and this listen: the port was
    // free a moment ago and is not any more (spec-00011-FR-15, design-00003 §8).
    fail(error.code === 'EADDRINUSE' ? occupied() : `cannot listen on port ${port} — ${error.message}`)
  })

  // A normal shutdown wraps up every running session of every workspace before
  // the process goes, so what the agents wrote is committed and their
  // transcripts are on disk (spec-00011-FR-16). `host.shutdown()` is idempotent:
  // a second Ctrl-C joins the one already running rather than exiting out from
  // under it — Node's convention of the second signal being the impatient one is
  // deliberately not followed, because the impatient exit is exactly the lost
  // commit this handler exists to prevent, and the wait is bounded by the signal
  // escalation (issue-00012) rather than by the agents' manners.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      void host.shutdown().then(() => process.exit(0))
    })
  }
}

/** `persimmon add [path] [--name <name>]` (spec-00011-FR-2): non-interactive, idempotent, 0 on an entry that was already there. */
async function add(args) {
  const { path, name } = parseAdd(args)
  const target = path === undefined ? findRepoRoot(process.cwd()) : resolve(path)
  const instance = await probe()
  if (instance.kind === 'occupied') fail(occupied())
  const workspace =
    instance.kind === 'running' ? await post(target, name) : new WorkspaceRegistry(registryPath).add(target, name)
  console.log(JSON.stringify(workspace))
}

/** `persimmon remove <id|path>` (spec-00011-FR-4): the path form is resolved and looked up as an id, so the rest is one code path. */
async function remove([idOrPath, ...rest]) {
  if (idOrPath === undefined || rest.length > 0) fail(USAGE)
  const instance = await probe()
  if (instance.kind === 'occupied') fail(occupied())
  if (instance.kind === 'free') {
    console.log(JSON.stringify(new WorkspaceRegistry(registryPath).remove(idOrPath)))
    return
  }
  const { workspaces } = await call('GET', '/api/workspaces')
  const path = realpathOr(idOrPath)
  const entry = workspaces.find((workspace) => workspace.id === idOrPath || workspace.path === path)
  if (entry === undefined) fail(`workspace ${JSON.stringify(idOrPath)} is not registered`)
  const { workspace } = await call('DELETE', `/api/workspaces/${entry.id}`)
  console.log(JSON.stringify(workspace))
}

/**
 * `persimmon list` (spec-00011-FR-21). It writes nothing, so a port held by
 * someone who is not us is no reason to refuse: the file is read instead. `add`
 * and `remove` write, and a foreign process on the port leaves it unknown
 * whether a persimmon holds the same registry — they refuse rather than write
 * blind (design-00003 §8 rules on the running process and the refused
 * connection; this is the reading of what is left).
 */
async function list() {
  const instance = await probe()
  const rows =
    instance.kind === 'running'
      ? (await call('GET', '/api/workspaces')).workspaces
      : judged(new WorkspaceRegistry(registryPath).read())
  const widths = ['id', 'name', 'path'].map((key) => Math.max(0, ...rows.map((row) => row[key].length)))
  for (const row of rows) {
    const cells = ['id', 'name', 'path'].map((key, at) => row[key].padEnd(widths[at]))
    console.log(`${cells.join('  ')}  ${row.availability}`)
  }
}

/** Every entry judged as an unopened workspace is (spec-00011-FR-6): no process is running, so none of them is live. */
function judged(entries) {
  const judge = new AvailabilityJudge()
  return entries.map((entry) => ({ ...entry, ...judge.judge(entry, false) }))
}

/**
 * Who holds the port (design-00003 §8): a running persimmon to hand the work to,
 * nobody, or somebody else. A timeout counts as occupied — a running process
 * busy with a synchronous read can answer late, and reading a timeout as
 * anything but «taken» is what would start a second process on a held port.
 *
 * The address is the one `Host.listen()` binds, so the probe and the bind name
 * the same `(address, port)` pair rather than two different ones (issue-00028).
 */
async function probe() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/instance`, { signal: AbortSignal.timeout(1000) })
    const instance = response.ok ? await response.json().catch(() => null) : null
    return instance?.app === 'persimmon' ? { kind: 'running', version: instance.version } : { kind: 'occupied' }
  } catch (error) {
    return { kind: error.cause?.code === 'ECONNREFUSED' ? 'free' : 'occupied' }
  }
}

/** Register through the running process (spec-00011-FR-14); an absolute path, because the answer resolves it in its own cwd. */
async function post(path, name) {
  const { workspace } = await call('POST', '/api/workspaces', { path: resolve(path), name })
  return workspace
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
async function call(method, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const answer = await response.json().catch(() => ({}))
  if (!response.ok) fail(answer.error ?? `${method} ${path} answered ${response.status}`)
  return answer
}

/** The project the cwd is in, or null when it is in none — which is a start with no workspace, not an error (spec-00011-FR-13). */
function projectRoot() {
  try {
    return findRepoRoot(process.cwd())
  } catch (error) {
    if (error instanceof ConfigError) return null
    throw error
  }
}

function realpathOr(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/** The address to open, with the workspace in it (design-00003 §8); a start outside every project prints the entry point. */
function address(at, workspace) {
  return `persimmon: http://localhost:${at}/${workspace === null ? '' : `w/${workspace.id}`}`
}

function parseAdd(args) {
  let path
  let name
  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at]
    if (arg === '--name') {
      name = args[at + 1]
      if (name === undefined) fail(USAGE)
      at += 1
      continue
    }
    if (path !== undefined || arg.startsWith('-')) fail(USAGE)
    path = arg
  }
  return { path, name }
}

function fail(message) {
  console.error(`persimmon: ${message}`)
  process.exit(1)
}
