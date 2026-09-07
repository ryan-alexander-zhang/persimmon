import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ensureExecutable } from '../src/pty.ts'

/**
 * The executable bit on node-pty's spawn-helper used to be set by install
 * scripts alone, and `npx --package` runs none of them (issue-00030). The
 * precondition is now restored right before the spawn that needs it.
 */
describe('the spawn helper is made executable before it is used', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-pty-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('sets the bit on a helper an install left at 0644', () => {
    const helper = join(dir, 'spawn-helper')
    writeFileSync(helper, '#!/bin/sh\n')
    chmodSync(helper, 0o644)
    ensureExecutable(helper)
    expect(statSync(helper).mode & 0o777).toBe(0o755)
  })

  it('leaves a helper that is not there to node-pty', () => {
    expect(() => ensureExecutable(join(dir, 'missing'))).not.toThrow()
  })
})
