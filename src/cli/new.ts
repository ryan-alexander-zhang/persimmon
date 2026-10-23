import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import type { Cli } from './context.js'
import { init } from './init.js'

/** The Scaffold registry (42-scaffold.md): where each (lang, framework) lives, the coordinates `new` renames, and the empty context `--context` copies. */
const scaffolds: Record<string, { repo: string; path: string; group: string; artifact: string; pkg: string; contextTemplate: string }> = {
  'java/ddd': { repo: 'https://github.com/ryan-alexander-zhang/persimmon-java-ddd.git', path: 'scaffold', group: 'com.example', artifact: 'example-app', pkg: 'com.example.app', contextTemplate: '_context' },
}

export interface NewOptions {
  lang: string | undefined
  framework: string | undefined
  group: string | undefined
  from: string | undefined
  context: string | undefined
}

/**
 * `persimmon new <dir> --lang <l> --framework <f> [--group <g>] [--from <path>]`: copy the Scaffold, rename its coordinates, `init` inside.
 * `persimmon new --context <name> [--lang --framework] [--from <path>]`: add an empty bounded context to the project in `cwd` (42-scaffold.md).
 */
export async function newProject(cli: Cli, dir: string | undefined, o: NewOptions): Promise<number> {
  const key = `${o.lang ?? 'java'}/${o.framework ?? 'ddd'}`
  const scaffold = scaffolds[key]
  if (!scaffold) throw new Error(`new: --lang and --framework name one of ${Object.keys(scaffolds).map((k) => `--lang ${k.split('/')[0]} --framework ${k.split('/')[1]}`).join(', ')}, not ${JSON.stringify(key)}`)
  if (o.context !== undefined) return withSource(cli, scaffold, o.from, (source) => addContext(cli, join(source, scaffold.contextTemplate), o.context!))
  if (!dir) throw new Error('new: <dir> required, or --context <name> inside a project')
  if (!o.lang || !o.framework) throw new Error('new: --lang and --framework are required for a new project')
  const target = resolve(cli.cwd, dir)
  if (existsSync(target) && readdirSync(target).length) throw new Error(`new: ${dir} exists and is not empty`)
  const artifact = basename(target)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(artifact)) throw new Error(`new: the directory name is the artifactId and must match [a-z0-9][a-z0-9-]*, not ${JSON.stringify(artifact)}`)
  const group = o.group ?? scaffold.group
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(group)) throw new Error(`new: --group must be a Java package name, not ${JSON.stringify(group)}`)
  const pkg = `${group}.${artifact.replace(/[^a-z0-9]/g, '')}`
  await withSource(cli, scaffold, o.from, (source) => {
    // longest first, so the package wins over the group it starts with; the context template is not part of a project
    const renames: [string, string][] = [[scaffold.pkg, pkg], [scaffold.group, group], [scaffold.artifact, artifact]]
    const n = copyTree(source, target, (f) => f.split(sep)[0] !== scaffold.contextTemplate, renames, [[scaffold.pkg.split('.').join(sep), pkg.split('.').join(sep)]])
    cli.out(`wrote ${n} files into ${dir} (${group}:${artifact}, package ${pkg})`)
    return 0
  })
  return await init({ ...cli, cwd: target })
}

/** The project in `cwd` gets `<name>/` from the template, registered in the root pom and in `start/pom.xml` at their `<!-- contexts -->` markers. */
function addContext(cli: Cli, template: string, name: string): number {
  if (!/^[a-z][a-z0-9]*$/.test(name)) throw new Error(`new: --context is a package segment and must match [a-z][a-z0-9]*, not ${JSON.stringify(name)}`)
  if (!existsSync(template)) throw new Error(`new: the Scaffold has no context template at ${template}`)
  const rootPom = join(cli.cwd, 'pom.xml')
  const startPom = join(cli.cwd, 'start', 'pom.xml')
  const marker = '    <!-- contexts -->\n'
  const root = existsSync(rootPom) ? readFileSync(rootPom, 'utf8') : ''
  const start = existsSync(startPom) ? readFileSync(startPom, 'utf8') : ''
  if (!root.includes(marker) || !start.includes(marker)) throw new Error(`new: ${cli.cwd} is not a project made by persimmon new (no ${marker.trim()} marker in pom.xml and start/pom.xml)`)
  if (existsSync(join(cli.cwd, name))) throw new Error(`new: ${name}/ exists`)
  const own = root.slice(root.indexOf('</parent>'))
  const group = /<groupId>([^<]+)<\/groupId>/.exec(own)?.[1]
  const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(own)?.[1]
  const application = readdirSync(join(cli.cwd, 'start', 'src', 'main', 'java'), { recursive: true, withFileTypes: true }).find((e) => e.isFile() && e.name === 'Application.java')
  const pkg = application && /^package ([\w.]+);/m.exec(readFileSync(join(application.parentPath, application.name), 'utf8'))?.[1]
  if (!group || !artifact || !pkg) throw new Error('new: cannot read the project\'s groupId, artifactId and root package (pom.xml, start/**/Application.java)')
  const renames: [string, string][] = [['__context__', name], ['__group__', group], ['__artifact__', artifact], ['__package__', pkg]]
  const n = copyTree(template, join(cli.cwd, name), () => true, renames, [['__package__', pkg.split('.').join(sep)], ['__context__', name]])
  writeFileSync(rootPom, root.replace(marker, `    <module>${name}</module>\n${marker}`))
  const dep = (m: string) => `    <dependency>\n      <groupId>${group}</groupId>\n      <artifactId>${name}-${m}</artifactId>\n      <version>\${project.version}</version>\n    </dependency>\n`
  writeFileSync(startPom, start.replace(marker, `${dep('infrastructure')}${dep('adapter')}${marker}`))
  cli.out(`added context ${name} (${n} files); pom.xml lists it and start depends on ${name}-infrastructure and ${name}-adapter`)
  return 0
}

/** Copies the regular files below `source` into `target` (`target/` and `.git/` left out), renaming text and path segments. */
function copyTree(source: string, target: string, keep: (f: string) => boolean, renames: [string, string][], pathRenames: [string, string][]): number {
  const files = readdirSync(source, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(source, join(e.parentPath, e.name)))
    .filter((f) => keep(f) && !f.split(sep).some((part) => part === 'target' || part === '.git'))
    .sort()
  for (const f of files) {
    let path = f
    for (const [from, replacement] of pathRenames) path = path.split(from).join(replacement)
    const to = join(target, path)
    mkdirSync(dirname(to), { recursive: true })
    let text = readFileSync(join(source, f), 'utf8')
    for (const [from, replacement] of renames) text = text.split(from).join(replacement)
    writeFileSync(to, text, { flag: 'wx' })
  }
  return files.length
}

/** The Scaffold's files: `--from <path>` as they are, else a shallow clone removed afterwards. */
async function withSource(cli: Cli, scaffold: (typeof scaffolds)[string], from: string | undefined, use: (source: string) => number): Promise<number> {
  if (from !== undefined) {
    const source = resolve(cli.cwd, from)
    if (!existsSync(source)) throw new Error(`new: no Scaffold at ${from}`)
    return use(source)
  }
  const tmp = mkdtempSync(join(tmpdir(), 'persimmon-new-'))
  try {
    execFileSync('git', ['clone', '--depth', '1', '--quiet', scaffold.repo, tmp], { stdio: ['ignore', 'ignore', 'pipe'] })
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true })
    throw new Error(`new: could not clone ${scaffold.repo} (git on the PATH and network needed, or --from <path>): ${(e as Error).message.trim()}`)
  }
  try {
    return use(join(tmp, scaffold.path))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
