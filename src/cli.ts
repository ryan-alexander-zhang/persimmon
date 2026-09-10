import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { type ParseArgsConfig, parseArgs } from 'node:util'
import { ConfigError, findRepoRoot } from './config.ts'
import { create, update } from './scaffold.ts'
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

/** The one line `add`, `remove` and `list` print when their arguments are not what they take (design-00003 §8). */
const REGISTRY_USAGE = 'usage: persimmon [add [path] [--name <name>] | remove <id|path> | list]'

/** The one-line usage of `new`, shown when its arguments do not name exactly one project (`5527313:cli/main.go:31`). */
const NEW_USAGE = 'usage: persimmon new <name> [--lang go] [--variant ddd] [--dir .] [--set K=V]'

const UPDATE_USAGE = 'usage: persimmon update [--dir .]'

/**
 * The whole usage. Its `Usage:` block lists exactly the closed subcommand set of
 * spec-00012-FR-1 — nine lines, no more and no fewer (spec-00012-AC-1.2).
 */
const USAGE = `persimmon — scaffold a project from the ai-native-project-template, and open its whiteboard

Usage:
  persimmon
  persimmon new <name> [--lang go] [--variant ddd] [--dir .] [--ref <branch>] [--set KEY=VALUE]
  persimmon update [--dir .]
  persimmon list-langs
  persimmon add [path] [--name <name>]
  persimmon remove <id|path>
  persimmon list
  persimmon version
  persimmon help

With no subcommand persimmon opens the board for the project the current
directory is in. "version" also answers to -v and --version, "help" to -h and
--help.

Flags for "new":
  --lang     language branch to use (lang/<lang>); empty uses the base template (main)
  --variant  variant under a language (lang/<lang>/<variant>); requires --lang
  --dir      parent directory for the new project (default ".")
  --ref      branch override (default: main, lang/<lang>, or lang/<lang>/<variant>)
  --set      set a template variable, repeatable (e.g. --set MODULE_PATH=example.com/x)

"update" 3-way merges later template changes into an existing project (using the
.ainpt.json written at creation). Resolve any conflict markers, then commit.

Environment:
  PORT                      the port the board is served on (default 4173)
  AINPT_OWNER, AINPT_REPO   override the template source repository`

/** The subcommands that read the registry path and the port, so their dispatch waits for both (spec-00012-FR-14). */
const WORLDLY = new Set(['new', 'add', 'remove', 'list'])

/** The base URL of the template repository's host API; a test hands {@link listLangs} a local server instead (design-00004 §6). */
const GITHUB_API = 'https://api.github.com'

/** The port every path of the command uses when `PORT` names none (spec-00011-FR-13). */
const DEFAULT_PORT = 4173

const SIGNALS = ['SIGINT', 'SIGTERM'] as const

/** The template repository, overridable by the environment as it was before the port (spec-00013-FR-1). */
const template = (): { owner: string; repo: string } => ({
  owner: process.env.AINPT_OWNER || 'ryan-alexander-zhang',
  repo: process.env.AINPT_REPO || 'ai-native-project-template',
})

/**
 * A usage or parsing error: the command was recognised and written wrong, which
 * exits 2 for every one of the eight subcommands (spec-00012-FR-12). An unknown
 * command is the other thing and exits 1 (spec-00012-FR-2).
 */
class UsageError extends Error {}

/** What one subcommand's arguments may be, which is all the parser layer needs to know about it. */
interface Grammar {
  /** The flags it takes; `--set` is the only repeatable one (design-00004 §2). */
  options: NonNullable<ParseArgsConfig['options']>
  /** How many positionals it reads, and how it says so when more are left over. */
  reads: number
  takes: string
  usage: string
}

const NEW: Grammar = {
  options: {
    lang: { type: 'string' },
    variant: { type: 'string' },
    dir: { type: 'string' },
    ref: { type: 'string' },
    set: { type: 'string', multiple: true },
  },
  reads: 1,
  takes: 'new takes a single <name>',
  usage: NEW_USAGE,
}

const UPDATE: Grammar = { options: { dir: { type: 'string' } }, reads: 0, takes: 'update takes no positional arguments', usage: UPDATE_USAGE }
const ADD: Grammar = { options: { name: { type: 'string' } }, reads: 1, takes: 'add takes a single [path]', usage: REGISTRY_USAGE }
const REMOVE: Grammar = { options: {}, reads: 1, takes: 'remove takes a single <id|path>', usage: REGISTRY_USAGE }
const LIST: Grammar = { options: {}, reads: 0, takes: 'list takes no positional arguments', usage: REGISTRY_USAGE }

/**
 * The parser layer, one for all eight subcommands (spec-00012-FR-12). It is
 * `util.parseArgs` plus the three things it does not cover (design-00004 §6):
 *
 * - a long flag written with one dash is normalised to two **before** the call,
 *   because Go's `flag` took either and `parseArgs` throws on the first
 *   (spec-00012-FR-15);
 * - a `--set` whose value is no `KEY=VALUE` is refused **after** it, because
 *   `parseArgs` takes `"A"` happily (spec-00013-FR-4);
 * - a positional argument left unread is refused after it too — one assertion
 *   where there used to be one silent drop per subcommand (issue-00037).
 */
function parse(args: string[], grammar: Grammar): { values: Record<string, unknown>; positionals: string[] } {
  let parsed: { values: Record<string, unknown>; positionals: string[] }
  try {
    parsed = parseArgs({ args: args.map(twoDashes), options: grammar.options, allowPositionals: true })
  } catch (error) {
    throw new UsageError(`${asMessage(error)}\n${grammar.usage}`)
  }
  for (const value of many(parsed.values.set)) {
    if (!value.includes('=')) throw new UsageError(`expected KEY=VALUE, got ${JSON.stringify(value)}\n${grammar.usage}`)
  }
  const extra = parsed.positionals[grammar.reads]
  if (extra !== undefined) throw new UsageError(`${grammar.takes}, got ${JSON.stringify(extra)}\n${grammar.usage}`)
  return parsed
}

/**
 * `-lang` and `-lang=go` become `--lang` and `--lang=go`; `-v` and `-h` are left
 * alone, being the two single-character flags of the closed subcommand set
 * rather than long flags written short (spec-00012-AC-15.2).
 */
function twoDashes(arg: string): string {
  return arg.startsWith('-') && !arg.startsWith('--') && arg.length > 2 ? `-${arg}` : arg
}

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)
const many = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : [])
const asMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

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
  try {
    // The four that read neither the registry path nor the port come first, so
    // none of them can fail over a home directory or a `PORT` it never reads
    // (spec-00012-FR-14). `-v` and `-h` are settled here too: they would reach
    // `parseArgs` as unknown options and take `persimmon -v` from a version to
    // an exit 2 (spec-00012-AC-15.2, design-00004 §6).
    if (command === 'update') return await updateProject(args)
    if (command === 'list-langs') return await listLangs(GITHUB_API)
    if (command === 'version' || command === '-v' || command === '--version') return printVersion()
    if (command === 'help' || command === '-h' || command === '--help') return print(USAGE)
    // Before both parses as well: a first argument that is no subcommand at all
    // — a path among them — must not run into a `PORT` it was never going to
    // use (spec-00012-FR-2, spec-00012-AC-2.2).
    if (command !== undefined && !WORLDLY.has(command)) return unknown(command)
    const world: World = {
      port: resolvePort(process.env.PORT),
      registryPath: join(homedir(), '.persimmon', 'workspaces.json'),
    }
    if (command === undefined) return await start(world)
    if (command === 'new') return await newProject(world, args)
    if (command === 'add') return await add(world, args)
    if (command === 'remove') return await remove(world, args)
    return await list(world, args)
  } catch (error) {
    if (error instanceof UsageError) return refuse(error.message)
    return fail(asMessage(error))
  }
}

/**
 * `PORT` or the default. A value that is no port at all is refused rather than
 * folded into the default (spec-00012-FR-13): silently serving somewhere else
 * than the user asked is worse than one sentence.
 */
function resolvePort(value: string | undefined): number {
  if (value === undefined || value === '') return DEFAULT_PORT
  const port = Number(value)
  if (!/^[-+]?\d+$/.test(value) || port < 1 || port > 65535) throw new Error(`PORT must be a port number, got ${JSON.stringify(value)}`)
  return port
}

/** `persimmon new <name>` (spec-00013-FR-1): the flags, the scaffold behind them, and the registration that closes it. */
async function newProject(world: World, args: string[]): Promise<number> {
  const { values, positionals } = parse(args, NEW)
  const name = positionals[0]
  if (name === undefined) throw new UsageError(NEW_USAGE)
  const lang = text(values.lang) ?? ''
  const variant = text(values.variant) ?? ''
  if (variant !== '' && lang === '') throw new UsageError('error: --variant requires --lang (e.g. --lang java --variant ddd)')
  const sets: Record<string, string> = {}
  for (const pair of many(values.set)) sets[pair.slice(0, pair.indexOf('='))] = pair.slice(pair.indexOf('=') + 1)
  const dir = text(values.dir) ?? '.'
  try {
    // The "error: " prefix is the one the command has always printed on a
    // scaffold failure (spec-00013-FR-4).
    await create({ name, lang, variant, dir, ref: text(values.ref) ?? '', ...template(), sets })
  } catch (error) {
    return refuse(`error: ${asMessage(error)}`, 1)
  }
  // The project is the main product and the registration an attendant step: a
  // scaffold that failed registers nothing, and a registration that failed rolls
  // nothing back — its reason is reported and `persimmon add` picks the project
  // up once the cause is gone (spec-00013-FR-8, design-00004 §5). A port held by
  // somebody who is not a persimmon writes the file all the same, which is where
  // `new` parts from `add` deliberately (spec-00013-FR-7).
  const entry = await register(world, await probe(world.port), realpathOr(join(dir, name)))
  console.log(`已登记为 workspace ${entry.id}——在项目内执行 persimmon 打开`)
  return 0
}

/**
 * One directory into the registry through whoever holds the port (design-00003
 * §8): a running process registers it, so its writes stay serialised and its
 * switcher shows the entry at once; anything else writes the file directly.
 * `add` and `new` share it whole — they differ only in what they make of a
 * stranger on the port, which each of them settles before calling this
 * (spec-00013-FR-6).
 */
async function register(world: World, instance: Instance, path: string, name?: string): Promise<WorkspaceEntry> {
  return instance.kind === 'running' ? await post(world.port, path, name) : new WorkspaceRegistry(world.registryPath).add(path, name)
}

/** `persimmon update [--dir .]` (spec-00013-FR-9): the three-way merge of `src/scaffold.ts`. */
async function updateProject(args: string[]): Promise<number> {
  const { values } = parse(args, UPDATE)
  try {
    await update(text(values.dir) ?? '.')
  } catch (error) {
    return refuse(`error: ${asMessage(error)}`, 1)
  }
  return 0
}

/** One entry of the template repository's branch listing. */
interface Branch {
  name: string
}

/**
 * One page of branches and the URL of the next one, `''` on the last
 * (`5527313:cli/main.go:559`). Three failures, three sentences: the request that could
 * not be sent, the reply that was not a 200, the body that would not parse
 * (spec-00013-FR-14). Every one of them names the address it asked.
 */
async function getBranchPage(url: string): Promise<{ page: Branch[]; next: string }> {
  let reply: Response
  try {
    reply = await fetch(url)
  } catch (error) {
    // `fetch` says only "fetch failed"; what actually happened is the cause.
    const cause = error instanceof Error && error.cause !== undefined ? `: ${asMessage(error.cause)}` : ''
    throw new Error(`error: ${url}: ${asMessage(error)}${cause}`)
  }
  if (reply.status !== 200) throw new Error(`error: ${url} returned ${reply.status} ${reply.statusText}`)
  try {
    return { page: (await reply.json()) as Branch[], next: nextLink(reply.headers.get('Link') ?? '') }
  } catch (error) {
    throw new Error(`error: ${url}: ${asMessage(error)}`)
  }
}

/** The `rel="next"` URL of a `Link` header, or `''` when there is none (`5527313:cli/main.go:576`). */
function nextLink(header: string): string {
  for (const part of header.split(',')) {
    if (!part.includes('rel="next"')) continue
    const [open, close] = [part.indexOf('<'), part.indexOf('>')]
    if (open >= 0 && close > open) return part.slice(open + 1, close)
  }
  return ''
}

/**
 * `persimmon list-langs` (spec-00013-FR-13): the base template, then every
 * language with a `lang/*` branch in order, each with its variants beneath it.
 *
 * The API base is a parameter and the production value is the constant beside
 * it, which is the seam a test points at a local server (design-00004 §6). No
 * rate-limit handling of any kind: no token, no backoff, no retry, one bare
 * request per page — the 403 that GitHub's unauthenticated hourly limit answers
 * with is shown as it came (spec-00013-FR-14, spec-00013-AC-14.4).
 */
export async function listLangs(api: string): Promise<number> {
  const branches: Branch[] = []
  // The branches endpoint is paginated: `per_page` is a page size, not "all of
  // them", so follow the Link header until GitHub stops offering one (issue-00036).
  const { owner, repo } = template()
  let url = `${api}/repos/${owner}/${repo}/branches?per_page=100`
  while (url !== '') {
    const { page, next } = await getBranchPage(url)
    branches.push(...page)
    url = next
  }
  const langs = new Map<string, { base: boolean; variants: string[] }>()
  for (const { name } of branches) {
    if (!name.startsWith('lang/')) continue
    const [lang, variant] = split(name.slice('lang/'.length))
    const info = langs.get(lang) ?? { base: false, variants: [] }
    if (variant === undefined) info.base = true
    else info.variants.push(variant)
    langs.set(lang, info)
  }
  const lines = ['Available templates:', '  (default)              base template (main)']
  if (langs.size === 0) {
    lines.push('  (no lang/* branches yet — only the base template is available)')
    return print(lines.join('\n'))
  }
  for (const [lang, info] of [...langs].sort(([one], [other]) => (one < other ? -1 : 1))) {
    // A language with variants but no `lang/<l>` branch of its own is still
    // grouped, but the base line it would offer does not exist: the group header
    // says so instead of naming a `--lang` that would 404 (issue-00035).
    lines.push(info.base ? `  --lang ${lang.padEnd(15)} lang/${lang}` : `  ${lang.padEnd(22)} no lang/${lang} branch — use --variant only`)
    for (const variant of info.variants.sort()) lines.push(`    --variant ${variant.padEnd(10)} lang/${lang}/${variant}`)
  }
  return print(lines.join('\n'))
}

/** `<lang>` or `<lang>/<variant>`, split on the first slash only — a variant may hold more. */
function split(rest: string): [string, string | undefined] {
  const slash = rest.indexOf('/')
  return slash < 0 ? [rest, undefined] : [rest.slice(0, slash), rest.slice(slash + 1)]
}

function printVersion(): number {
  return print(`persimmon ${version()}`)
}

/** The one normal exit that writes usage: `help` and its two spellings go to stdout, error paths to stderr (design-00004 §2). */
function print(what: string): number {
  console.log(what)
  return 0
}

/** A first argument that is no subcommand: named, then the usage, then exit 1 — not the 2 a usage error takes (`5527313:cli/main.go:168-171`). */
function unknown(command: string): number {
  console.error(`unknown command ${JSON.stringify(command)}\n`)
  console.error(USAGE)
  return 1
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
  const { values, positionals } = parse(args, ADD)
  const [path] = positionals
  const name = text(values.name)
  const target = path === undefined ? findRepoRoot(process.cwd()) : resolve(path)
  const instance = await probe(world.port)
  if (instance.kind === 'occupied') throw new Error(occupied(world.port))
  console.log(JSON.stringify(await register(world, instance, target, name)))
  return 0
}

/** `persimmon remove <id|path>` (spec-00011-FR-4): the path form is resolved and looked up as an id, so the rest is one code path. */
async function remove(world: World, args: string[]): Promise<number> {
  const [idOrPath] = parse(args, REMOVE).positionals
  if (idOrPath === undefined) throw new UsageError(REGISTRY_USAGE)
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
async function list(world: World, args: string[]): Promise<number> {
  parse(args, LIST)
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

const occupied = (port: number): string => `port ${port} is already in use`

/**
 * What the command refuses, in the words of whoever refused it: 2 for a usage or
 * parsing error (spec-00012-FR-12), 1 for what a subcommand reported itself.
 * Neither wears the `persimmon: ` prefix — that one belongs to {@link fail}.
 */
function refuse(message: string, code = 2): number {
  console.error(message)
  return code
}

/** One sentence on stderr and a non-zero exit code to return, never a stack. */
function fail(message: string): number {
  console.error(`persimmon: ${message}`)
  return 1
}
