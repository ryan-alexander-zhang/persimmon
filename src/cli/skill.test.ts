import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fetchSkill, skillDigest } from '../../adapters/lib/skills.mjs'
import { runCli } from './index.js'

describe('persimmon skill install', () => {
  let dir: string
  let out: string[]
  let err: string[]
  const run = (...argv: string[]) => runCli(argv, { cwd: dir, out: (l) => out.push(l), err: (l) => err.push(l) })
  const file = (name: string, docs: unknown[]) => {
    const p = join(dir, name)
    writeFileSync(p, docs.map((d) => stringify(d)).join('---\n'))
    return p
  }
  const skillDoc = (spec: Record<string, unknown>) => ({ apiVersion: 'persimmon.ai/v1', kind: 'Skill', metadata: { name: 'prd-writer' }, spec })
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-skill-'))
    out = []
    err = []
    mkdirSync(join(dir, 'app'))
    expect(await run('init')).toBe(0)
    out = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('copies a verified file bundle into both native skill directories; a wrong digest installs nothing', async () => {
    mkdirSync(join(dir, 'skills', 'prd-writer'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'prd-writer', 'SKILL.md'), '# PRD writer\n')
    const digest = skillDigest(join(dir, 'skills', 'prd-writer'))
    expect(await run('apply', file('s.yaml', [skillDoc({ source: { provider: 'file', type: 'directory', id: 'x', locator: { path: 'skills/prd-writer' }, version: '1' }, digest, format: 'claude-code-skill/v1' })]))).toBe(0)
    out = []
    const code = await run('skill', 'install', 'prd-writer', '--into', 'app')
    expect([code, err]).toEqual([0, []])
    expect(out).toEqual(['installed Skill/prd-writer into app/.agents/skills/prd-writer', 'installed Skill/prd-writer into app/.claude/skills/prd-writer'])
    for (const d of ['.agents/skills', '.claude/skills']) expect(readFileSync(join(dir, 'app', d, 'prd-writer', 'SKILL.md'), 'utf8')).toBe('# PRD writer\n')
    expect(readdirSync(join(dir, '.persimmon', 'skills')).some((h) => h.startsWith('file-'))).toBe(true) // the cache keeps the verified copy
    // the source changes without a new digest: install refuses, the workspace copy stays as reviewed
    writeFileSync(join(dir, 'skills', 'prd-writer', 'SKILL.md'), '# edited\n')
    expect(await run('skill', 'install', 'prd-writer', '--into', 'app', '--for', 'claude')).toBe(1)
    expect(err.at(-1)).toMatch(/skill_digest_mismatch|differs from/)
    expect(readFileSync(join(dir, 'app', '.claude', 'skills', 'prd-writer', 'SKILL.md'), 'utf8')).toBe('# PRD writer\n')
    expect(readFileSync(join(dir, '.persimmon', 'skills', `file-${digest.slice(7, 23)}`, 'SKILL.md'), 'utf8')).toBe('# PRD writer\n') // the cache keeps the reviewed bytes
    // new digest applied: reinstall replaces the copy
    expect(await run('apply', file('s.yaml', [skillDoc({ source: { provider: 'file', type: 'directory', id: 'x', locator: { path: 'skills/prd-writer' }, version: '2' }, digest: skillDigest(join(dir, 'skills', 'prd-writer')), format: 'claude-code-skill/v1' })]))).toBe(0)
    expect(await run('skill', 'install', 'prd-writer', '--into', 'app', '--for', 'claude')).toBe(0)
    expect(readFileSync(join(dir, 'app', '.claude', 'skills', 'prd-writer', 'SKILL.md'), 'utf8')).toBe('# edited\n')
    expect(readFileSync(join(dir, 'app', '.agents', 'skills', 'prd-writer', 'SKILL.md'), 'utf8')).toBe('# PRD writer\n') // --for claude left codex alone
    expect(await run('skill', 'install', 'nope', '--into', 'app')).toBe(1)
    expect(await run('skill', 'install', 'prd-writer')).toBe(1) // --into required
    expect(await run('skill', 'install', 'prd-writer', '--into', 'app', '--for', 'toString')).toBe(1)
    // a hand-made directory under the same name is never replaced silently
    rmSync(join(dir, 'app', '.claude', 'skills', 'prd-writer'), { recursive: true })
    mkdirSync(join(dir, 'app', '.claude', 'skills', 'prd-writer'), { recursive: true })
    writeFileSync(join(dir, 'app', '.claude', 'skills', 'prd-writer', 'SKILL.md'), '# mine\n')
    expect(await run('skill', 'install', 'prd-writer', '--into', 'app', '--for', 'claude')).toBe(1)
    expect(err.at(-1)).toMatch(/is not a persimmon install; --force replaces it/)
    expect(readFileSync(join(dir, 'app', '.claude', 'skills', 'prd-writer', 'SKILL.md'), 'utf8')).toBe('# mine\n')
    expect(await run('skill', 'install', 'prd-writer', '--into', 'app', '--for', 'claude', '--force')).toBe(0)
    expect(readFileSync(join(dir, 'app', '.claude', 'skills', 'prd-writer', 'SKILL.md'), 'utf8')).toBe('# edited\n')
  })

  it('fetches a git bundle at its commit and never hands git an option or a transport', async () => {
    const repo = mkdtempSync(join(tmpdir(), 'persimmon-skill-repo-'))
    mkdirSync(join(repo, 'prd-writer'))
    writeFileSync(join(repo, 'prd-writer', 'SKILL.md'), '# PRD writer\nOne requirement per line.\n')
    const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).toString().trim()
    git('init', '-q')
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'skill')
    const sha = git('rev-parse', 'HEAD')
    const digest = skillDigest(join(repo, 'prd-writer'))
    const source = (over: Record<string, unknown> = {}, version = sha) => ({ provider: 'git', type: 'repository', id: 'skills', locator: { remote: repo, path: 'prd-writer', ...over }, version })
    const install = async (spec: Record<string, unknown>) => {
      expect(await run('apply', file('s.yaml', [skillDoc(spec)]))).toBe(0)
      out = []
      return run('skill', 'install', 'prd-writer', '--into', 'app', '--for', 'claude')
    }
    expect(await install({ source: source(), digest, format: 'claude-code-skill/v1' })).toBe(0)
    expect(readFileSync(join(dir, 'app', '.claude', 'skills', 'prd-writer', 'SKILL.md'), 'utf8')).toContain('PRD writer')
    expect(readdirSync(join(dir, '.persimmon', 'skills')).filter((h) => /^[0-9a-f]{16}$/.test(h))).toHaveLength(1) // cached by (remote, version)
    expect(await install({ source: source(), digest: 'sha256:' + 'c'.repeat(64), format: 'claude-code-skill/v1' })).toBe(1)
    expect(err.at(-1)).toMatch(/differs from/)
    for (const bad of [{ remote: "ext::sh -c 'touch /tmp/pwned'" }, { remote: '--upload-pack=touch /tmp/pwned' }, { path: '../..' }]) {
      expect(await install({ source: source(bad), digest, format: 'claude-code-skill/v1' }), JSON.stringify(bad)).toBe(1)
    }
    expect(await install({ source: source({}, '--upload-pack=x'), digest, format: 'claude-code-skill/v1' })).toBe(1)
    // a symlink in the bundle is refused, so the digest pins every byte the agent reads
    symlinkSync('/etc/hosts', join(repo, 'prd-writer', 'hosts'))
    git('add', '.')
    git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'link')
    expect(await install({ source: source({}, git('rev-parse', 'HEAD')), digest, format: 'claude-code-skill/v1' })).toBe(1)
    expect(err.at(-1)).toMatch(/hosts is not a regular file/)
    // an unreachable remote leaves no half checkout behind
    expect(await install({ source: source({ remote: join(repo, 'nope') }), digest, format: 'claude-code-skill/v1' })).toBe(1)
    expect(readdirSync(join(dir, '.persimmon', 'skills')).filter((d) => d.startsWith('fetch-'))).toEqual([])
    expect(() => fetchSkill({ name: 'x', source: source({ remote: join(repo, 'nope') }), digest }, join(dir, '.persimmon', 'skills'), dir)).toThrow(expect.objectContaining({ code: 'transient_network', retryable: true })) // the one retryable fetch error
    expect(existsSync(join(dir, 'app', '.claude', 'skills', 'prd-writer', 'hosts'))).toBe(false)
    rmSync(repo, { recursive: true, force: true })
  })
})
