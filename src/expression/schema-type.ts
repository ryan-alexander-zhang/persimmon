// JSON Schema → CEL type (10-ports.md, expression profile). Unknown shapes become dyn.
import type { JsonSchema } from '../kind-definition/types.js'

export type CelType = string | { [field: string]: CelType }

export function celTypeOf(schema: JsonSchema | undefined): CelType {
  if (!schema) return 'dyn'
  const t = Array.isArray(schema.type) ? undefined : schema.type
  switch (t) {
    case 'integer':
      return 'int'
    case 'number':
      return 'double'
    case 'string':
      return 'string'
    case 'boolean':
      return 'bool'
    case 'null':
      return 'null_type'
    case 'array': {
      const item = celTypeOf(schema.items as JsonSchema | undefined)
      return typeof item === 'string' ? `list<${item}>` : 'list'
    }
    case 'object': {
      const props = schema.properties as Record<string, JsonSchema> | undefined
      if (!props || Object.keys(props).length === 0) return 'map'
      return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, celTypeOf(v)]))
    }
    default:
      return 'dyn'
  }
}

/** Converts a JSON value so CEL sees the schema's types: integer → int (BigInt). */
export function bindValue(value: unknown, schema: JsonSchema | undefined): unknown {
  if (!schema || value === null || value === undefined) return value
  switch (schema.type) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value) ? BigInt(value) : value
    case 'array':
      return Array.isArray(value) ? value.map((v) => bindValue(v, schema.items as JsonSchema | undefined)) : value
    case 'object': {
      const props = schema.properties as Record<string, JsonSchema> | undefined
      if (!props || typeof value !== 'object' || Array.isArray(value)) return value
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, bindValue(v, props[k])]),
      )
    }
    default:
      return value
  }
}

/** CEL result → JSON: int (BigInt) → number, Map → object. */
export function toJson(value: unknown): unknown {
  if (typeof value === 'bigint') return Number(value)
  if (value instanceof Map) return Object.fromEntries([...value].map(([k, v]) => [String(k), toJson(v)]))
  if (Array.isArray(value)) return value.map(toJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]))
  }
  return value
}
