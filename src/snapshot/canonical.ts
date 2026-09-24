import { createHash } from 'node:crypto'

/** JSON, keys sorted at every depth, UTF-8, no insignificant whitespace (04-snapshot.md). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

export function canonicalBytes(value: unknown): Uint8Array {
  return Buffer.from(canonicalJson(value), 'utf8')
}

export function digestOf(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    )
  }
  return v
}
