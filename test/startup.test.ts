import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { boundPort, freePort } from './helpers.ts'

/**
 * The bin as a lifecycle, spawned for real: it refuses a port that is taken, and
 * it goes down on a signal rather than being killed by it — which is what
 * `bin/persimmon.js` exiting with the code `run(argv)` returned amounts to from
 * outside. The handshake itself — the probe, the registration, the address — is
 * `test/cli.test.ts`'s, in-process; what the bin prints per workspace is
 * `test/host.test.ts`'s.
 */

const ENTRY = new URL('../bin/persimmon.js', import.meta.url).pathname

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * A home directory of this test's own: the registry is derived from it
 * (design-00003 §2), and no test may write into the developer's own.
 */
function makeHome(): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'wb-home-')))
  made.push(home)
  return home
}

describe('starting the board', () => {
  // spec-00011-AC-15.2 through the bin: the holder never answers, so the probe
  // reads the port as taken and the command refuses rather than starting a
  // second process on it. The EADDRINUSE backstop behind the probe
  // (spec-00011-AC-15.5, spec-00012-AC-3.3) is `test/cli.test.ts`'s — it needs a
  // probe that answers «free» about a port that is not, which no real holder can
  // be made to do.
  it('reports a port it cannot have instead of crashing', async () => {
    const port = await freePort()
    // On loopback, where the board binds: a wildcard holder would leave the port
    // still bindable there, so the test would assert a refusal of a port the
    // process could in fact have had (issue-00028). Waited for, since a named
    // bind lands a tick later and `spawnSync` blocks this event loop.
    const held = createServer().listen(port, '127.0.0.1')
    await boundPort(held)

    const result = spawnSync(process.execPath, [ENTRY], {
      encoding: 'utf8',
      env: { ...process.env, HOME: makeHome(), PORT: String(port) },
      timeout: 20_000,
    })
    held.close()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`port ${port} is already in use`)
    expect(result.stdout).not.toContain('http://localhost')
  })

  /**
   * spec-00012-AC-4.2 and spec-00003-AC-9.3 through the bin, and no further: a
   * normal signal is handled rather than killing the board where it stands, so
   * there is a shutdown to run at all — the exit is the command's own, code 0
   * and no signal. What the shutdown then does per session is the Board's,
   * proved at that level in server.test.ts; nothing is running here to wrap up.
   */
  it('handles SIGTERM itself instead of being killed by it', async () => {
    const port = await freePort()
    const child = spawn(process.execPath, [ENTRY], {
      env: { ...process.env, HOME: makeHome(), PORT: String(port) },
    })

    // Only once it is listening: a signal before that has no server to close.
    await new Promise((resolve) => child.stdout.once('data', resolve))
    child.kill('SIGTERM')

    const ended = await new Promise<[number | null, string | null]>((resolve) => {
      child.on('exit', (code, signal) => resolve([code, signal]))
    })
    expect(ended).toEqual([0, null])
  }, 20_000)
})
