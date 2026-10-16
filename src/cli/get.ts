import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Resource } from '../resource/types.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { describe } from './create.js'
import { parseRef, toYaml } from './io.js'

export interface Where {
  namespace?: string
  global?: boolean
}

/** A representation's file: `<name>.<ext>`, the extension from the media type's subtype (`image/svg+xml`: `svg`), a few named by convention. */
const extension = (mediaType: string): string => {
  const sub = mediaType.split('/')[1]?.split('+')[0] ?? ''
  return { markdown: 'md', plain: 'txt', jpeg: 'jpg', javascript: 'js', 'vnd.mermaid': 'mmd', 'octet-stream': 'bin' }[sub] ?? sub
}

/** `persimmon get <kind>[/<name>] [-n ns | --global] [--behind | --files <dir>]`. */
export async function get(cli: Cli, ref: string, o: Where & { behind?: boolean; files?: string } = {}): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      const { kind, name } = parseRef(ref)
      if (o.behind) {
        if (name) {
          cli.err('--behind takes a Kind, not a name')
          return 1
        }
        const kd = engine.kinds.byKind(kind)
        if (!kd?.definition.spec.revisioned) {
          cli.err(kd ? `${kind} is not revisioned` : `unknown kind ${kind}`)
          return 1
        }
        for (const l of behind(engine, kind, o.global ? undefined : (o.namespace ?? engine.dispatch.defaultNamespace))) cli.out(l)
        return 0
      }
      if (name) {
        const r = findOrLatest(engine, kind, name, o)
        if (!r) {
          cli.err(`${kind}/${name} not found`)
          return 1
        }
        if (o.files !== undefined) {
          // every representation of the revision as a file (18-artifact.md); a kind without them has nothing to write
          const reps = ((r.status as { representations?: { name: string; mediaType: string; digest: string }[] } | undefined)?.representations ?? [])
          if (!reps.length) {
            cli.err(`${r.kind}/${r.metadata.name} has no representations`)
            return 1
          }
          mkdirSync(resolve(cli.cwd, o.files), { recursive: true })
          for (const rep of reps) {
            const blob = engine.store.blobs.get(`blob://${rep.digest.replace(/^sha256:/, '')}`)
            if (!blob) {
              cli.err(`${rep.name}: blob ${rep.digest} missing`)
              return 1
            }
            const path = join(resolve(cli.cwd, o.files), `${rep.name}.${extension(rep.mediaType)}`)
            writeFileSync(path, blob.bytes)
            cli.out(`wrote ${path}  ${rep.mediaType}  ${blob.bytes.length} bytes`)
          }
          return 0
        }
        cli.out(toYaml(r))
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

type Revision = Resource & { spec: { identity: { id: string; revision: number }; provenance: { producerRef: { kind: string; namespace?: string; name: string; uid?: string }; inputs: { kind: string; namespace: string; id: string; revision: number }[] } } }

/** The engine stamps a producer's uid; a ref with none is compared by Namespace, kind and name. */
const sameProducer = (a: Revision['spec']['provenance']['producerRef'], b: Revision['spec']['provenance']['producerRef']): boolean =>
  a.uid && b.uid ? a.uid === b.uid : a.namespace === b.namespace && a.kind === b.kind && a.name === b.name

/** `get <Kind> --behind [-n ns | --global]` (08-store.md): the latest revision of each id whose pinned inputs have moved on, in one
 * Namespace or every one. Per input id the highest pinned revision counts, so a carried `previous*` input is not behind; a later
 * revision the same run produced is not either. A hand-loaded revision pins nothing and is never behind. */
export function behind(engine: Finder, kind: string, namespace: string | undefined): string[] {
  const latest = new Map<string, Revision>()
  for (const r of engine.store.resources.list(kind, namespace) as Revision[]) {
    const id = `${r.metadata.namespace}/${r.spec.identity.id}`
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
      if (sameProducer(current.spec.provenance.producerRef, r.spec.provenance.producerRef)) continue
      const where = i.namespace === r.metadata.namespace ? '' : ` -n ${i.namespace}`
      lines.push(`${r.kind}/${r.metadata.name}  -n ${r.metadata.namespace}  behind ${i.kind}/${i.id}${where} r${i.revision} → r${current.spec.identity.revision}`)
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
