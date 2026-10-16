// What a builtin Handler may touch: Engine callbacks in process plus read-only registries (02-handler.md).
import type { AdapterRegistry } from '../adapter/registry.js'
import type { KindRegistry } from '../kind-definition/registry.js'
import type { Resource, RevisionRef, Snapshot } from '../resource/types.js'
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
  getByUid(uid: string): Resource | undefined
  /** Random in [0, 1); injectable for jitter tests. */
  random(): number
  /** The expansion of a live composition Resource (21-composition.md); absent in handler unit tests. */
  expand?(resource: Resource, namespace?: string): Resource[]
  /** The latest committed revision of an artifact id, for `fromArtifact` bindings (10-ports.md); absent in handler unit tests. */
  latestRevision?(kind: { apiVersion: string; kind: string }, namespace: string, id: string): RevisionRef | undefined
  /** Every id of a kind at its latest committed revision, by id, with its content, for `fromQuery` bindings (10-ports.md); absent in handler unit tests. */
  latestRevisions?(kind: { apiVersion: string; kind: string }, namespace: string): { ref: RevisionRef; content: unknown }[]
}

/** Definition lookup inside a closure: the run's Namespace first, then Global (04-snapshot.md). */
export function fromClosure(closure: Closure, kind: string, namespace: string | undefined, name: string): Entry | undefined {
  const hits = closure.resources.filter((r) => r.kind === kind && r.metadata.name === name)
  const hit = hits.find((r) => r.metadata.namespace === namespace) ?? hits.find((r) => !r.metadata.namespace)
  if (hit) return hit
  // a composition kind is not a member; its expansion of the same name is (04-snapshot.md step 8)
  const kd = closure.resources.find((r) => r.kind === 'KindDefinition' && (r.spec as { names: { kind: string } }).names.kind === kind)
  const target = (kd?.spec as { expansion?: { kind: string } } | undefined)?.expansion?.kind
  return target ? fromClosure(closure, target, namespace, name) : undefined
}
