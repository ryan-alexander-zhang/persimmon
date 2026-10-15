// persimmon CLI (08-store.md verbs). Local mode: every verb drains before exit.
import { parseArgs } from 'node:util'
import { apply } from './apply.js'
import type { Cli } from './context.js'
import { create, run } from './create.js'
import { digest } from './digest.js'
import { skillInstall } from './skill.js'
import { get, logs } from './get.js'
import { tree } from './tree.js'
import { init } from './init.js'
import { adapterList, adapterTest, del, resume } from './misc.js'
import { complete, signal } from './signal.js'
import { ui } from './ui.js'
import { validate } from './validate.js'

const usage = `usage: persimmon <verb> [args]
  validate <files>                         schema plus static rules
  apply <files> [-n ns | --global] [--skip-adapter-validation]
  create <file> [-n ns] [--follow]
  run <Workflow> [--input <port>=<yaml | @file>]... [--timeout <d>] [-n ns] [--follow]
  signal <kind>/<name> --payload <file> [--event-id <id>]
  complete <taskRun> [--file <result.yaml>]         no file: answer the inbox form at the terminal
  resume
  get <kind>[/<name>] [-n ns | --global] [--behind]  --behind: the latest revisions whose pinned inputs have a newer one
  describe <kind>/<name> [-n ns]
  logs <kind>/<name> [-n ns | --global]
  tree <kind>/<name> [-n ns]                        a run, what it produced, and every run it owns, nested
  skill install <name> --into <dir> [--for claude|codex] [--force] [-n ns | --global]   copy a verified Skill where the agent CLIs find it
  digest <dir>                                      the bundle digest a Skill declares for that directory
  init
  ui [--port <n>]                                   the local API and the built tools on 127.0.0.1 (default port 4747)
  delete <kind>/<name> [-n ns | --global]
  adapter install <manifest> | adapter list | adapter test <id> [--config <file>] [--live]   conformance suite, one line per rule`

export async function runCli(argv: string[], cli: Cli): Promise<number> {
  let parsed: ReturnType<typeof parseCliArgs>
  try {
    parsed = parseCliArgs(argv)
  } catch (e) {
    cli.err(`error: ${(e as Error).message}`)
    cli.out(usage)
    return 2
  }
  const { values, positionals } = parsed
  const [verb, ...rest] = positionals
  if (!verb || values.help) {
    cli.out(usage)
    return verb ? 0 : 2
  }
  if (values.server) {
    cli.err('--server: server mode is not built yet')
    return 2
  }
  return await dispatchVerb(cli, verb, rest, values)
}

function parseCliArgs(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      namespace: { type: 'string', short: 'n' },
      follow: { type: 'boolean' },
      input: { type: 'string', multiple: true },
      timeout: { type: 'string' },
      global: { type: 'boolean' },
      'skip-adapter-validation': { type: 'boolean' },
      config: { type: 'string' },
      live: { type: 'boolean' },
      port: { type: 'string' },
      payload: { type: 'string' },
      'event-id': { type: 'string' },
      file: { type: 'string' },
      into: { type: 'string' },
      for: { type: 'string' },
      force: { type: 'boolean' },
      behind: { type: 'boolean' },
      server: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
}

async function dispatchVerb(cli: Cli, verb: string, rest: string[], values: ReturnType<typeof parseCliArgs>['values']): Promise<number> {
  const where = { ...(values.namespace ? { namespace: values.namespace } : {}), ...(values.global ? { global: true } : {}) }
  const need = (n: number, what: string) => {
    if (rest.length < n) throw new Error(`${verb}: ${what} required`)
  }
  try {
    switch (verb) {
      case 'validate':
        need(1, 'files')
        return await validate(cli, rest)
      case 'apply':
        need(1, 'files')
        return await apply(cli, rest, { ...(values.namespace ? { namespace: values.namespace } : {}), ...(values.global ? { global: true } : {}), ...(values['skip-adapter-validation'] ? { skipAdapterValidation: true } : {}) })
      case 'create':
        need(1, 'file')
        return await create(cli, rest[0]!, { ...(values.follow ? { follow: true } : {}), ...(values.namespace ? { namespace: values.namespace } : {}) })
      case 'run':
        need(1, '<Workflow>')
        return await run(cli, rest[0]!, { ...(values.follow ? { follow: true } : {}), ...(values.namespace ? { namespace: values.namespace } : {}), ...(values.input ? { inputs: values.input } : {}), ...(values.timeout ? { timeout: values.timeout } : {}) })
      case 'signal':
        need(1, '<kind>/<name>')
        return await signal(cli, rest[0]!, { ...(values.payload ? { payload: values.payload } : {}), ...(values['event-id'] ? { eventId: values['event-id'] } : {}), ...(values.namespace ? { namespace: values.namespace } : {}) })
      case 'complete':
        need(1, '<taskRun>')
        return await complete(cli, rest[0]!, values.file, values.namespace)
      case 'resume':
        return await resume(cli)
      case 'get':
      case 'describe':
        need(1, '<kind>[/<name>]')
        return await get(cli, rest[0]!, { ...where, ...(values.behind ? { behind: true } : {}) })
      case 'logs':
        need(1, '<kind>/<name>')
        return await logs(cli, rest[0]!, where)
      case 'tree':
        need(1, '<kind>/<name>')
        return await tree(cli, rest[0]!, where)
      case 'digest':
        need(1, '<dir>')
        return await digest(cli, rest[0]!)
      case 'skill':
        if (rest[0] === 'install' && rest[1]) return await skillInstall(cli, rest[1], { ...where, ...(values.into ? { into: values.into } : {}), ...(values.for ? { for: values.for } : {}), ...(values.force ? { force: true } : {}) })
        throw new Error('skill: install <name> --into <dir> [--for claude|codex]')
      case 'init':
        return await init(cli)
      case 'ui':
        return await ui(cli, values.port ? { port: Number(values.port) } : {})
      case 'delete':
        need(1, '<kind>/<name>')
        return await del(cli, rest[0]!, where)
      case 'adapter':
        if (rest[0] === 'list') return await adapterList(cli)
        if (rest[0] === 'install' && rest[1]) return await apply(cli, [rest[1]])
        if (rest[0] === 'test' && rest[1]) return await adapterTest(cli, rest[1], { ...(values.config ? { config: values.config } : {}), ...(values.live ? { live: true } : {}) })
        throw new Error('adapter: install <manifest> | list | test <id>')
      default:
        cli.err(`unknown verb ${verb}\n${usage}`)
        return 2
    }
  } catch (e) {
    cli.err(`error: ${(e as Error).message}`)
    return 1
  }
}
