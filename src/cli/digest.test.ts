import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { skillDigest } from '../../adapters/lib/skills.mjs'
import { bundleDigest, digest } from './digest.js'

describe('persimmon digest', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-digest-'))
    mkdirSync(join(dir, 'skill', 'ref'), { recursive: true })
    writeFileSync(join(dir, 'skill', 'SKILL.md'), '# s\n')
    writeFileSync(join(dir, 'skill', 'ref', 'a.md'), 'a')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('computes the digest the Adapters verify', async () => {
    expect(bundleDigest(join(dir, 'skill'))).toBe(skillDigest(join(dir, 'skill'))) // one algorithm, two implementations
    const out: string[] = []
    expect(await digest({ cwd: dir, out: (l) => out.push(l), err: () => {} }, 'skill')).toBe(0)
    expect(out).toEqual([skillDigest(join(dir, 'skill'))])
    writeFileSync(join(dir, 'skill', 'ref', 'a.md'), 'b')
    expect(bundleDigest(join(dir, 'skill'))).not.toBe(out[0]) // every byte counts
    symlinkSync('/etc/hosts', join(dir, 'skill', 'link'))
    expect(() => bundleDigest(join(dir, 'skill'))).toThrow(/link is not a regular file/)
  })
})
