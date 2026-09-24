import { isDeepStrictEqual } from 'node:util'
import { Site } from '../../expression/site.js'
import type { JsonSchema } from '../../kind-definition/types.js'
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

function validatorFor(schema: JsonSchema | { $ref: string }): ValidateFunction {
  const ref = (schema as { $ref?: string }).$ref
  return ref ? (ajv.getSchema(wellKnownPointer(ref)) as ValidateFunction) : ajv.compile(schema)
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
  } else if (type.kind === 'externalResource' && v.kind === 'externalResource') {
    if (v.ref.provider !== type.provider || v.ref.type !== type.type) throw new PortError(`${port}: expected ${type.provider}/${type.type}, got ${v.ref.provider}/${v.ref.type}`)
  }
}

/** Every required input present, every value of its port's type, defaults applied, no unknown ports. */
export function checkInputs(specs: Record<string, InputSpec>, values: RuntimeValues): RuntimeValues {
  const out: RuntimeValues = {}
  for (const [port, spec] of Object.entries(specs)) {
    const v = values[port] ?? spec.default
    if (!v) {
      if (spec.required !== false) throw new PortError(`${port}: required input missing`)
      continue
    }
    checkValue(port, spec.type, v)
    out[port] = v
  }
  for (const port of Object.keys(values)) if (!(port in specs)) throw new PortError(`${port}: not an input`)
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
  steps?: Record<string, { phase: string; outputs?: RuntimeValues; error?: unknown }>
  state?: RuntimeValues
  iteration?: { index: number; outputs?: RuntimeValues }
  /** Engine projection of the Outbox event (16-trigger.md). */
  event?: Record<string, unknown>
}

/** Evaluates one Binding; `undefined` means the source is absent (caller applies `onMissing`). */
export function evaluateBinding(b: Binding, s: Sources, site: Site): RuntimeValue | undefined {
  if ('literal' in b) return { kind: 'value', value: b.literal }
  if ('fromInput' in b) return s.inputs?.[b.fromInput]
  if ('fromStep' in b) return s.steps?.[b.fromStep.stepRef]?.outputs?.[b.fromStep.output]
  if ('fromState' in b) return s.state?.[b.fromState]
  if ('fromIterationOutput' in b) return s.iteration?.outputs?.[b.fromIterationOutput]
  if ('expression' in b) return { kind: 'value', value: site.evaluate(b.expression, celContext(s)) }
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

/** RuntimeValues as CEL sees them: value ports unwrapped, refs as their ref objects (10-ports.md). */
export function unwrap(values: RuntimeValues | undefined): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [k, v.kind === 'value' ? v.value : v.ref]))
}

function celContext(s: Sources): Record<string, unknown> {
  const ctx: Record<string, unknown> = {}
  if (s.inputs) ctx.inputs = unwrap(s.inputs)
  if (s.steps) ctx.steps = Object.fromEntries(Object.entries(s.steps).map(([id, st]) => [id, { phase: st.phase, outputs: unwrap(st.outputs), ...(st.error ? { error: st.error } : {}) }]))
  if (s.state) ctx.state = unwrap(s.state)
  if (s.iteration) ctx.iteration = { index: s.iteration.index, outputs: unwrap(s.iteration.outputs) }
  if (s.event) ctx.event = s.event
  return ctx
}

/** The CEL environment of a site (10-ports.md expression profile). Ports become typed roots. */
export function siteOf(roots: { inputs?: Record<string, InputSpec>; steps?: Record<string, Record<string, OutputSpec>>; state?: Record<string, InputSpec>; iterationOutputs?: Record<string, OutputSpec>; event?: JsonSchema }): Site {
  const portSchema = (t: PortType): JsonSchema => (t.kind === 'value' ? (expandSchema(t.schema) ?? {}) : expandSchema({ $ref: t.kind === 'artifact' ? 'persimmon.ai/v1#/RevisionRef' : 'persimmon.ai/v1#/ExternalResourceRef' }) ?? {})
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
          { type: 'object', properties: { phase: { type: 'string' }, outputs: objectOf(outs), error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' } } } } },
        ]),
      ),
    }
  if (roots.state) r.state = objectOf(roots.state)
  if (roots.iterationOutputs) r.iteration = { type: 'object', properties: { index: { type: 'integer' }, outputs: objectOf(roots.iterationOutputs) ?? {} } }
  if (roots.event) r.event = roots.event
  return new Site(r)
}

export { celTypeOf }
