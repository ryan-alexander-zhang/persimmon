import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { localActor } from '../engine.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { find } from './get.js'
import { loadDocs, parseRef, toYaml } from './io.js'
import { parse } from 'yaml'
import { ajv, formatErrors } from '../resource/ajv.js'
import type { OutputSpec } from '../kinds/ports/types.js'

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

/** `persimmon complete <taskRun> [--file <result.yaml>]`: the local human finishes a cli-human/v1 attempt (20-pack.md); no file → the inbox form is asked at the terminal. */
export async function complete(cli: Cli, taskRun: string, file: string | undefined, namespace?: string): Promise<number> {
  return withEngine(cli, async (engine) => {
    const r = find(engine, 'TaskRun', taskRun, { ...(namespace ? { namespace } : {}) })
    if (!r) {
      cli.err(`TaskRun/${taskRun} not found`)
      return 1
    }
    const form = join(cli.cwd, '.persimmon', 'inbox', `${r.metadata.name}.yaml`)
    let completion: Record<string, unknown>
    if (file) {
      const body = loadDocs([file])[0] as Record<string, unknown>
      completion = 'taskResult' in body ? body : { taskResult: body, publish: [] }
    } else {
      if (!cli.ask) throw new Error('complete: --file required without a terminal')
      if (!existsSync(form)) throw new Error(`complete: no inbox form at ${form}; pass --file`)
      completion = await askForm(cli, parse(readFileSync(form, 'utf8')) as Form, r.metadata.name)
    }
    engine.signal(r.metadata.uid as string, `complete-${randomBytes(6).toString('hex')}`, localActor, completion, 'api')
    rmSync(form, { force: true }) // the cli-human form is answered
    cli.out(`completed TaskRun/${taskRun}`)
    return 0
  })
}

interface Form {
  instructions: string
  inputs?: Record<string, unknown>
  outputs: Record<string, OutputSpec>
}

/** One question per output port: value ports take YAML validated against the port schema, artifact ports take the content to publish. */
async function askForm(cli: Cli, form: Form, taskRun: string): Promise<Record<string, unknown>> {
  cli.out(`\n${form.instructions}\n`)
  if (form.inputs) cli.out(toYaml({ inputs: form.inputs }))
  const outputs: Record<string, unknown> = {}
  const publish: { port: string; request: Record<string, unknown> }[] = []
  for (const [port, spec] of Object.entries(form.outputs)) {
    const schema = spec.type.kind === 'value' ? (spec.type.schema as Record<string, unknown> | undefined) : undefined
    const hint = schema ? toYaml({ schema }).trimEnd() : spec.type.kind === 'artifact' ? `content of a ${spec.type.artifactKind.kind}` : ''
    for (;;) {
      const text = await cli.ask!(`\n${port} (${spec.type.kind}) as YAML${hint ? `:\n${hint}` : ''}\nEnd with a line holding only "."\n> `)
      let value: unknown
      try {
        value = parse(text)
      } catch (e) {
        cli.err(`not YAML: ${(e as Error).message}`)
        continue
      }
      if (schema && !ajv.compile(schema)(value)) {
        cli.err(`${port}: ${formatErrors(ajv.compile(schema).errors)}`)
        continue
      }
      if (spec.type.kind === 'artifact') publish.push({ port, request: { kind: spec.type.artifactKind, id: `${taskRun}-${port}`, content: value, representations: [] } })
      else outputs[port] = { kind: 'value', value }
      break
    }
  }
  return { taskResult: { protocol: 'persimmon.result/v1', outputs }, publish }
}

