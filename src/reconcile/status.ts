import type { KindRegistry } from '../kind-definition/registry.js'
import { formatErrors } from '../resource/ajv.js'
import type { Resource } from '../resource/types.js'
import { mergePatch, readPath } from './merge-patch.js'

export class CommitError extends Error {}

/** Commit step 1 (03-reconcile.md): apply statusPatch, validate, refuse to move off a terminal value. */
export function applyStatusPatch(resource: Resource, patch: Record<string, unknown> | undefined, kinds: KindRegistry): Resource {
  if (!patch) return resource
  const next = { ...resource, status: mergePatch(resource.status ?? {}, patch) as Record<string, unknown> }
  const c = kinds.get(resource.apiVersion, resource.kind)
  if (c.status && !c.status(next.status)) throw new CommitError(`status: ${formatErrors(c.status.errors)}`)
  const t = c.definition.spec.terminal
  if (t) {
    const before = terminalValue(resource, t)
    const after = terminalValue(next, t)
    if (before !== undefined && after !== before) throw new CommitError(`${t.path} is terminal (${before}); patch sets ${String(after)}`)
  }
  return next
}

/** The terminal value the Resource holds, or undefined when it holds none. */
export function terminalValue(resource: Resource, t: { path: string; values: string[] }): string | undefined {
  const v = readPath(resource as unknown as Record<string, unknown>, t.path)
  return typeof v === 'string' && t.values.includes(v) ? v : undefined
}
