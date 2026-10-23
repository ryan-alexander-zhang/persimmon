import type { Resource } from '../resource/types.js'

type Output = { kind: string; ref?: { kind: string; id: string; revision: number; namespace?: string }; refs?: { kind: string; id: string; revision: number; namespace?: string }[]; value?: unknown }

/** Per id the highest revision of a kind that a WorkflowRun put out beside `passed: true`, a ReviewLoop's round or the loop itself
 * (21-composition.md), keyed `<namespace>/<id>`; one Namespace or, with none given, every one. A revision carries no verdict and
 * every round publishes its draft before the Gate judges it, so the latest revision is the latest draft; a rejected, cancelled or
 * failed round's draft is never here. Read by `get --passed` (08-store.md) and by `fromArtifact` (10-ports.md). */
export function passedRevisions(resources: { list(kind: string, namespace?: string): Resource[] }, kind: string, namespace: string | undefined): Map<string, number> {
  const best = new Map<string, number>()
  for (const run of resources.list('WorkflowRun', namespace)) {
    const outputs = (run.status as { outputs?: Record<string, Output> } | undefined)?.outputs ?? {}
    if (outputs.passed?.kind !== 'value' || outputs.passed.value !== true) continue
    for (const o of Object.values(outputs)) {
      for (const r of o.kind === 'artifact' && o.ref ? [o.ref] : o.kind === 'artifacts' ? (o.refs ?? []) : []) {
        const key = `${r.namespace ?? run.metadata.namespace}/${r.id}`
        if (r.kind === kind && (best.get(key) ?? 0) < r.revision) best.set(key, r.revision)
      }
    }
  }
  return best
}
