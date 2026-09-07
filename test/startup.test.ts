import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MINIMAL_CONFIG, boundPort, freePort, makeRepo } from './helpers.ts'

/**
 * The entry point as a lifecycle: it comes up on the port it is given, refuses a
 * port that is taken, and goes down on a signal rather than being killed by it.
 * What it prints per workspace and per subcommand is `test/cli.test.ts`'s.
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

/** Boot the board the way a user does: from somewhere on disk, on a port that is free. */
function boot(cwd: string, home: string, port: number) {
  return spawnSync(process.execPath, [ENTRY], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PORT: String(port) },
    timeout: 20_000,
  })
}

/** The board keeps running, so take its first line of output and stop it. */
function readFirstLine(cwd: string, home: string, port: number) {
  return spawnSync(
    process.execPath,
    [
      '-e',
      `const { spawn } = require('child_process');
       const child = spawn(process.execPath, [${JSON.stringify(ENTRY)}], { cwd: ${JSON.stringify(cwd)}, env: { ...process.env, HOME: ${JSON.stringify(home)}, PORT: ${JSON.stringify(String(port))} } });
       child.stdout.once('data', (data) => { process.stdout.write(data); child.kill(); process.exit(0) });
       child.stderr.on('data', (data) => process.stderr.write(data));
       child.on('exit', () => process.exit(1));`,
    ],
    { encoding: 'utf8', timeout: 20_000 },
  )
}

describe('starting the board', () => {
  // spec-00011-AC-13.4 — where spec-00001-AC-15.1 once refused the start: a cwd
  // in no project is an empty start, and the page carries the add entry point
  it('starts with no workspace when the cwd is in no project', async () => {
    const { repoRoot } = makeRepo({})
    made.push(repoRoot)
    const home = makeHome()
    const port = await freePort()

    const result = readFirstLine(repoRoot, home, port)

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(`persimmon: http://localhost:${port}/`)
    expect(existsSync(join(home, '.persimmon', 'workspaces.json'))).toBe(false)
  })

  // spec-00011-AC-15.2 at the entry point: the holder never answers the handshake
  it('reports a port it cannot have instead of crashing', async () => {
    const { repoRoot } = makeRepo({})
    made.push(repoRoot)
    writeFileSync(join(repoRoot, 'whiteboard.config.yaml'), MINIMAL_CONFIG)
    const port = await freePort()
    // On loopback, where the entry point binds: a wildcard holder would leave
    // the port still bindable there, so the test would assert a refusal of a
    // port the process could in fact have had (issue-00028). Waited for, since
    // a named bind lands a tick later and `boot()` blocks this event loop.
    const held = createServer().listen(port, '127.0.0.1')
    await boundPort(held)

    const result = boot(repoRoot, makeHome(), port)
    held.close()

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(`port ${port} is already in use`)
    expect(result.stdout).not.toContain('http://localhost')
  })

  /**
   * spec-00003-AC-9.3 at the entry point, and no further: a normal signal is
   * handled rather than killing the board where it stands, so there is a
   * shutdown to run at all — the exit is the host's own, code 0 and no signal.
   * What the shutdown then does per session is the Board's, proved at that level
   * in server.test.ts; nothing is running here to wrap up.
   */
  it('handles SIGTERM itself instead of being killed by it', async () => {
    const { repoRoot } = makeRepo({})
    made.push(repoRoot)
    writeFileSync(join(repoRoot, 'whiteboard.config.yaml'), MINIMAL_CONFIG)
    const home = makeHome()
    const port = await freePort()
    const child = spawn(process.execPath, [ENTRY], {
      cwd: repoRoot,
      env: { ...process.env, HOME: home, PORT: String(port) },
    })

    // Only once it is listening: a signal before that has no server to close.
    await new Promise((resolve) => child.stdout.once('data', resolve))
    child.kill('SIGTERM')

    const ended = await new Promise<[number | null, string | null]>((resolve) => {
      child.on('exit', (code, signal) => resolve([code, signal]))
    })
    expect(ended).toEqual([0, null])
  }, 20_000)

  // spec-00011-AC-13.1 at the entry point: the workspace it registered is in the address
  it('starts and reports its address on a valid config', async () => {
    const { repoRoot } = makeRepo({})
    made.push(repoRoot)
    writeFileSync(join(repoRoot, 'whiteboard.config.yaml'), MINIMAL_CONFIG)
    const home = makeHome()
    const port = await freePort()

    const result = readFirstLine(repoRoot, home, port)

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toMatch(new RegExp(`^persimmon: http://localhost:${port}/w/[a-z0-9-]+$`))
  })
})
