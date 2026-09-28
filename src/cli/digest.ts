// `persimmon digest <dir>`: the bundle digest a Skill declares (15-prompt-skill.md), computed the way the Adapters verify it.
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Cli } from './context.js'

/** sha256 over every regular file in sorted posix-path order, each as `<path>\0<bytes>\0`, `.git` excluded; anything else in the bundle is refused. */
export function bundleDigest(dir: string): string {
  const h = createHash('sha256')
  for (const file of walk(dir).sort()) h.update(`${file}\0`).update(readFileSync(join(dir, file))).update('\0')
  return `sha256:${h.digest('hex')}`
}

function walk(root: string, sub = ''): string[] {
  const out: string[] = []
  for (const e of readdirSync(join(root, sub), { withFileTypes: true })) {
    if (e.name === '.git') continue
    const rel = sub ? `${sub}/${e.name}` : e.name
    const st = lstatSync(join(root, rel))
    if (st.isDirectory()) out.push(...walk(root, rel))
    else if (st.isFile()) out.push(rel)
    else throw new Error(`${rel} is not a regular file; a Skill bundle holds files and directories only`)
  }
  return out
}

export async function digest(cli: Cli, dir: string): Promise<number> {
  cli.out(bundleDigest(resolve(cli.cwd, dir)))
  return 0
}
