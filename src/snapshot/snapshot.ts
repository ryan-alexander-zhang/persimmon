import type { Snapshot } from '../resource/types.js'
import type { SnapshotStore } from '../store/store.js'
import { canonicalBytes, digestOf } from './canonical.js'
import { type Closure, SnapshotError } from './walk.js'

/** Encodes and stores a closure; identical closures share one uri. */
export function storeClosure(closure: Closure, snapshots: SnapshotStore): Snapshot {
  return snapshots.put(canonicalBytes(closure))
}

/** Reads and re-hashes; a missing or altered snapshot fails the read (04-snapshot.md). */
/** One kind's version as a closure froze it: `{name, schema}`, or undefined when the closure lacks the kind (05-revisioned-kind.md). */
export function frozenKindVersion(closure: Closure, apiVersion: string, kind: string): { name: string; schema: unknown } | undefined {
  const version = apiVersion.split('/')[1] as string
  const kd = closure.resources.find((r) => r.kind === 'KindDefinition' && `${(r.spec as { group: string }).group}/${version}` === apiVersion && (r.spec as { names: { kind: string } }).names.kind === kind)
  const v = (kd?.spec as { versions: { name: string; schema: unknown }[] } | undefined)?.versions.find((v) => v.name === version)
  return v && { name: v.name, schema: v.schema }
}

export function readClosure(snapshot: Snapshot, snapshots: SnapshotStore): Closure {
  const bytes = snapshots.get(snapshot.uri)
  if (!bytes) throw new SnapshotError(`snapshot ${snapshot.uri} missing`)
  if (digestOf(bytes) !== snapshot.digest) throw new SnapshotError(`snapshot ${snapshot.uri}: digest mismatch`)
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as Closure
}
