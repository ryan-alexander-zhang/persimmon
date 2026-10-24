import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Resource } from '../resource/types.js'
import { digestOf } from '../snapshot/canonical.js'
import { applyDocs } from './apply.js'
import type { Cli } from './context.js'
import { withEngine } from './context.js'
import { loadDocs } from './io.js'
import { skillDirs } from './skill.js'

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

/** `.persimmon/files.json`: file name → digest init wrote; unreadable or not an object is empty, so every file counts as unrecorded and is kept */
function readRecord(path: string): Record<string, string> {
  try {
    const r: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return r && typeof r === 'object' && !Array.isArray(r) ? (r as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** The pack's `files/` into the project when absent, or over one init wrote that nobody edited (its digest in `.persimmon/files.json`); `CLAUDE.md` links to an `AGENTS.md` init wrote (20-pack.md). */
function placeFiles(cli: Cli, dir: string, claimed: Set<string>): void {
  // regular files at any depth, by their path below files/; a dotfile (.DS_Store) is not a project file, a dot directory (.claude/) holds them
  const files = existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.')).map((e) => relative(dir, join(e.parentPath, e.name))).sort() : []
  const record = join(cli.cwd, '.persimmon', 'files.json')
  const written = readRecord(record)
  const before = JSON.stringify(written)
  for (const f of files) {
    // the record knows a digest, not a pack: a file an earlier pack ships stays that pack's
    if (claimed.has(f)) {
      cli.out(`kept ${f} (an earlier pack's)`)
      continue
    }
    claimed.add(f)
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
    mkdirSync(dirname(to), { recursive: true })
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
  if (JSON.stringify(written) !== before) writeFileSync(record, `${JSON.stringify(written, null, 2)}\n`)
  const ignore = join(cli.cwd, '.gitignore')
  const text = existsSync(ignore) ? readFileSync(ignore, 'utf8') : ''
  if (text.split('\n').some((l) => l.trim().replace(/^\//, '').replace(/\/$/, '') === '.persimmon')) return
  appendFileSync(ignore, `${text && !text.endsWith('\n') ? '\n' : ''}.persimmon/\n`)
  cli.out('ignored .persimmon/ in .gitignore')
}

/** Every regular file below `dir` (dotfiles aside) is one init wrote, by the record: then the directory is init's to replace. */
function writtenByInit(dir: string, prefix: string, written: Record<string, string>): boolean {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile() && !e.name.startsWith('.'))
  return files.length > 0 && files.every((e) => written[prefix + relative(dir, join(e.parentPath, e.name))] === digestOf(readFileSync(join(e.parentPath, e.name))))
}

/**
 * Every `skills/<name>/SKILL.md` in the project, whoever put it there, reaches each agent CLI through
 * a link `<agent dir>/<name> -> ../../skills/<name>`. A directory there that an older init wrote
 * (every file of it recorded) gives way to the link; anything else of the project's is kept (20-pack.md).
 */
function linkSkills(cli: Cli): void {
  const skills = join(cli.cwd, 'skills')
  if (!existsSync(skills)) return
  const names = readdirSync(skills, { withFileTypes: true }).filter((e) => e.isDirectory() && existsSync(join(skills, e.name, 'SKILL.md'))).map((e) => e.name).sort()
  const record = join(cli.cwd, '.persimmon', 'files.json')
  const written = readRecord(record)
  const before = JSON.stringify(written)
  for (const agentDir of Object.values(skillDirs).sort()) {
    for (const name of names) {
      const link = join(cli.cwd, agentDir, name)
      const target = relative(join(cli.cwd, agentDir), join(skills, name))
      const shown = `${agentDir}/${name}`
      if (present(link)) {
        const stat = lstatSync(link)
        if (stat.isSymbolicLink() && readlinkSync(link) === target) continue
        if (!(stat.isDirectory() && writtenByInit(link, `${shown}/`, written))) {
          cli.out(`kept ${shown} (not a link to skills/${name})`)
          continue
        }
        rmSync(link, { recursive: true })
        for (const k of Object.keys(written)) if (k.startsWith(`${shown}/`)) delete written[k]
        cli.out(`replaced ${shown} with a link to skills/${name}`)
      }
      mkdirSync(dirname(link), { recursive: true })
      symlinkSync(target, link)
      cli.out(`linked ${shown} -> ${target}`)
    }
  }
  if (JSON.stringify(written) !== before) writeFileSync(record, `${JSON.stringify(written, null, 2)}\n`)
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

/** `persimmon init --pack <name>`: the pack at `packs/<name>`, installed after the SDLC pack (20-pack.md). */
export function namedPackDir(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`--pack takes a pack's directory name under packs/, not ${JSON.stringify(name)}`)
  return join(root(), 'packs', name)
}

const keysOf = (dir: string) => new Set((loadDocs([...yamlFiles(join(dir, 'global')), ...yamlFiles(join(dir, 'namespaced'))]) as Resource[]).map((d) => `${d.kind}/${d.metadata.name}`))

/** `persimmon init`: create `.persimmon/`, a default `persimmon.yaml`, apply the SDLC pack, then `also` when given, place the packs' files, link `skills/` into the agent directories (20-pack.md). */
export async function init(cli: Cli, o: { pack?: string; also?: string } = {}): Promise<number> {
  if (o.also !== undefined) {
    if (yamlFiles(join(o.also, 'global')).length === 0) throw new Error(`no pack at ${o.also}`)
    // a second pack uses the first's definitions by name; redefining one would change the first pack under its users
    const first = keysOf(o.pack ?? packDir())
    const clash = [...keysOf(o.also)].filter((k) => first.has(k))
    if (clash.length) throw new Error(`${o.also} redefines ${clash.join(', ')} of the pack installed before it`)
  }
  mkdirSync(join(cli.cwd, '.persimmon', 'inbox'), { recursive: true })
  const cfg = join(cli.cwd, 'persimmon.yaml')
  if (!existsSync(cfg)) {
    writeFileSync(cfg, 'mode: local\nstore: {sqlite: .persimmon/persimmon.db}\nblobs: .persimmon/blobs\ndefaultNamespace: default\n')
    cli.out('wrote persimmon.yaml')
  }
  const dirs = [o.pack ?? packDir(), ...(o.also !== undefined ? [o.also] : [])]
  const code = await withEngine(cli, async (engine) => {
    const a = await applyDocs(cli, engine, shippedAdapters(), { global: true })
    for (const dir of dirs) {
      const global = yamlFiles(join(dir, 'global'))
      const namespaced = yamlFiles(join(dir, 'namespaced'))
      if (global.length === 0) {
        cli.out(`no pack at ${dir}`)
        return a
      }
      // a user Adapter may be installed after init, so its Executors may not resolve yet (13-executor.md apply rule, skipped here)
      const b = await applyDocs(cli, engine, loadDocs(global) as Resource[], { global: true, skipAdapterValidation: true })
      // the pack's Triggers listen in defaultNamespace; another Namespace applies them with -n
      const c = namespaced.length ? await applyDocs(cli, engine, loadDocs(namespaced) as Resource[], { namespace: engine.dispatch.defaultNamespace }) : 0
      if (a || b || c) return a || b || c
    }
    return a
  })
  // after every pack applied: a pack that fails leaves no files behind; the SDLC pack's first, so a file both ship is its
  const claimed = new Set<string>()
  if (code === 0) {
    for (const dir of dirs) placeFiles(cli, join(dir, 'files'), claimed)
    linkSkills(cli)
  }
  return code
}
