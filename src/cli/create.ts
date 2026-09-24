import { readPath } from '../reconcile/merge-patch.js'
import type { Resource } from '../resource/types.js'
import type { Cli } from './context.js'
import { openEngine } from './context.js'
import { loadDocs } from './io.js'

/** `persimmon create <file> [--follow]`: store any Resource; `--follow` runs until it reaches a terminal value. */
export async function create(cli: Cli, file: string, o: { follow?: boolean; pollMs?: number } = {}): Promise<number> {
  const [doc] = loadDocs([file]) as Resource[]
  if (!doc) throw new Error(`${file}: no document`)
  const engine = await openEngine(cli)
  try {
    const { resource, created } = await engine.create(doc)
    cli.out(`${created ? 'created' : 'exists'} ${resource.kind}/${resource.metadata.name}`)
    await engine.drain()
    if (!o.follow) return 0
    const t = engine.kinds.get(resource.apiVersion, resource.kind).definition.spec.terminal
    if (!t) return 0
    const uid = resource.metadata.uid as string
    for (;;) {
      const r = engine.store.resources.getByUid(uid)
      const v = readPath(r as unknown as Record<string, unknown>, t.path)
      if (typeof v === 'string' && t.values.includes(v)) {
        cli.out(`${r!.kind}/${r!.metadata.name} ${v}`)
        return v === 'Succeeded' ? 0 : 1
      }
      if (r?.metadata.stalled) {
        cli.err(`${r.kind}/${r.metadata.name} stalled after ${r.metadata.stalled.attempts} attempts: ${r.metadata.stalled.lastError ?? ''}`)
        return 1
      }
      await new Promise((res) => setTimeout(res, o.pollMs ?? 500)) // ponytail: poll; wake on the next timer or call when it matters
      await engine.drain()
    }
  } finally {
    await engine.close()
  }
}
