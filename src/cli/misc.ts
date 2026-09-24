import { audit } from '../handler/write.js'
import { localActor } from '../engine.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { find } from './get.js'
import { parseRef } from './io.js'

/** `persimmon resume`: redeliver unacked Events and outstanding calls, drain the Outbox. start() marks open calls unknown. */
export async function resume(cli: Cli): Promise<number> {
  return withEngine(cli, async (engine) => {
    cli.out(`open events: ${engine.store.runLog.listOpen().length}`)
    return 0
  })
}

/** `persimmon delete <kind>/<name>`: refused while referenced (00-resource.md). */
export async function del(cli: Cli, ref: string, namespace?: string): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      const { kind, name } = parseRef(ref)
      const r = name && find(engine, kind, name, namespace)
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
