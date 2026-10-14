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
        const r = find(engine, kind, name, o)
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
      const r = name && find(engine, kind, name, o)
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
export function find(engine: { store: { resources: { get(ref: { kind: string; namespace?: string; name: string }): Resource | undefined; listRevisions(kind: string, namespace: string, id: string): Resource[] } }; dispatch: { defaultNamespace: string } }, kind: string, name: string, o: Where = {}): Resource | undefined {
  const latest = (namespace: string) => engine.store.resources.listRevisions(kind, namespace, name).at(-1) // a bare artifact id: its latest committed revision
  if (o.global) return engine.store.resources.get({ kind, name })
  if (o.namespace) return engine.store.resources.get({ kind, namespace: o.namespace, name }) ?? latest(o.namespace)
  return engine.store.resources.get({ kind, namespace: engine.dispatch.defaultNamespace, name }) ?? engine.store.resources.get({ kind, name }) ?? latest(engine.dispatch.defaultNamespace)
}
