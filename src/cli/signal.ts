import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { localActor } from '../engine.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { find } from './get.js'
import { renderTree } from './tree.js'
import { loadDocs, parseRef, toYaml } from './io.js'
import { parse } from 'yaml'
import { ajv, formatErrors } from '../resource/ajv.js'
import type { OutputSpec } from '../kinds/ports/types.js'
import type { Resource, RevisionRef } from '../resource/types.js'

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
      completion = 'taskResult' in body ? body : fromFile(body, existsSync(form) ? (parse(readFileSync(form, 'utf8')) as Form) : undefined, r.metadata.name, form)
    } else {
      if (!cli.ask) throw new Error('complete: --file required without a terminal')
      if (!existsSync(form)) throw new Error(`complete: no inbox form at ${form}; pass --file`)
      completion = await askForm(cli, parse(readFileSync(form, 'utf8')) as Form, r.metadata.name)
    }
    engine.signal(r.metadata.uid as string, `complete-${randomBytes(6).toString('hex')}`, localActor, completion, 'api')
    rmSync(form, { force: true }) // the cli-human form is answered
    cli.out(`completed TaskRun/${taskRun}`)
    await engine.drain() // the run continues here, agents included; then the tree shows where it got
    let root: Resource = engine.store.resources.getByUid(r.metadata.uid as string) ?? r
    for (let o = root.metadata.ownerReferences?.[0]; o?.uid; o = root.metadata.ownerReferences?.[0]) {
      const owner = engine.store.resources.getByUid(o.uid)
      if (!owner) break
      root = owner
    }
    cli.out('')
    for (const line of renderTree(engine, root)) cli.out(line)
    return 0
  })
}

export interface Form {
  instructions: string
  reading?: { kind: string; name?: string; ref?: RevisionRef; content?: unknown; error?: string }[]
  inputs?: Record<string, unknown>
  outputs: Record<string, OutputSpec>
  outputSchemas?: Record<string, Record<string, unknown>>
  outputIds?: Record<string, string>
}

/** `<taskRun>-<port>` as a DNS label (revisioned.yaml Id); the same rule the agent runner applies. */
const dnsLabel = (s: string) => {
  const slug = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug.length <= 63 ? slug : `${slug.slice(0, 50)}-${createHash('sha256').update(slug).digest('hex').slice(0, 12)}`
}

/** A request publishing `content` on an artifact port, under the id the Task chose (12-task.md), else `<taskRun>-<port>`. */
const publishRequest = (form: Form, port: string, content: unknown, taskRun: string) => {
  const spec = form.outputs[port]!.type as { kind: 'artifact'; artifactKind: unknown }
  return { port, request: { kind: spec.artifactKind, id: form.outputIds?.[port] ?? dnsLabel(`${taskRun}-${port}`), content, representations: [] } }
}

const runtimeKinds = ['value', 'artifact', 'artifacts', 'externalResource']
const isRuntimeValue = (v: unknown) => !!v && typeof v === 'object' && runtimeKinds.includes((v as { kind?: string }).kind ?? '')

/** Throws `<port>: <errors>` when `value` misses `schema`; nothing is signalled then and the form is kept. */
const checkAnswer = (port: string, schema: Record<string, unknown> | undefined, value: unknown) => {
  if (!schema) return
  const check = ajv.compile(schema)
  if (!check(value)) throw new Error(`complete: ${port}: ${formatErrors(check.errors)}`)
}

/** `--file` with `{outputs}`: an artifact port's value is its content, published like an interactive answer and checked as one before
 * anything is signalled; a value port is `{kind: value, value}` (35-build-process.md). Without the inbox form only RuntimeValues pass. */
export function fromFile(body: Record<string, unknown>, form: Form | undefined, taskRun: string, formPath = 'the inbox'): { taskResult: Record<string, unknown>; publish: { port: string; request: Record<string, unknown> }[] } {
  const outputs = { ...((body.outputs ?? {}) as Record<string, unknown>) }
  const publish: { port: string; request: Record<string, unknown> }[] = []
  for (const [port, value] of Object.entries(outputs)) {
    const spec = form?.outputs[port]
    if (!form) {
      if (!isRuntimeValue(value)) throw new Error(`complete: no inbox form at ${formPath}; write ${port} as {kind: value, value: ...}, or pass the {taskResult, publish} envelope`)
      continue
    }
    if (!spec) throw new Error(`complete: ${port} is no output of this Task`)
    if (spec.type.kind === 'artifact') {
      if (form.outputIds === undefined) throw new Error('complete: the form predates chosen artifact ids (12-task.md); cancel the run and start it again')
      if ((value as { kind?: string } | null)?.kind === 'artifact' && 'ref' in (value as object)) throw new Error(`complete: ${port} is an artifact port: write the content of the artifact, not a ref`)
      checkAnswer(port, form.outputSchemas?.[port], value)
      publish.push(publishRequest(form, port, value, taskRun))
      delete outputs[port]
    } else if (spec.type.kind === 'value') {
      if ((value as { kind?: string } | null)?.kind !== 'value' || !('value' in (value as object))) throw new Error(`complete: ${port} is a value port: write {kind: value, value: ...}`)
      checkAnswer(port, spec.type.schema as Record<string, unknown> | undefined, (value as { value: unknown }).value)
    }
  }
  return { taskResult: { ...body, protocol: body.protocol ?? 'persimmon.result/v1', outputs }, publish }
}

const isValidationResult = (schema: Record<string, unknown> | undefined) => {
  const req = schema?.required
  return Array.isArray(req) && ['passed', 'findings', 'evidence'].every((k) => req.includes(k))
}

/** Interactive form: what the human reads first, then one plain question per output port. */
export async function askForm(cli: Cli, form: Form, taskRun: string): Promise<Record<string, unknown>> {
  cli.out('')
  cli.out(form.instructions)
  const reading = form.reading ?? []
  for (const r of reading) {
    cli.out('')
    cli.out(`── ${r.kind}${r.ref ? ` ${r.ref.id} r${r.ref.revision}` : r.name ? ` ${r.name}` : ''} ──`)
    cli.out(r.error ? `(unavailable: ${r.error})` : typeof r.content === 'string' ? r.content.trimEnd() : toYaml(r.content).trimEnd())
  }
  if (reading.length === 0 && form.inputs) cli.out(toYaml({ inputs: form.inputs }).trimEnd()) // an older or foreign form: at least the references
  const evidence = form.reading
    ? reading.filter((r) => r.ref && !r.error).map((r) => r.ref) // only what was actually shown
    : Object.values(form.inputs ?? {}).flatMap((v) => ((v as { kind?: string }).kind === 'artifact' ? [(v as { ref: RevisionRef }).ref] : (v as { kind?: string }).kind === 'artifacts' ? (v as { refs: RevisionRef[] }).refs : []))
  if (form.outputIds === undefined && Object.values(form.outputs).some((o) => o.type.kind === 'artifact')) throw new Error('complete: the form predates chosen artifact ids (12-task.md); cancel the run and start it again')
  const outputs: Record<string, unknown> = {}
  const publish: { port: string; request: Record<string, unknown> }[] = []
  for (const [port, spec] of Object.entries(form.outputs)) {
    if (spec.type.kind === 'externalResource' || spec.type.kind === 'artifacts') throw new Error(`complete: output ${port} is an ${spec.type.kind} port; answer it with --file`)
    const schema = spec.type.kind === 'value' ? (spec.type.schema as Record<string, unknown> | undefined) : form.outputSchemas?.[port]
    const what = spec.type.kind === 'artifact' ? `content of a ${spec.type.artifactKind.kind}` : port
    let value: unknown
    if (spec.type.kind === 'value' && isValidationResult(schema)) {
      value = await askVerdict(cli, port, evidence)
      if (!ajv.compile(schema!)(value)) {
        cli.err(`${port}: this port needs more than approve and findings; edit the value below`)
        value = await askYaml(cli, port, what, schema, value) // the heuristic was wrong for this schema: edit the typed answer, never signal a bad value
      }
    } else value = await askYaml(cli, port, what, schema)
    if (spec.type.kind === 'artifact') publish.push(publishRequest(form, port, value, taskRun))
    else outputs[port] = { kind: 'value', value }
  }
  return { taskResult: { protocol: 'persimmon.result/v1', outputs }, publish }
}

const eof = () => new Error('complete: input closed before every output was answered; the form is kept')

/** ValidationResult in two questions: approve or not, then blocking findings one per line. Evidence is the reviewed artifacts. */
async function askVerdict(cli: Cli, port: string, evidence: unknown[]): Promise<unknown> {
  let passed: boolean | undefined
  while (passed === undefined) {
    const a = await cli.ask!(`\n${port}: approve? [y/n] `, 'line')
    if (a === null) throw eof()
    const t = a.trim().toLowerCase()
    if (t === 'y' || t === 'yes') passed = true
    else if (t === 'n' || t === 'no') passed = false
    else cli.err('answer y or n')
  }
  const text = await cli.ask!(`\n${passed ? 'Notes' : 'Blocking findings'}, one per line (empty is fine); a lone "." ends the list:\n`, 'block')
  if (text === null) throw eof()
  const findings = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((message, i) => ({ severity: passed ? 'info' : 'error', code: passed ? `note_${i + 1}` : `blocking_${i + 1}`, message }))
  return { passed, findings, evidence }
}

/** Any other shape: an example shaped by the schema, edited as YAML, validated, asked again on a miss. */
async function askYaml(cli: Cli, port: string, what: string, schema: Record<string, unknown> | undefined, seed?: unknown): Promise<unknown> {
  const sample = seed !== undefined ? toYaml(seed).trimEnd() : schema ? toYaml(example(schema)).trimEnd() : ''
  for (;;) {
    const text = await cli.ask!(`\n${what} as YAML${sample ? `, for example:\n${sample}` : ''}\nType the value, then a lone ".":\n`, 'block')
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

/** A value that fits the schema's shape: required properties, one array item, first enum member or branch, zero, empty. Never the schema itself. */
export function example(schema: Record<string, unknown>, root: Record<string, unknown> = schema, depth = 0): unknown {
  if (depth > 8) return null
  const next = (s: Record<string, unknown>) => example(s, root, depth + 1)
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/')) {
    const target = schema.$ref.slice(2).split('/').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined), root)
    return target && typeof target === 'object' ? next(target as Record<string, unknown>) : null
  }
  if (Array.isArray(schema.allOf)) {
    // an intersection: one object with every branch's properties and required
    const merged = (schema.allOf as Record<string, unknown>[]).reduce<Record<string, unknown>>((acc, b) => ({ ...acc, ...b, properties: { ...(acc.properties as object), ...(b.properties as object) }, required: [...((acc.required as string[]) ?? []), ...((b.required as string[]) ?? [])] }), { ...schema, allOf: undefined })
    delete merged.allOf
    return next(merged)
  }
  for (const k of ['anyOf', 'oneOf']) {
    const branches = schema[k]
    if (Array.isArray(branches) && branches[0] && typeof branches[0] === 'object') return next(branches[0] as Record<string, unknown>)
  }
  if ('const' in schema) return schema.const
  if (Array.isArray(schema.enum)) return schema.enum[0]
  if ('default' in schema) return schema.default
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type
  switch (type) {
    case 'object': {
      const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
      const keys = Array.isArray(schema.required) ? (schema.required as string[]) : Object.keys(props)
      return Object.fromEntries(keys.map((k) => [k, props[k] ? next(props[k]!) : null]))
    }
    case 'array': {
      if (!schema.items || typeof schema.items !== 'object' || Array.isArray(schema.items)) return []
      const n = Math.max(1, Math.min(3, Number((schema as { minItems?: number }).minItems ?? 1)))
      return Array.from({ length: n }, () => next(schema.items as Record<string, unknown>))
    }
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
