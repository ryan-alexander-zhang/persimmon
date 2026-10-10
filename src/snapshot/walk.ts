import type { KindDefinition } from '../kind-definition/types.js'
import type { LocalDefinitionRef, Resource } from '../resource/types.js'
import { findAnnotated } from './annotations.js'

export class SnapshotError extends Error {}

export interface Entry {
  apiVersion: string
  kind: string
  metadata: { name: string; namespace?: string }
  spec: Record<string, unknown>
}

/** Closure as stored, before canonical encoding (schemas/snapshot.yaml). */
export interface Closure {
  version: 1
  resources: Entry[]
  adapters: { id: string; describeDigest: string }[]
}

/** What the walk asks of the engine. */
export interface Resolver {
  kindByName(kind: string): KindDefinition | undefined
  kind(apiVersion: string, kind: string): KindDefinition | undefined
  /** Root Namespace first, then Global (04-snapshot.md). */
  definition(kind: string, namespace: string | undefined, name: string): Resource | undefined
  /** Fails when the Adapter is not Ready, unreachable, or its digest moved. */
  adapterDigest(id: string): string
  /** The expansion of a composition Resource (01-kind-definition.md `expansion`). */
  expand(resource: Resource): Resource[]
}

const keyOf = (r: { apiVersion: string; kind: string; metadata: { name: string; namespace?: string | undefined } }) =>
  `${r.apiVersion}|${r.kind}|${r.metadata.namespace ?? ''}|${r.metadata.name}`

/** Walks from `root.spec` and returns the closure, sorted per 04-snapshot.md. */
export function resolveClosure(root: Resource, resolver: Resolver): Closure {
  const rootNs = root.metadata.namespace
  const members = new Map<string, Resource>()
  const adapters = new Map<string, string>()
  const kinds = new Map<string, KindDefinition>()

  const addKind = (kd: KindDefinition): void => {
    kinds.set(keyOf(kd), kd)
    const run = kd.spec.stepContract?.runKind
    if (run) {
      const rk = resolver.kind(`${run.group}/${kd.spec.versions[0]!.name}`, run.kind) ?? resolver.kindByName(run.kind)
      if (!rk) throw new SnapshotError(`${kd.metadata.name}: stepContract.runKind ${run.kind} is not registered`)
      kinds.set(keyOf(rk), rk)
    }
  }

  const visit = (resource: Resource): void => {
    const kd = resolver.kind(resource.apiVersion, resource.kind)
    if (!kd) throw new SnapshotError(`unregistered kind ${resource.apiVersion} ${resource.kind}`)
    const version = resource.apiVersion.split('/')[1]
    const schema = kd.spec.versions.find((v) => v.name === version)?.schema
    for (const hit of findAnnotated(schema, resource.spec)) {
      const where = `${resource.kind} ${resource.metadata.name} spec${hit.path}`
      switch (hit.annotation) {
        case 'x-persimmon-ref': {
          const ref = hit.value as LocalDefinitionRef
          const allowed = hit.config.kinds as string[] | undefined
          const expandsTo = resolver.kindByName(ref.kind)?.spec.expansion?.kind
          if (allowed && !allowed.includes(ref.kind) && !(expandsTo && allowed.includes(expandsTo))) throw new SnapshotError(`${where}: kind ${ref.kind} not in ${allowed.join(', ')}`)
          const targetKind = resolver.kindByName(ref.kind)
          if (!targetKind) throw new SnapshotError(`${where}: unregistered kind ${ref.kind}`)
          if (targetKind.spec.snapshot !== 'Definition') continue
          const target = resolver.definition(ref.kind, rootNs, ref.name)
          if (!target) throw new SnapshotError(`${where}: ${ref.kind} ${ref.name} not found`)
          if (targetKind.spec.expansion) {
            // the closure holds the expansion, not the sugar; the composition's KindDefinition rides along so lookups can map the kind (04-snapshot.md step 8)
            addKind(targetKind)
            for (const r of resolver.expand(target)) {
              const k = keyOf(r)
              if (members.has(k)) continue
              const rk = resolver.kindByName(r.kind)
              if (!rk) throw new SnapshotError(`${where}: expansion kind ${r.kind} is not registered`)
              members.set(k, r)
              addKind(rk)
              visit(r)
            }
            break
          }
          const k = keyOf(target)
          if (members.has(k)) continue
          members.set(k, target)
          addKind(targetKind)
          visit(target)
          break
        }
        case 'x-persimmon-kind-ref': {
          const { apiVersion, kind } = hit.value as { apiVersion: string; kind: string }
          const target = resolver.kind(apiVersion, kind)
          if (!target) throw new SnapshotError(`${where}: unregistered kind ${apiVersion} ${kind}`)
          addKind(target)
          break
        }
        case 'x-persimmon-adapter': {
          const id = hit.value as string
          if (!adapters.has(id)) adapters.set(id, resolver.adapterDigest(id))
          break
        }
      }
    }
  }

  visit(root)

  const entry = (r: Resource | KindDefinition): Entry => {
    const e: Entry = { apiVersion: r.apiVersion, kind: r.kind, metadata: { name: r.metadata.name }, spec: r.spec as Record<string, unknown> }
    if (r.metadata.namespace) e.metadata.namespace = r.metadata.namespace
    return e
  }
  const resources = [...members.values(), ...kinds.values()].map(entry)
  resources.sort((a, b) => keyOf(a).localeCompare(keyOf(b)))
  return {
    version: 1,
    resources,
    adapters: [...adapters].map(([id, describeDigest]) => ({ id, describeDigest })).sort((a, b) => a.id.localeCompare(b.id)),
  }
}
