import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { Cli } from './context.js'
import { init } from './init.js'

/** The Scaffold registry (42-scaffold.md): where each (lang, framework) lives and the coordinates `new` renames. */
const scaffolds: Record<string, { repo: string; path: string; group: string; artifact: string; pkg: string }> = {
  'java/ddd': { repo: 'https://github.com/ryan-alexander-zhang/persimmon-java-ddd.git', path: 'scaffold', group: 'com.example', artifact: 'ordering-service', pkg: 'com.example.ordering' },
}

export interface NewOptions {
  lang: string | undefined
  framework: string | undefined
  group: string | undefined
  from: string | undefined
}

/** `persimmon new <dir> --lang <l> --framework <f> [--group <g>] [--from <path>]`: copy the Scaffold, rename its coordinates, `init` inside (42-scaffold.md). */
export async function newProject(cli: Cli, dir: string, o: NewOptions): Promise<number> {
  const key = `${o.lang ?? ''}/${o.framework ?? ''}`
  const scaffold = scaffolds[key]
  if (!o.lang || !o.framework || !scaffold) throw new Error(`new: --lang and --framework name one of ${Object.keys(scaffolds).map((k) => `--lang ${k.split('/')[0]} --framework ${k.split('/')[1]}`).join(', ')}, not ${JSON.stringify(key)}`)
  const target = resolve(cli.cwd, dir)
  if (existsSync(target) && readdirSync(target).length) throw new Error(`new: ${dir} exists and is not empty`)
  const artifact = basename(target)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(artifact)) throw new Error(`new: the directory name is the artifactId and must match [a-z0-9][a-z0-9-]*, not ${JSON.stringify(artifact)}`)
  const group = o.group ?? scaffold.group
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(group)) throw new Error(`new: --group must be a Java package name, not ${JSON.stringify(group)}`)
  const pkg = `${group}.${artifact.replace(/[^a-z0-9]/g, '')}`

  let tmp: string | undefined
  let source: string
  if (o.from !== undefined) {
    source = resolve(cli.cwd, o.from)
    if (!existsSync(source)) throw new Error(`new: no Scaffold at ${o.from}`)
  } else {
    tmp = mkdtempSync(join(tmpdir(), 'persimmon-new-'))
    try {
      execFileSync('git', ['clone', '--depth', '1', '--quiet', scaffold.repo, tmp], { stdio: ['ignore', 'ignore', 'pipe'] })
    } catch (e) {
      rmSync(tmp, { recursive: true, force: true })
      throw new Error(`new: could not clone ${scaffold.repo} (git on the PATH and network needed, or --from <path>): ${(e as Error).message.trim()}`)
    }
    source = join(tmp, scaffold.path)
  }
  try {
    const files = readdirSync(source, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => relative(source, join(e.parentPath, e.name)))
      .filter((f) => !f.split(sep).some((part) => part === 'target' || part === '.git'))
      .sort()
    // longest first, so the package wins over the group it starts with
    const renames: [string, string][] = [[scaffold.pkg, pkg], [scaffold.group, group], [scaffold.artifact, artifact]]
    const pkgDir = scaffold.pkg.split('.').join(sep)
    const newPkgDir = pkg.split('.').join(sep)
    for (const f of files) {
      const to = join(target, f.split(pkgDir).join(newPkgDir))
      mkdirSync(dirname(to), { recursive: true })
      let text = readFileSync(join(source, f), 'utf8')
      for (const [from, replacement] of renames) text = text.split(from).join(replacement)
      writeFileSync(to, text, { flag: 'wx' })
    }
    cli.out(`wrote ${files.length} files into ${dir} (${group}:${artifact}, package ${pkg})`)
  } finally {
    if (tmp) rmSync(tmp, { recursive: true, force: true })
  }
  return await init({ ...cli, cwd: target })
}
