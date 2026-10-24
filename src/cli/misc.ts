import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'
import type { AdapterSpec } from '../adapter/types.js'
import { conformance } from '../conformance/suite.js'
import { audit } from '../handler/write.js'
import { ajv, formatErrors } from '../resource/ajv.js'
import { localActor } from '../engine.js'
import { owns } from '../reconcile/dispatch.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { parkedOn } from './create.js'
import { find, type Where } from './get.js'
import { parseRef } from './io.js'

/** `persimmon resume [--follow]`: redeliver unacked Events and outstanding calls, drain the Outbox. start() marks open calls unknown.
 * `--follow` keeps draining until the open runs end or park: no timer pending, or every live TaskRun waits on a human (then the `complete` command of each, as `run --follow` prints it). */
export async function resume(cli: Cli, o: { follow?: boolean } = {}): Promise<number> {
  return withEngine(cli, async (engine) => {
    cli.out(`open events: ${engine.store.runLog.listOpen().length}`)
    if (!o.follow) return 0
    for (;;) {
      await engine.drain()
      const parked = parkedOn(engine.store.resources.list('TaskRun')) // a parked run still holds its deadline timer; waiting for it is not draining
      if (parked.length) {
        for (const p of parked) cli.out(`parked on you: persimmon complete ${p.metadata.name}`)
        return 0
      }
      const next = engine.store.timers.due('9999-12-31T23:59:59Z').find((t) => owns(engine.dispatch, t.uid))
      if (!next) return 0
      await new Promise((r) => setTimeout(r, Math.max(0, Date.parse(next.at) - Date.now())))
    }
  })
}

/** `persimmon cancel <kind>/<name>`: CancelRequested as the local Actor; the drain on exit delivers it, children and calls included. */
export async function cancel(cli: Cli, ref: string, o: Where = {}): Promise<number> {
  return withEngine(cli, async (engine) => {
    const { kind, name } = parseRef(ref)
    const r = name && find(engine, kind, name, o)
    if (!r) {
      cli.err(`${ref} not found`)
      return 1
    }
    engine.cancel(r.metadata.uid as string, 'cancelled at the terminal')
    cli.out(`cancelled ${ref}`)
    return 0
  })
}

/** `persimmon delete <kind>/<name>`: refused while referenced (00-resource.md). */
export async function del(cli: Cli, ref: string, o: Where = {}): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      const { kind, name } = parseRef(ref)
      const r = name && find(engine, kind, name, o)
      if (!r) {
        cli.err(`${ref} not found`)
        return 1
      }
      try {
        engine.store.transaction(() => {
          engine.store.resources.delete(r.metadata.uid as string)
          engine.store.audit.append(audit(r, localActor, engine.dispatch.now().toISOString(), 'delete'))
        })
      } catch (e) {
        cli.err(`error ${ref}: ${(e as Error).message}`)
        return 1
      }
      cli.out(`deleted ${ref}`)
      return 0
    },
    { listen: false },
  )
}

/** `persimmon adapter list`. */
export async function adapterList(cli: Cli): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      for (const a of engine.store.resources.list('Adapter')) {
        const s = a.status as { conditions?: { type: string; status: string; reason?: string }[]; describe?: { roles?: string[] } } | undefined
        const ready = s?.conditions?.find((c) => c.type === 'Ready')
        cli.out(`${(a.spec as { id: string }).id}  ${ready?.status === 'True' ? 'Ready' : `NotReady${ready?.reason ? ` (${ready.reason})` : ''}`}  roles: ${(s?.describe?.roles ?? (a.spec as { roles: string[] }).roles).join(',')}`)
      }
      return 0
    },
    { listen: false },
  )
}

/** `persimmon adapter test <id> [--config <file>] [--live]`: the conformance suite (22-conformance.md), one line per rule, exit 1 on a FAIL. */
export async function adapterTest(cli: Cli, id: string, o: { config?: string; live?: boolean } = {}): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      const a = engine.store.resources.list('Adapter').find((r) => (r.spec as unknown as AdapterSpec).id === id)
      if (!a) {
        cli.err(`adapter ${id} not installed`)
        return 1
      }
      let configuration: Record<string, unknown> | undefined
      if (o.config) {
        configuration = parse(readFileSync(resolve(cli.cwd, o.config), 'utf8')) as Record<string, unknown>
        const schema = (a.status as { describe?: { configurationSchema?: Record<string, unknown> } } | undefined)?.describe?.configurationSchema
        const valid = schema ? ajv.compile(schema) : undefined
        if (valid && !valid(configuration)) {
          cli.err(`${o.config}: ${formatErrors(valid.errors)}`)
          return 1
        }
      }
      const verdicts = await conformance(a.spec as unknown as AdapterSpec, { ...(configuration ? { configuration } : {}), credentials: engine.credentials, ...(o.live ? { live: true } : {}) })
      for (const v of verdicts) cli.out(`${v.id.padEnd(3)} ${v.status.padEnd(4)}  ${v.rule}${v.reason ? `: ${v.reason}` : ''}`)
      return verdicts.some((v) => v.status === 'FAIL') ? 1 : 0
    },
    { listen: false },
  )
}
