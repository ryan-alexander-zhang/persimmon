import type { Snapshot } from '../resource/types.js'
import type { SnapshotStore } from '../store/store.js'
import { canonicalBytes, digestOf } from './canonical.js'
import { type Closure, SnapshotError } from './walk.js'

/** Encodes and stores a closure; identical closures share one uri. */
export function storeClosure(closure: Closure, snapshots: SnapshotStore): Snapshot {
  return snapshots.put(canonicalBytes(closure))
}

/** Reads and re-hashes; a missing or altered snapshot fails the read (04-snapshot.md). */
export function readClosure(snapshot: Snapshot, snapshots: SnapshotStore): Closure {
  const bytes = snapshots.get(snapshot.uri)
  if (!bytes) throw new SnapshotError(`snapshot ${snapshot.uri} missing`)
  if (digestOf(bytes) !== snapshot.digest) throw new SnapshotError(`snapshot ${snapshot.uri}: digest mismatch`)
  return JSON.parse(Buffer.from(bytes).toString('utf8')) as Closure
}
