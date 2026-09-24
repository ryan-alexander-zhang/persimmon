// Schema-guided walk over an instance: yields every value under an x-persimmon-* annotation.
import type { JsonSchema } from '../kind-definition/types.js'
import { ajv } from '../resource/ajv.js'

export type Annotation = 'x-persimmon-ref' | 'x-persimmon-kind-ref' | 'x-persimmon-adapter'

export interface Annotated {
  annotation: Annotation
  config: Record<string, unknown>
  value: unknown
  path: string
}

const annotations: Annotation[] = ['x-persimmon-ref', 'x-persimmon-kind-ref', 'x-persimmon-adapter']

/** Follows `$ref` into the design schemas: `<file>#/...` sets the base file; a local `#/...` resolves against it. */
function deref(schema: JsonSchema, base: string | undefined): { schema: JsonSchema; base: string | undefined } {
  const ref = schema.$ref as string | undefined
  if (!ref) return { schema, base }
  const full = ref.startsWith('#') ? (base ? `${base}${ref}` : undefined) : ref
  const target = full ? (ajv.getSchema(full)?.schema as JsonSchema | undefined) : undefined
  if (!target) return { schema, base }
  const { $ref: _r, ...rest } = schema
  return { schema: { ...target, ...rest }, base: full!.split('#')[0] }
}

/** A oneOf/anyOf branch applies when its `const` discriminators and `required` keys hold on the value. */
function branchMatches(branch: JsonSchema, value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true
  const v = value as Record<string, unknown>
  for (const k of (branch.required as string[] | undefined) ?? []) if (!(k in v)) return false
  for (const [k, sub] of Object.entries((branch.properties as Record<string, JsonSchema> | undefined) ?? {}))
    if (sub && typeof sub === 'object' && 'const' in sub && k in v && JSON.stringify(sub.const) !== JSON.stringify(v[k])) return false
  return true
}

export function* findAnnotated(raw: JsonSchema | undefined, value: unknown, path = '', base?: string): Generator<Annotated> {
  if (!raw || typeof raw !== 'object' || value === undefined) return // boolean schemas (`phase: true`) carry no annotation
  const d = deref(raw, base)
  const schema = d.schema
  base = d.base
  for (const a of annotations)
    if (a in schema) yield { annotation: a, config: (schema[a] as Record<string, unknown>) ?? {}, value, path }
  for (const sub of (schema.allOf as JsonSchema[] | undefined) ?? []) yield* findAnnotated(sub, value, path, base)
  for (const k of ['anyOf', 'oneOf'] as const)
    for (const sub of (schema[k] as JsonSchema[] | undefined) ?? []) if (branchMatches(deref(sub, base).schema, value)) yield* findAnnotated(sub, value, path, base)
  if (Array.isArray(value)) {
    const items = schema.items as JsonSchema | undefined
    for (const [i, v] of value.entries()) yield* findAnnotated(items, v, `${path}/${i}`, base)
    return
  }
  if (value && typeof value === 'object') {
    const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {}
    const extra = schema.additionalProperties
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const sub = props[k] ?? (extra && typeof extra === 'object' ? (extra as JsonSchema) : undefined)
      yield* findAnnotated(sub, v, `${path}/${k}`, base)
    }
  }
}
