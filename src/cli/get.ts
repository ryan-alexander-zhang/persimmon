import type { Resource } from '../resource/types.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { describe } from './create.js'
import { parseRef, toYaml } from './io.js'

export interface Where {
  namespace?: string
  global?: boolean
}

/** `persimmon get <kind>[/<name>] [-n ns | --global]`. */
export async function get(cli: Cli, ref: string, o: Where = {}): Promise<number> {
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
  store: { resources: { get(ref: { kind: string; namespace?: string; name: string }): Resource | undefined; listRevisions(kind: string, namespace: string, id: string): Resource[] } }
  dispatch: { defaultNamespace: string }
  kinds: { byKind(kind: string): { definition: { spec: { revisioned?: boolean } } } | undefined }
}
