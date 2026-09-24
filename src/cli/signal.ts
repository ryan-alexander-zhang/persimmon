import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { localActor } from '../engine.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { find } from './get.js'
import { loadDocs, parseRef } from './io.js'

/** `persimmon signal <kind>/<name> --payload <file> [--event-id <id>]`. */
export async function signal(cli: Cli, ref: string, o: { payload?: string; eventId?: string; namespace?: string }): Promise<number> {
  return withEngine(cli, async (engine) => {
    const { kind, name } = parseRef(ref)
    const r = name && find(engine, kind, name, o)
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
    const r = find(engine, 'TaskRun', taskRun, { ...(namespace ? { namespace } : {}) })
    if (!r) {
      cli.err(`TaskRun/${taskRun} not found`)
      return 1
    }
    engine.signal(r.metadata.uid as string, `complete-${randomBytes(6).toString('hex')}`, localActor, completion, 'api')
    rmSync(join(cli.cwd, '.persimmon', 'inbox', `${r.metadata.name}.yaml`), { force: true }) // the cli-human form is answered
    cli.out(`completed TaskRun/${taskRun}`)
    return 0
  })
}
