// Skill bundles for agent Adapters (15-prompt-skill.md): fetch `source` at `version`, verify `digest`, hand back a directory.
// Digest contract for a directory: sha256 over every regular file in sorted posix-path order, each as `<path>\0<bytes>\0`;
// anything that is not a regular file or a directory (a symlink, a device) is refused, so the digest pins what the agent reads.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
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
    const st = lstatSync(join(root, rel))
    if (st.isDirectory()) out.push(...walk(root, rel))
    else if (st.isFile()) out.push(rel)
    else throw new AdapterError('invalid_input', `skill bundle: ${rel} is not a regular file`, false)
  }
  return out
}

// git takes any argument as an option or a transport; only these shapes reach it (ext:: and leading dashes never do)
const remoteOk = (r) => typeof r === 'string' && (/^(https?|ssh|git|file):\/\/[^\s]+$/.test(r) || /^[\w.-]+@[\w.-]+:[^\s]+$/.test(r) || (isAbsolute(r) && !r.includes('\0')))
const versionOk = (v) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,127}$/.test(v)
const publicRemote = (r) => r.replace(/\/\/[^@\/]+@/, '//')

/** Skill (name, source, digest) → verified cached directory under `<cacheRoot>`: git by (remote, version), file by digest; written atomically. A `file` path resolves against `cwd`. */
export function fetchSkill(entry, cacheRoot, cwd = process.cwd()) {
  const { source, digest, name } = entry
  let dir, base
  if (source.provider === 'git') {
    const { remote, path } = source.locator ?? {}
    if (!remoteOk(remote)) throw new AdapterError('invalid_input', `skill ${name}: locator.remote must be an https, ssh, git or file URL, scp-style, or an absolute path`, false)
    if (!versionOk(source.version)) throw new AdapterError('invalid_input', `skill ${name}: version must be a commit or ref name`, false)
    base = join(cacheRoot, createHash('sha256').update(`${remote}\0${source.version}`).digest('hex').slice(0, 16))
    if (!existsSync(base)) {
      mkdirSync(cacheRoot, { recursive: true })
      const tmp = mkdtempSync(join(cacheRoot, 'fetch-'))
      try {
        const git = (...args) => execFileSync('git', args, { cwd: tmp, stdio: ['ignore', 'ignore', 'pipe'], timeout: 300_000 })
        git('init', '-q')
        git('-c', 'protocol.ext.allow=never', 'fetch', '-q', '--depth', '1', remote, source.version)
        git('checkout', '-q', 'FETCH_HEAD')
        renameSync(tmp, base) // a half-fetched checkout never becomes the cache entry
      } catch (e) {
        rmSync(tmp, { recursive: true, force: true })
        if (e instanceof AdapterError) throw e
        const line = String(e.stderr ?? e.message).trim().split('\n').pop() ?? ''
        throw new AdapterError('transient_network', `skill ${name}: git fetch of ${publicRemote(remote)} failed: ${line.split(remote).join(publicRemote(remote))}`, true)
      }
    }
    dir = path ? resolve(base, path) : base
  } else if (source.provider === 'file') {
    base = cwd
    dir = resolve(base, source.locator?.path ?? '')
  } else {
    throw new AdapterError('invalid_input', `skill ${name}: provider ${source.provider} is not supported`, false)
  }
  if (!existsSync(dir)) throw new AdapterError('invalid_input', `skill ${name}: ${relative(base, dir) || '.'} is not in the bundle`, false)
  const real = realpathSync(dir)
  if (relative(realpathSync(base), real).startsWith('..') || !lstatSync(real).isDirectory()) throw new AdapterError('invalid_input', `skill ${name}: locator.path leaves the bundle`, false)
  const actual = skillDigest(real)
  if (actual !== digest) throw new AdapterError('skill_digest_mismatch', `skill ${name}: bundle digest ${actual} differs from ${digest}`, false)
  if (source.provider !== 'file') return real.split(sep).join(posix.sep)
  // a file bundle is copied into the cache under its digest, so the agent reads the bytes that were verified, not a directory being edited
  const pinned = join(cacheRoot, `file-${digest.slice(7, 23)}`)
  if (!existsSync(pinned)) {
    mkdirSync(cacheRoot, { recursive: true })
    const tmp = mkdtempSync(join(cacheRoot, 'copy-'))
    cpSync(real, tmp, { recursive: true })
    renameSync(tmp, pinned)
  }
  if (skillDigest(pinned) !== digest) throw new AdapterError('skill_digest_mismatch', `skill ${name}: cached bundle ${pinned} is damaged; remove it`, false)
  return pinned.split(sep).join(posix.sep)
}
