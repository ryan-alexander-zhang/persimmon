import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Resource } from '../resource/types.js'
import { applyDocs } from './apply.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { loadDocs } from './io.js'

const root = () => join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** `packs/sdlc` next to the package root, wherever the binary runs from; `packs/demo` is applied by hand. */
export function packDir(): string {
  return join(root(), 'packs', 'sdlc')
}

const yamlFiles = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => join(dir, f)) : [])

/** Shipped Adapter manifests, with their script paths made absolute. */
export function shippedAdapters(): Resource[] {
  const dir = join(root(), 'adapters')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((d) => join(dir, d, 'adapter.yaml'))
    .filter((f) => existsSync(f))
    .flatMap((f) => loadDocs([f]) as Resource[])
    .map((a) => {
      const spec = a.spec as { command?: string[] }
      if (spec.command) spec.command = spec.command.map((c) => (c.startsWith('adapters/') ? join(root(), c) : c))
      return a
    })
}

/** `persimmon init`: create `.persimmon/`, a default `persimmon.yaml`, apply the SDLC pack (20-pack.md). */
export async function init(cli: Cli, o: { pack?: string } = {}): Promise<number> {
  mkdirSync(join(cli.cwd, '.persimmon', 'inbox'), { recursive: true })
  const cfg = join(cli.cwd, 'persimmon.yaml')
  if (!existsSync(cfg)) {
    writeFileSync(cfg, 'mode: local\nstore: {sqlite: .persimmon/persimmon.db}\nblobs: .persimmon/blobs\ndefaultNamespace: default\n')
    cli.out('wrote persimmon.yaml')
  }
  const dir = o.pack ?? packDir()
  const global = yamlFiles(join(dir, 'global'))
  const namespaced = yamlFiles(join(dir, 'namespaced'))
  return withEngine(cli, async (engine) => {
    const a = await applyDocs(cli, engine, shippedAdapters(), { global: true })
    if (global.length === 0) {
      cli.out(`no pack at ${dir}`)
      return a
    }
    // a user Adapter may be installed after init, so its Executors may not resolve yet (13-executor.md apply rule, skipped here)
    const b = await applyDocs(cli, engine, loadDocs(global) as Resource[], { global: true, skipAdapterValidation: true })
    // the pack's Triggers listen in defaultNamespace; another Namespace applies them with -n
    const c = namespaced.length ? await applyDocs(cli, engine, loadDocs(namespaced) as Resource[], { namespace: engine.dispatch.defaultNamespace }) : 0
    return a || b || c
  })
}
