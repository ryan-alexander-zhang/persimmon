import type { Resource } from '../resource/types.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { parseRef, toYaml } from './io.js'

/** `persimmon get <kind>[/<name>] [-n ns]`. */
export async function get(cli: Cli, ref: string, namespace?: string): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      const { kind, name } = parseRef(ref)
      if (name) {
        const r = find(engine, kind, name, namespace)
        if (!r) {
          cli.err(`${kind}/${name} not found`)
          return 1
        }
        cli.out(toYaml(r))
        return 0
      }
      for (const r of engine.store.resources.list(kind, namespace)) cli.out(`${r.kind}/${r.metadata.name}${r.metadata.namespace ? `  -n ${r.metadata.namespace}` : ''}${phaseOf(r) ? `  ${phaseOf(r)}` : ''}`)
      return 0
    },
    { listen: false },
  )
}

/** `persimmon logs <kind>/<name>`: the RunLog. */
export async function logs(cli: Cli, ref: string, namespace?: string): Promise<number> {
  return withEngine(
    cli,
    async (engine) => {
      const { kind, name } = parseRef(ref)
      const r = name && find(engine, kind, name, namespace)
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

const phaseOf = (r: { status?: Record<string, unknown> }) => (typeof r.status?.phase === 'string' ? r.status.phase : undefined)

/** `-n` when given; else defaultNamespace, then Global: the LocalDefinitionRef order (00-resource.md). */
export function find(engine: { store: { resources: { get(ref: { kind: string; namespace?: string; name: string }): Resource | undefined } }; dispatch: { defaultNamespace: string } }, kind: string, name: string, ns?: string): Resource | undefined {
  if (ns) return engine.store.resources.get({ kind, namespace: ns, name })
  return engine.store.resources.get({ kind, namespace: engine.dispatch.defaultNamespace, name }) ?? engine.store.resources.get({ kind, name })
}
