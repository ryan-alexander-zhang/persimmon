import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
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

/** lstat, not exists: a dangling symlink is a file present */
const present = (p: string) => {
  try {
    lstatSync(p)
    return true
  } catch {
    return false
  }
}

/** The pack's `files/` into the project, each only when absent; `CLAUDE.md` links to an `AGENTS.md` init wrote (20-pack.md). */
function placeFiles(cli: Cli, dir: string): void {
  for (const f of existsSync(dir) ? readdirSync(dir).sort() : []) {
    if (present(join(cli.cwd, f))) {
      cli.out(`kept ${f}`)
      continue
    }
    copyFileSync(join(dir, f), join(cli.cwd, f))
    cli.out(`wrote ${f}`)
    if (f === 'AGENTS.md' && !present(join(cli.cwd, 'CLAUDE.md'))) {
      symlinkSync('AGENTS.md', join(cli.cwd, 'CLAUDE.md'))
      cli.out('wrote CLAUDE.md -> AGENTS.md')
    }
  }
  const ignore = join(cli.cwd, '.gitignore')
  const text = existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''
  if (text.split('\n').some((l) => l.trim().replace(/^\//, '').replace(/\/$/, '') === '.persimmon')) return
  appendFileSync(ignore, `${text && !text.endsWith('\n') ? '\n' : ''}.persimmon/\n`)
  cli.out('ignored .persimmon/ in .gitignore')
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

/** `persimmon init`: create `.persimmon/`, a default `persimmon.yaml`, place the pack's files, apply the SDLC pack (20-pack.md). */
export async function init(cli: Cli, o: { pack?: string } = {}): Promise<number> {
  mkdirSync(join(cli.cwd, '.persimmon', 'inbox'), { recursive: true })
  const cfg = join(cli.cwd, 'persimmon.yaml')
  if (!existsSync(cfg)) {
    writeFileSync(cfg, 'mode: local\nstore: {sqlite: .persimmon/persimmon.db}\nblobs: .persimmon/blobs\ndefaultNamespace: default\n')
    cli.out('wrote persimmon.yaml')
  }
  const dir = o.pack ?? packDir()
  placeFiles(cli, join(dir, 'files'))
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
