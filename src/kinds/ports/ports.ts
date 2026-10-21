import { isDeepStrictEqual } from 'node:util'
import { Site } from '../../expression/site.js'
import type { Finding } from '../../handler/types.js'
import type { JsonSchema } from '../../kind-definition/types.js'
import type { Resource, RevisionRef } from '../../resource/types.js'
import type { ValidateFunction } from 'ajv/dist/2020.js'
import { ajv } from '../../resource/ajv.js'
import { celTypeOf } from '../../expression/schema-type.js'
import type { Binding, Bindings, InputSpec, OutputSpec, PortType, RuntimeValue, RuntimeValues } from './types.js'

export class PortError extends Error {}

const wellKnown = /^persimmon\.ai\/v1#\/(Finding|ValidationResult|GateResult|RevisionRef|ExternalResourceRef)$/

/** `persimmon.ai/v1#/<Name>` → the design schema pointer it resolves to inside the engine. */
export function wellKnownPointer(ref: string): string {
  const m = wellKnown.exec(ref)
  if (!m) throw new PortError(`unknown $ref ${ref}`)
  const file = m[1] === 'RevisionRef' || m[1] === 'ExternalResourceRef' ? 'resource.yaml' : 'ports.yaml'
  return `${file}#/$defs/${m[1]}`
}

/** `{$ref: persimmon.ai/v1#/<Name>}` → the schema from the design files; anything else is returned as is. */
export function expandSchema(schema: JsonSchema | { $ref: string } | undefined): JsonSchema | undefined {
  if (!schema) return undefined
  const ref = (schema as { $ref?: string }).$ref
  if (!ref) return schema as JsonSchema
  return ajv.getSchema(wellKnownPointer(ref))?.schema as JsonSchema
}

/** The schema with every `$ref` inlined from the design files, so an Adapter or a human form can read it alone. A cycle becomes `{}`. */
export function inlineSchema(schema: JsonSchema | { $ref: string } | undefined): JsonSchema | undefined {
  if (!schema) return undefined
  const stack: string[] = []
  // `file` is the design file a node came from; undefined while still inside the port schema itself, whose `#` refs point at its own $defs
  const walk = (node: unknown, file: string | undefined): unknown => {
    if (Array.isArray(node)) return node.map((n) => walk(n, file))
    if (!node || typeof node !== 'object') return node
    const ref = (node as { $ref?: string }).$ref
    if (typeof ref === 'string') {
      const local = !file && ref.startsWith('#/')
      const abs = wellKnown.test(ref) ? wellKnownPointer(ref) : ref.startsWith('#') ? `${file ?? ''}${ref}` : ref
      if (stack.includes(abs)) return {}
      const target = local ? pointer(schema, ref.slice(2)) : ajv.getSchema(abs)?.schema
      if (!target) throw new PortError(`unknown $ref ${ref}`)
      stack.push(abs)
      const out = walk(target, local ? undefined : abs.split('#')[0]!)
      stack.pop()
      return out
    }
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, k === 'const' || k === 'enum' || k === 'default' || k === '$defs' ? v : walk(v, file)]))
  }
  const { $defs: _d, ...rest } = walk(schema, undefined) as JsonSchema & { $defs?: unknown }
  return rest
}

const pointer = (root: unknown, path: string): unknown => path.split('/').reduce<unknown>((n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k.replaceAll('~1', '/').replaceAll('~0', '~')] : undefined), root)

function validatorFor(schema: JsonSchema | { $ref: string }): ValidateFunction {
  const ref = (schema as { $ref?: string }).$ref
  return ref ? (ajv.getSchema(wellKnownPointer(ref)) as ValidateFunction) : ajv.compile(inlineSchema(schema)!) // a well-known $ref at any depth (10-ports.md)
}

/** Equality after `$ref` expansion; no subtyping (10-ports.md). */
export function sameType(a: PortType, b: PortType): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'value' && b.kind === 'value') return isDeepStrictEqual(expandSchema(a.schema) ?? {}, expandSchema(b.schema) ?? {})
  return isDeepStrictEqual(a, b)
}

/** Runtime value of the port's kind: value validates against the schema, refs match the declared kind. */
export function checkValue(port: string, type: PortType, v: RuntimeValue): void {
  if (v.kind !== type.kind) throw new PortError(`${port}: expected ${type.kind}, got ${v.kind}`)
  if (type.kind === 'value' && v.kind === 'value') {
    if (type.schema) {
      const validate = validatorFor(type.schema)
      if (!validate(v.value)) throw new PortError(`${port}: ${validate.errors?.map((e) => `${e.instancePath} ${e.message}`).join('; ')}`)
    }
  } else if (type.kind === 'artifact' && v.kind === 'artifact') {
    if (v.ref.apiVersion !== type.artifactKind.apiVersion || v.ref.kind !== type.artifactKind.kind)
      throw new PortError(`${port}: expected ${type.artifactKind.kind}, got ${v.ref.kind}`)
  } else if (type.kind === 'artifacts' && v.kind === 'artifacts') {
    for (const ref of v.refs)
      if (ref.apiVersion !== type.artifactKind.apiVersion || ref.kind !== type.artifactKind.kind) throw new PortError(`${port}: expected ${type.artifactKind.kind}, got ${ref.kind}`)
  } else if (type.kind === 'externalResource' && v.kind === 'externalResource') {
    if (v.ref.provider !== type.provider || v.ref.type !== type.type) throw new PortError(`${port}: expected ${type.provider}/${type.type}, got ${v.ref.provider}/${v.ref.type}`)
  }
}

/** May the port be unbound: `required: false`, or an expression, which only the values present at bind decide (10-ports.md). */
export const optional = (spec: InputSpec): boolean => spec.required === false || typeof spec.required === 'object'

/** Static rule: every `required` expression type-checks as bool against the definition's own inputs. */
export function requiredFindings(inputs: Record<string, InputSpec> = {}, path = '/spec/inputs'): Finding[] {
  const f: Finding[] = []
  for (const [port, spec] of Object.entries(inputs)) {
    if (typeof spec.required !== 'object') continue
    try {
      const type = siteOf({ inputs }).check(spec.required.expression)
      if (type !== 'bool') f.push({ severity: 'error', code: 'invalid_expression', path: `${path}/${port}/required`, message: `${port}: required expression is ${type}, not bool` })
    } catch (e) {
      f.push({ severity: 'error', code: 'invalid_expression', path: `${path}/${port}/required`, message: `${port}: required expression: ${(e as Error).message}` })
    }
  }
  return f
}

/** Every required input present, every value of its port's type, defaults applied, no unknown ports. */
export function checkInputs(specs: Record<string, InputSpec>, values: RuntimeValues): RuntimeValues {
  const out: RuntimeValues = {}
  for (const [port, spec] of Object.entries(specs)) {
    const v = values[port] ?? spec.default
    if (!v) continue
    checkValue(port, spec.type, v)
    out[port] = v
  }
  for (const port of Object.keys(values)) if (!(port in specs)) throw new PortError(`${port}: not an input`)
  const absent = Object.entries(specs).filter(([port]) => !(port in out))
  for (const [port, spec] of absent) if (spec.required === undefined || spec.required === true) throw new PortError(`${port}: required input missing`)
  // plainly required ports first: an expression may read one, and its absence is the clearer message
  let site: Site | undefined // one environment for every expression-required port, the inputs present as its context
  for (const [port, spec] of absent) {
    if (typeof spec.required !== 'object') continue
    site ??= siteOf({ inputs: specs })
    let holds: unknown
    try {
      holds = site.evaluate(spec.required.expression, celContext({ inputs: out }))
    } catch (e) {
      throw new PortError(`${port}: required expression: ${(e as Error).message}`)
    }
    if (holds === true) throw new PortError(`${port}: required input missing (${spec.required.expression})`)
  }
  return out
}

/** Exactly the declared outputs, each of its type (12-task.md TaskResult). */
export function checkOutputs(specs: Record<string, OutputSpec>, values: RuntimeValues): void {
  for (const port of Object.keys(specs)) if (!values[port]) throw new PortError(`${port}: output missing`)
  for (const [port, v] of Object.entries(values)) {
    const spec = specs[port]
    if (!spec) throw new PortError(`${port}: not an output`)
    checkValue(port, spec.type, v)
  }
}

/** What a Binding may read at a site. Absent roots are not in scope there. */
export interface Sources {
  inputs?: RuntimeValues
  /** stepId → outputs, for finished steps only; a Skipped or unfinished step is absent. */
  steps?: Record<string, { phase: string; outputs?: RuntimeValues; error?: unknown; iterations?: number }>
  state?: RuntimeValues
  iteration?: { index: number; outputs?: RuntimeValues }
  /** Engine projection of the Outbox event (16-trigger.md). */
  event?: Record<string, unknown>
  /** The latest committed revision of an artifact id in the run's Namespace, for `fromArtifact`; absent where the site has no store. */
  latest?: (kind: { apiVersion: string; kind: string }, id: string) => RevisionRef | undefined
  /** Every id of a kind in the run's Namespace at its latest committed revision, by id, with its content, for `fromQuery`; absent where the site has no store. */
  query?: (kind: { apiVersion: string; kind: string }) => { ref: RevisionRef; content: unknown }[]
}

/** Evaluates one Binding; `undefined` means the source is absent (caller applies `onMissing`). */
export function evaluateBinding(b: Binding, s: Sources, site: Site): RuntimeValue | undefined {
  if ('literal' in b) return { kind: 'value', value: b.literal }
  if ('fromInput' in b) return s.inputs?.[b.fromInput]
  if ('fromStep' in b) return s.steps?.[b.fromStep.stepRef]?.outputs?.[b.fromStep.output]
  if ('fromState' in b) return s.state?.[b.fromState]
  if ('fromIterationOutput' in b) return s.iteration?.outputs?.[b.fromIterationOutput]
  if ('expression' in b) return { kind: 'value', value: site.evaluate(b.expression, celContext(s)) }
  if ('first' in b) {
    // the first alternative with a source: an output that one of two exclusive paths made (10-ports.md)
    for (const alt of b.first) {
      const v = evaluateBinding(alt, s, site)
      if (v) return v
    }
    return undefined
  }
  if ('fromArtifact' in b) {
    const id = site.evaluate(b.fromArtifact.id, celContext(s))
    if (typeof id !== 'string') throw new PortError(`fromArtifact: id ${JSON.stringify(id)} is not a string`)
    const ref = s.latest?.(b.fromArtifact.kind, id)
    return ref ? { kind: 'artifact', ref } : undefined
  }
  if ('fromQuery' in b) {
    // every latest revision `where` holds for, by id; none is an empty list, an answer, not an absence (10-ports.md)
    const candidates = s.query?.(b.fromQuery.kind)
    if (!candidates) return undefined
    const at = site.extend({ content: {} })
    // content is typed dyn, so no schema says which numbers are integers: a whole number is a CEL int, as an `integer` port's is
    const ints = (v: unknown): unknown => (typeof v === 'number' && Number.isInteger(v) ? BigInt(v) : Array.isArray(v) ? v.map(ints) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, ints(x)])) : v)
    const ctx = celContext(s)
    const refs: RevisionRef[] = []
    for (const c of candidates) {
      let keep: unknown
      try {
        keep = at.evaluate(b.fromQuery.where, { ...ctx, content: ints(c.content) })
      } catch (e) {
        throw new PortError(`fromQuery: ${c.ref.kind}/${c.ref.id}.r${c.ref.revision}: ${(e as Error).message}`) // a typo shows, never a silently shorter list
      }
      if (typeof keep !== 'boolean') throw new PortError(`fromQuery: ${c.ref.kind}/${c.ref.id}.r${c.ref.revision}: where answered ${JSON.stringify(keep)}, not a bool`)
      if (keep) refs.push(c.ref)
    }
    return { kind: 'artifacts', refs }
  }
  const v = b.fromEvent.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], s.event)
  return v === undefined ? undefined : { kind: 'value', value: v }
}

/** Binds a port map: absent source with `onMissing: omit` skips the port; otherwise it is an error. */
export function bind(bindings: Bindings, s: Sources, site: Site): RuntimeValues {
  const out: RuntimeValues = {}
  for (const [port, b] of Object.entries(bindings)) {
    const v = evaluateBinding(b, s, site)
    if (v) out[port] = v
    else if (b.onMissing !== 'omit') throw new PortError(`${port}: source absent`)
  }
  return out
}

/** RuntimeValues as CEL sees them: value ports unwrapped, refs as their ref objects, an artifacts port as a list of them (10-ports.md). */
export function unwrap(values: RuntimeValues | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [k, v.kind === 'value' ? v.value : v.kind === 'artifacts' ? v.refs : v.ref]))
}

/** CEL context of a site's Sources (10-ports.md expression profile). */
export function celContext(s: Sources): Record<string, unknown> {
  const ctx: Record<string, unknown> = {}
  if (s.inputs) ctx.inputs = unwrap(s.inputs)
  if (s.steps) ctx.steps = Object.fromEntries(Object.entries(s.steps).map(([id, st]) => [id, { phase: st.phase, outputs: unwrap(st.outputs), ...(st.error ? { error: st.error } : {}), ...(st.iterations ? { iterations: st.iterations } : {}) }]))
  if (s.state) ctx.state = unwrap(s.state)
  if (s.iteration) ctx.iteration = { index: s.iteration.index, outputs: unwrap(s.iteration.outputs) }
  if (s.event) ctx.event = s.event
  return ctx
}

/** The CEL environment of a site (10-ports.md expression profile). Ports become typed roots. */
export function siteOf(roots: { inputs?: Record<string, InputSpec>; steps?: Record<string, Record<string, OutputSpec>>; state?: Record<string, InputSpec>; iterationOutputs?: Record<string, OutputSpec>; event?: JsonSchema; extra?: Record<string, JsonSchema> }): Site {
  const refSchema = (t: PortType): JsonSchema => expandSchema({ $ref: t.kind === 'externalResource' ? 'persimmon.ai/v1#/ExternalResourceRef' : 'persimmon.ai/v1#/RevisionRef' }) ?? {}
  const portSchema = (t: PortType): JsonSchema => (t.kind === 'value' ? (expandSchema(t.schema) ?? {}) : t.kind === 'artifacts' ? { type: 'array', items: refSchema(t) } : refSchema(t))
  const objectOf = (ports: Record<string, { type: PortType }> | undefined): JsonSchema | undefined =>
    ports && { type: 'object', properties: Object.fromEntries(Object.entries(ports).map(([k, p]) => [k, portSchema(p.type)])) }
  const r: Record<string, JsonSchema | undefined> = {}
  if (roots.inputs) r.inputs = objectOf(roots.inputs)
  if (roots.steps)
    r.steps = {
      type: 'object',
      properties: Object.fromEntries(
        Object.entries(roots.steps).map(([id, outs]) => [
          id,
          { type: 'object', properties: { phase: { type: 'string' }, outputs: objectOf(outs), error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' } } }, iterations: { type: 'integer' } } },
        ]),
      ),
    }
  if (roots.state) r.state = objectOf(roots.state)
  if (roots.iterationOutputs) r.iteration = { type: 'object', properties: { index: { type: 'integer' }, outputs: objectOf(roots.iterationOutputs) ?? {} } }
  if (roots.event) r.event = roots.event
  Object.assign(r, roots.extra)
  return new Site(r)
}

export { celTypeOf }

/** A Namespaced definition shadowing a Global one keeps its ports, so a run never breaks at snapshot time (20-pack.md). */
export function overrideFindings(lookup: (kind: string, namespace: string | undefined, name: string) => Resource | undefined, resource: Resource): Finding[] {
  if (!resource.metadata.namespace) return []
  const global = lookup(resource.kind, undefined, resource.metadata.name)
  if (!global || global.metadata.namespace) return []
  const ports = (r: Resource) => r.spec as { inputs?: Record<string, InputSpec>; outputs?: Record<string, OutputSpec> }
  const [a, b] = [ports(global), ports(resource)]
  const out: Finding[] = []
  for (const side of ['inputs', 'outputs'] as const) {
    const [ga, na] = [a[side] ?? {}, b[side] ?? {}]
    for (const name of new Set([...Object.keys(ga), ...Object.keys(na)])) {
      const [g, n] = [ga[name], na[name]]
      const why = !g ? 'is not a port of the Global definition' : !n ? 'is missing' : !sameType(g.type, n.type) ? 'has a different type' : side === 'inputs' && !isDeepStrictEqual((g as InputSpec).required ?? true, (n as InputSpec).required ?? true) ? 'changes whether the input is required' : undefined
      if (why) out.push({ severity: 'error', code: 'override_incompatible', path: `/spec/${side}/${name}`, message: `override ${side}.${name} ${why}` })
    }
  }
  return out
}

