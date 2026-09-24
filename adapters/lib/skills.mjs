// Skill bundles for agent Adapters (15-prompt-skill.md): fetch `source` at `version`, verify `digest`, hand back a directory.
// Digest contract for a directory: sha256 over every regular file in sorted posix-path order, each as `<path>\0<bytes>\0`.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, posix, relative, resolve, sep } from 'node:path'
import { AdapterError } from './agent.mjs'

export function skillDigest(dir) {
  const h = createHash('sha256')
  for (const file of walk(dir).sort()) h.update(`${file}\0`).update(readFileSync(join(dir, file))).update('\0')
  return `sha256:${h.digest('hex')}`
}

function walk(root, sub = '') {
  const out = []
  for (const e of readdirSync(join(root, sub), { withFileTypes: true })) {
    if (e.name === '.git') continue
    const rel = sub ? `${sub}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...walk(root, rel))
    else if (e.isFile()) out.push(rel)
  }
  return out
}

/** Resolved skill context entry → local directory; cached under `<cacheRoot>/<hash>` by (remote, version). */
export function fetchSkill(entry, cacheRoot) {
  const { source, digest, name } = entry
  let dir
  if (source.provider === 'git') {
    const { remote, path } = source.locator
    if (!remote || !source.version) throw new AdapterError('invalid_input', `skill ${name}: git source needs locator.remote and version`, false)
    const checkout = join(cacheRoot, createHash('sha256').update(`${remote}\0${source.version}`).digest('hex').slice(0, 16))
    if (!existsSync(join(checkout, '.git'))) {
      mkdirSync(checkout, { recursive: true })
      try {
        const git = (...args) => execFileSync('git', args, { cwd: checkout, stdio: ['ignore', 'ignore', 'pipe'] })
        git('init', '-q')
        git('fetch', '-q', '--depth', '1', remote, source.version)
        git('checkout', '-q', 'FETCH_HEAD')
      } catch (e) {
        throw new AdapterError('transient_network', `skill ${name}: git fetch failed: ${String(e.stderr ?? e.message).trim().split('\n').pop()}`, true)
      }
    }
    dir = path ? resolve(checkout, path) : checkout
    if (relative(checkout, dir).startsWith('..')) throw new AdapterError('invalid_input', `skill ${name}: locator.path escapes the repository`, false)
  } else if (source.provider === 'file') {
    dir = resolve(process.cwd(), source.locator.path ?? '')
  } else {
    throw new AdapterError('invalid_input', `skill ${name}: provider ${source.provider} is not supported`, false)
  }
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new AdapterError('invalid_input', `skill ${name}: ${dir} is not a directory`, false)
  const actual = skillDigest(dir)
  if (actual !== digest) throw new AdapterError('skill_digest_mismatch', `skill ${name}: bundle digest ${actual} differs from ${digest}`, false)
  return dir.split(sep).join(posix.sep)
}
