import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { DirectoryPicker, type SpawnPicker } from '../src/directoryPicker.ts'

/**
 * The three outcomes of spec-00011-FR-22 … FR-24, read off a fake `osascript`
 * so no dialog opens on anybody's screen. The strings are the ones measured on
 * macOS: a picked path carries a trailing slash, and a cancel exits non-zero
 * with `-128` in its stderr.
 */
function picker(run: (child: FakeChild) => void): DirectoryPicker {
  const spawnPicker: SpawnPicker = () => {
    const child = new FakeChild()
    queueMicrotask(() => run(child))
    return child as never
  }
  return new DirectoryPicker(spawnPicker)
}

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = false
  kill(): boolean {
    this.killed = true
    this.emit('close', null)
    return true
  }
  end(code: number, out = '', err = ''): void {
    if (out) this.stdout.write(out)
    if (err) this.stderr.write(err)
    setTimeout(() => this.emit('close', code), 0)
  }
}

describe('the native directory picker', () => {
  const macOnly = process.platform === 'darwin' ? it : it.skip

  // spec-00011-AC-22.1
  macOnly('gives back the chosen directory without its trailing separator', async () => {
    const picked = await picker((child) => child.end(0, '/Users/ryan/GitHubProjects/persimmon/\n')).pick()
    expect(picked).toEqual({ kind: 'picked', path: '/Users/ryan/GitHubProjects/persimmon' })
  })

  // spec-00011-AC-22.2: stripping the root's separator would leave no path at all.
  macOnly('leaves the root as the root', async () => {
    expect(await picker((child) => child.end(0, '/\n')).pick()).toEqual({ kind: 'picked', path: '/' })
  })

  // spec-00011-AC-23.1, AC-23.3: cancel is not a failure.
  macOnly('reads the cancel code as a cancel, not an error', async () => {
    const picked = await picker((child) => child.end(1, '', '15:57: execution error: User canceled. (-128)\n')).pick()
    expect(picked).toEqual({ kind: 'cancelled' })
  })

  // spec-00011-AC-24.1: every other non-zero exit is «cannot open here».
  macOnly('reads any other failure as one it cannot open', async () => {
    const picked = await picker((child) => child.end(1, '', 'execution error: No user interaction allowed. (-1713)\n')).pick()
    expect(picked.kind).toBe('unavailable')
  })

  // A picker that never starts (no osascript) is the same answer, not a throw.
  macOnly('reads a spawn that never started as one it cannot open', async () => {
    const picked = await picker((child) => child.emit('error', new Error('spawn osascript ENOENT'))).pick()
    expect(picked).toEqual({ kind: 'unavailable', error: expect.stringContaining('ENOENT') })
  })

  // spec-00011-AC-22.4's server-side half: the picker knows it is busy.
  macOnly('is busy only while a dialog is open', async () => {
    const open = picker((child) => setTimeout(() => child.end(0, '/tmp/\n'), 5))
    expect(open.busy).toBe(false)
    const picking = open.pick()
    expect(open.busy).toBe(true)
    await picking
    expect(open.busy).toBe(false)
  })

  it('answers «cannot open» off this platform without starting anything', async () => {
    if (process.platform === 'darwin') return
    const never = new DirectoryPicker(() => {
      throw new Error('should not spawn')
    })
    expect((await never.pick()).kind).toBe('unavailable')
  })
})
