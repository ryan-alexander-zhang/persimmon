import type { Resource } from '../resource/types.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { describe } from './create.js'
import { parseRef, toYaml } from './io.js'

export interface Where {
  namespace?: string
  global?: boolean
}

/** `persimmon get <kind>[/<name>] [-n ns | --global] [--behind]`. */
export async function get(cli: Cli, ref: string, o: Where & { behind?: boolean } = {}): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      const { kind, name } = parseRef(ref)
      if (name) {
        const r = findOrLatest(engine, kind, name, o)
        if (!r) {
          cli.err(`${kind}/${name} not found`)
          return 1
        }
        cli.out(toYaml(r))
        return 0
      }
      if (o.behind) {
        if (!engine.kinds.byKind(kind)?.definition.spec.revisioned) {
          cli.err(`${kind} is not revisioned`)
          return 1
        }
        for (const l of behind(engine, kind, o.namespace ?? engine.dispatch.defaultNamespace)) cli.out(l)
        return 0
      }
      for (const r of engine.store.resources.list(kind, o.global ? '' : o.namespace)) {
        const state = describe(r)
        cli.out(`${r.kind}/${r.metadata.name}${r.metadata.namespace ? `  -n ${r.metadata.namespace}` : ''}${state ? `  ${state}` : ''}`)
      }
      return 0
    },
    { listen: false },
  )
}

/** `persimmon logs <kind>/<name>`: the RunLog. */
export async function logs(cli: Cli, ref: string, o: Where = {}): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      const { kind, name } = parseRef(ref)
      const r = name && findOrLatest(engine, kind, name, o)
      if (!r) {
        cli.err(`${ref} not found`)
        return 1
      }
      const uid = r.metadata.uid as string
      for (const e of engine.store.runLog.read(uid)) {
        cli.out(toYaml({ ...e, logs: engine.store.runLog.logs(uid, e.event.sequence) }).trimEnd())
        cli.out('---')
      }
      return 0
    },
    { listen: false },
  )
}

type Revision = Resource & { spec: { identity: { id: string; revision: number }; provenance: { producerRef: { kind: string; name: string }; inputs: { kind: string; namespace: string; id: string; revision: number }[] } } }

/** `get <Kind> --behind` (27-spec-process.md): the latest revision of each id whose pinned inputs have moved on.
 * Per input id the highest pinned revision counts, so a carried `previous*` input is not drift; a later revision the same
 * run produced is not either. A hand-loaded revision pins nothing and is never behind. */
export function behind(engine: Finder, kind: string, namespace: string): string[] {
  const latest = new Map<string, Revision>()
  for (const r of engine.store.resources.list(kind, namespace) as Revision[]) {
    const id = r.spec.identity.id
    if ((latest.get(id)?.spec.identity.revision ?? 0) < r.spec.identity.revision) latest.set(id, r)
  }
  const lines: string[] = []
  for (const r of latest.values()) {
    const pinned = new Map<string, Revision['spec']['provenance']['inputs'][number]>()
    for (const i of r.spec.provenance.inputs) {
      const k = `${i.kind}/${i.namespace}/${i.id}`
      if ((pinned.get(k)?.revision ?? 0) < i.revision) pinned.set(k, i)
    }
    for (const i of pinned.values()) {
      const current = engine.store.resources.listRevisions(i.kind, i.namespace, i.id).filter((c) => (c as Revision).spec.identity.id === i.id).at(-1) as Revision | undefined
      if (!current || current.spec.identity.revision <= i.revision) continue
      const p = current.spec.provenance.producerRef
      if (p.kind === r.spec.provenance.producerRef.kind && p.name === r.spec.provenance.producerRef.name) continue
      lines.push(`${r.kind}/${r.metadata.name}  -n ${namespace}  behind ${i.kind}/${i.id} r${i.revision} → r${current.spec.identity.revision}`)
    }
  }
  return lines
}

/** `--global` or `-n` when given; else defaultNamespace, then Global: the LocalDefinitionRef order (00-resource.md). */
export function find(engine: Finder, kind: string, name: string, o: Where = {}): Resource | undefined {
  if (o.global) return engine.store.resources.get({ kind, name })
  if (o.namespace) return engine.store.resources.get({ kind, namespace: o.namespace, name })
  return engine.store.resources.get({ kind, namespace: engine.dispatch.defaultNamespace, name }) ?? engine.store.resources.get({ kind, name })
}

/** `find`, and for a revisioned kind a bare artifact id answers its latest committed revision; `get`, `describe`, `logs` and `tree` read this way, `delete` never does. */
export function findOrLatest(engine: Finder, kind: string, name: string, o: Where = {}): Resource | undefined {
  const found = find(engine, kind, name, o)
  if (found || o.global || !engine.kinds.byKind(kind)?.definition.spec.revisioned) return found
  return engine.store.resources
    .listRevisions(kind, o.namespace ?? engine.dispatch.defaultNamespace, name)
    .filter((r) => (r.spec as { identity?: { id?: string } }).identity?.id === name) // the glob also matches a longer name
    .at(-1)
}

interface Finder {
  store: { resources: { get(ref: { kind: string; namespace?: string; name: string }): Resource | undefined; list(kind: string, namespace?: string): Resource[]; listRevisions(kind: string, namespace: string, id: string): Resource[] } }
  dispatch: { defaultNamespace: string }
  kinds: { byKind(kind: string): { definition: { spec: { revisioned?: boolean } } } | undefined }
}
