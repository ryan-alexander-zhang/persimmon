// What a builtin Handler may touch: Engine callbacks in process plus read-only registries (02-handler.md).
import type { AdapterRegistry } from '../adapter/registry.js'
import type { KindRegistry } from '../kind-definition/registry.js'
import type { Resource, Snapshot } from '../resource/types.js'
import type { Closure, Entry } from '../snapshot/walk.js'

export interface HandlerDeps {
  kinds: KindRegistry
  adapters: AdapterRegistry
  now: () => Date
  /** The frozen closure a run reads its definitions from (04-snapshot.md). */
  closure(snapshot: Snapshot): Closure
  /** In-process Engine callback with the reconcile's token (07-adapter.md). */
  callback(token: string, name: string, args: Record<string, unknown>): unknown
  /** Live read for kinds outside snapshots (Trigger resolving its Workflow, child runs). Namespace first, then Global. */
  getResource(kind: string, namespace: string | undefined, name: string): Resource | undefined
  /** Random in [0, 1); injectable for jitter tests. */
  random(): number
}

/** Definition lookup inside a closure: the run's Namespace first, then Global (04-snapshot.md). */
export function fromClosure(closure: Closure, kind: string, namespace: string | undefined, name: string): Entry | undefined {
  const hits = closure.resources.filter((r) => r.kind === kind && r.metadata.name === name)
  return hits.find((r) => r.metadata.namespace === namespace) ?? hits.find((r) => !r.metadata.namespace)
}
