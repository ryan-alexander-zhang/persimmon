// Schema-guided walk over an instance: yields every value under an x-persimmon-* annotation.
import type { JsonSchema } from '../kind-definition/types.js'

export type Annotation = 'x-persimmon-ref' | 'x-persimmon-kind-ref' | 'x-persimmon-adapter'

export interface Annotated {
  annotation: Annotation
  config: Record<string, unknown>
  value: unknown
  path: string
}

const annotations: Annotation[] = ['x-persimmon-ref', 'x-persimmon-kind-ref', 'x-persimmon-adapter']

export function* findAnnotated(schema: JsonSchema | undefined, value: unknown, path = ''): Generator<Annotated> {
  if (!schema || value === undefined) return
  for (const a of annotations)
    if (a in schema) yield { annotation: a, config: (schema[a] as Record<string, unknown>) ?? {}, value, path }
  for (const k of ['allOf', 'anyOf', 'oneOf'] as const)
    for (const sub of (schema[k] as JsonSchema[] | undefined) ?? []) yield* findAnnotated(sub, value, path)
  if (Array.isArray(value)) {
    const items = schema.items as JsonSchema | undefined
    for (const [i, v] of value.entries()) yield* findAnnotated(items, v, `${path}/${i}`)
    return
  }
  if (value && typeof value === 'object') {
    const props = (schema.properties as Record<string, JsonSchema> | undefined) ?? {}
    const extra = schema.additionalProperties
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const sub = props[k] ?? (extra && typeof extra === 'object' ? (extra as JsonSchema) : undefined)
      yield* findAnnotated(sub, v, `${path}/${k}`)
    }
  }
}
