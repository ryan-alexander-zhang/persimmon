import { createHash, randomBytes } from 'node:crypto'
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
    const status = (r.status ?? {}) as { phase?: string; waitingReason?: string }
    if (status.phase !== 'Waiting' || status.waitingReason !== 'human') {
      cli.err(`TaskRun/${taskRun} is ${status.phase ?? 'Pending'}${status.waitingReason ? ` (${status.waitingReason})` : ''}, not waiting for a human`)
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
  review?: { kind: string; name?: string; id?: string; revision?: number; content?: unknown; error?: string }[]
  inputs?: Record<string, unknown>
  outputs: Record<string, OutputSpec>
  outputSchemas?: Record<string, Record<string, unknown>>
}

/** `<taskRun>-<port>` as a DNS label (revisioned.yaml Id); the same rule the agent runner applies. */
const dnsLabel = (s: string) => {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length <= 63 ? slug : `${slug.slice(0, 50)}-${createHash('sha256').update(slug).digest('hex').slice(0, 12)}`
}

const isValidationResult = (schema: Record<string, unknown> | undefined) => {
  const req = schema?.required
  return Array.isArray(req) && ['passed', 'findings', 'evidence'].every((k) => req.includes(k))
}

/** Interactive form: what the reviewer reads first, then one plain question per output port. */
async function askForm(cli: Cli, form: Form, taskRun: string): Promise<Record<string, unknown>> {
  cli.out('')
  cli.out(form.instructions)
  for (const r of form.review ?? []) {
    cli.out('')
    cli.out(`── ${r.kind}${r.id ? ` ${r.id} r${r.revision}` : r.name ? ` ${r.name}` : ''} ──`)
    cli.out(r.error ? `(unavailable: ${r.error})` : typeof r.content === 'string' ? r.content.trimEnd() : toYaml(r.content).trimEnd())
  }
  const evidence = Object.values(form.inputs ?? {}).filter((v): v is { kind: 'artifact'; ref: unknown } => (v as { kind?: string }).kind === 'artifact').map((v) => v.ref)
  const outputs: Record<string, unknown> = {}
  const publish: { port: string; request: Record<string, unknown> }[] = []
  for (const [port, spec] of Object.entries(form.outputs)) {
    if (spec.type.kind === 'externalResource') throw new Error(`complete: output ${port} is an externalResource port; answer it with --file`)
    const schema = spec.type.kind === 'value' ? (spec.type.schema as Record<string, unknown> | undefined) : form.outputSchemas?.[port]
    let value: unknown
    if (spec.type.kind === 'value' && isValidationResult(schema)) value = await askVerdict(cli, port, evidence)
    else value = await askYaml(cli, port, spec.type.kind === 'artifact' ? `content of a ${spec.type.artifactKind.kind}` : port, schema)
    if (spec.type.kind === 'artifact') publish.push({ port, request: { kind: spec.type.artifactKind, id: dnsLabel(`${taskRun}-${port}`), content: value, representations: [] } })
    else outputs[port] = { kind: 'value', value }
  }
  return { taskResult: { protocol: 'persimmon.result/v1', outputs }, publish }
}

const eof = () => new Error('complete: input closed before every output was answered; the form is kept')

/** ValidationResult in two questions: approve or not, then blocking findings one per line. Evidence is the reviewed artifacts. */
async function askVerdict(cli: Cli, port: string, evidence: unknown[]): Promise<unknown> {
  let passed: boolean | undefined
  while (passed === undefined) {
    const a = await cli.ask!(`\n${port}: approve? [y/n] `)
    if (a === null) throw eof()
    const t = a.trim().toLowerCase()
    if (t === 'y' || t === 'yes') passed = true
    else if (t === 'n' || t === 'no') passed = false
    else cli.err('answer y or n')
  }
  const text = await cli.ask!(`${passed ? 'Notes' : 'Blocking findings'}, one per line; a lone "." ends the list:\n`)
  if (text === null) throw eof()
  const findings = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((message, i) => ({ severity: passed ? 'info' : 'error', code: passed ? `note_${i + 1}` : `blocking_${i + 1}`, message }))
  return { passed, findings, evidence }
}

/** Any other shape: a template filled from the schema, edited as YAML, validated, asked again on a miss. */
async function askYaml(cli: Cli, port: string, what: string, schema: Record<string, unknown> | undefined): Promise<unknown> {
  const template = schema ? toYaml(example(schema)).trimEnd() : ''
  for (;;) {
    const text = await cli.ask!(`\n${what} as YAML${template ? `; template:\n${template}` : ''}\nType the value, then a lone ".":\n`)
    if (text === null) throw eof()
    let value: unknown
    try {
      value = parse(text)
    } catch (e) {
      cli.err(`not YAML: ${(e as Error).message}`)
      continue
    }
    if (schema) {
      const check = ajv.compile(schema)
      if (!check(value)) {
        cli.err(`${port}: ${formatErrors(check.errors)}`)
        continue
      }
    }
    return value
  }
}

/** A value that fits the schema's shape: required properties, first enum member, zero, empty. Never the schema itself. */
export function example(schema: Record<string, unknown>): unknown {
  if ('const' in schema) return schema.const
  if (Array.isArray(schema.enum)) return schema.enum[0]
  if ('default' in schema) return schema.default
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  switch (type) {
    case 'object': {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
      const keys = Array.isArray(schema.required) ? (schema.required as string[]) : Object.keys(props)
      return Object.fromEntries(keys.map((k) => [k, props[k] ? example(props[k]!) : null]))
    }
    case 'array':
      return schema.items && typeof schema.items === 'object' && (schema as { minItems?: number }).minItems ? [example(schema.items as Record<string, unknown>)] : []
    case 'string':
      return ''
    case 'integer':
    case 'number':
      return 0
    case 'boolean':
      return false
    default:
      return null
  }
}
