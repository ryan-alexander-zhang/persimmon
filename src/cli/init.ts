import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Resource } from '../resource/types.js'
import { applyDocs } from './apply.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { loadDocs } from './io.js'

/** `packs/sdlc/global` next to the package root, wherever the binary runs from. */
export function packDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packs', 'sdlc', 'global')
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
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.yaml')).sort().map((f) => join(dir, f)) : []
  if (files.length === 0) {
    cli.out(`no pack at ${dir}`)
    return 0
  }
  // Adapters are installed after init, so Executors may not resolve theirs yet (13-executor.md apply rule, skipped here)
  return withEngine(cli, (engine) => applyDocs(cli, engine, loadDocs(files) as Resource[], { skipAdapterValidation: true }))
}
