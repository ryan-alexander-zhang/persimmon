import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Resource } from '../resource/types.js'
import { digestOf } from '../snapshot/canonical.js'
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

/** The pack's `files/` into the project when absent, or over one init wrote that nobody edited (its digest in `.persimmon/files.json`); `CLAUDE.md` links to an `AGENTS.md` init wrote (20-pack.md). */
function placeFiles(cli: Cli, dir: string): void {
  // regular files only: a directory or a dotfile (.DS_Store) in files/ is not a project file
  const files = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => e.name).sort() : []
  const record = join(cli.cwd, '.persimmon', 'files.json')
  const written: Record<string, string> = existsSync(record) ? JSON.parse(readFileSync(record, 'utf8')) : {}
  for (const f of files) {
    const to = join(cli.cwd, f)
    const pack = readFileSync(join(dir, f))
    const packDigest = digestOf(pack)
    if (present(to)) {
      // a symlink or a dangling one is never read through: kept as it is
      const mine = lstatSync(to).isFile() ? digestOf(readFileSync(to)) : undefined
      if (mine === packDigest) {
        written[f] = packDigest // a fresh clone has the file but no record
        cli.out(`kept ${f}`)
      } else if (mine !== undefined && mine === written[f]) {
        writeFileSync(to, pack)
        written[f] = packDigest
        cli.out(`updated ${f}`)
      } else cli.out(mine === undefined ? `kept ${f}` : `kept ${f} (differs from the pack's: ${join(dir, f)})`)
      continue
    }
    writeFileSync(to, pack, { flag: 'wx' })
    written[f] = packDigest
    cli.out(`wrote ${f}`)
    if (f !== 'AGENTS.md') continue
    const claude = join(cli.cwd, 'CLAUDE.md')
    if (!present(claude)) {
      symlinkSync('AGENTS.md', claude)
      cli.out('wrote CLAUDE.md -> AGENTS.md')
    } else if (!(lstatSync(claude).isSymbolicLink() && readlinkSync(claude) === 'AGENTS.md')) cli.out('kept CLAUDE.md (not linked to AGENTS.md: claude-code agents do not read it)')
  }
  if (files.length) writeFileSync(record, `${JSON.stringify(written, null, 2)}\n`)
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
  const global = yamlFiles(join(dir, 'global'))
  const namespaced = yamlFiles(join(dir, 'namespaced'))
  const code = await withEngine(cli, async (engine) => {
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
  // after the pack applied: a pack that fails leaves no files behind
  if (code === 0) placeFiles(cli, join(dir, 'files'))
  return code
}
