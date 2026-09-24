import { randomBytes } from 'node:crypto'
import { localActor } from '../engine.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { nsOf } from './get.js'
import { loadDocs, parseRef } from './io.js'

/** `persimmon signal <kind>/<name> --payload <file> [--event-id <id>]`. */
export async function signal(cli: Cli, ref: string, o: { payload?: string; eventId?: string; namespace?: string }): Promise<number> {
  return withEngine(cli, async (engine) => {
    const { kind, name } = parseRef(ref)
    const r = name && engine.store.resources.get({ kind, namespace: nsOf(engine, kind, o.namespace), name })
    if (!r) {
      cli.err(`${ref} not found`)
      return 1
    }
    const payload = o.payload ? (loadDocs([o.payload])[0] as Record<string, unknown>) : undefined
    const eventId = o.eventId ?? `api-${randomBytes(6).toString('hex')}`
    engine.signal(r.metadata.uid as string, eventId, localActor, payload, 'api')
    cli.out(`signalled ${ref} ${eventId}`)
    return 0
  })
}

/** `persimmon complete <taskRun> --file <result.yaml>`: the local human finishes a cli-human/v1 attempt (20-pack.md). */
export async function complete(cli: Cli, taskRun: string, file: string, namespace?: string): Promise<number> {
  const body = loadDocs([file])[0] as Record<string, unknown>
  const completion = 'taskResult' in body ? body : { taskResult: body, publish: [] }
  return withEngine(cli, async (engine) => {
    const r = engine.store.resources.get({ kind: 'TaskRun', namespace: nsOf(engine, 'TaskRun', namespace), name: taskRun })
    if (!r) {
      cli.err(`TaskRun/${taskRun} not found`)
      return 1
    }
    engine.signal(r.metadata.uid as string, `complete-${randomBytes(6).toString('hex')}`, localActor, completion, 'api')
    cli.out(`completed TaskRun/${taskRun}`)
    return 0
  })
}
