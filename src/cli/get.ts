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
        const r = engine.store.resources.get({ kind, namespace: nsOf(engine, kind, namespace), name })
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
      const r = name && engine.store.resources.get({ kind, namespace: nsOf(engine, kind, namespace), name })
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
export const nsOf = (engine: { kinds: { byKind(k: string): { definition: { spec: { scope: string } } } | undefined }; dispatch: { defaultNamespace: string } }, kind: string, ns?: string) =>
  ns ?? (engine.kinds.byKind(kind)?.definition.spec.scope === 'Global' ? undefined : engine.dispatch.defaultNamespace)
