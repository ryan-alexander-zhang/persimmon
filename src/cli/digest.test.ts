import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { skillDigest } from '../../adapters/lib/skills.mjs'
import { digest } from './digest.js'

describe('persimmon digest', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-digest-'))
    mkdirSync(join(dir, 'skill', 'ref'), { recursive: true })
    writeFileSync(join(dir, 'skill', 'SKILL.md'), '# s\n')
    writeFileSync(join(dir, 'skill', 'ref', 'a.md'), 'a')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('prints the digest the Adapters verify', async () => {
    const out: string[] = []
    expect(await digest({ cwd: dir, out: (l) => out.push(l), err: () => {} }, 'skill')).toBe(0)
    expect(out).toEqual([skillDigest(join(dir, 'skill'))]) // the same function the Adapters call
    writeFileSync(join(dir, 'skill', 'ref', 'a.md'), 'b')
    expect(skillDigest(join(dir, 'skill'))).not.toBe(out[0]) // every byte counts
    symlinkSync('/etc/hosts', join(dir, 'skill', 'link'))
    await expect(digest({ cwd: dir, out: () => {}, err: () => {} }, 'skill')).rejects.toThrow(/link is not a regular file/)
  })
})
