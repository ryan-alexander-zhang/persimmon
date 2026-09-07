import { type Server, createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Board } from '../src/server.ts'
import type { PtyProcess, SpawnPty } from '../src/sessionManager.ts'
import { armWatch, bounded, closed, doc, makeRepo, testConfig } from './helpers.ts'

/**
 * The three seams a host mounts a board on (design-00003 §1): `attach()` and the
 * upgrade it hands back in, `close()` beside the `shutdown()` that stays about
 * sessions alone, and the hook that says session state moved. Nothing here goes
 * through `listen()` — that path is `test/server.test.ts`'s, and it must go on
 * behaving as it does, which is what keeps this file honest about the seams
 * being a mechanical extraction rather than a new surface.
 */

// A signal crosses a file watch, a debounce and a socket, and a suite running
// its files side by side stretches all three past the default five seconds.
vi.setConfig({ testTimeout: 30_000 })

const SIGNAL_WAIT = { timeout: 10_000, interval: 25 }
/** Longer than the debounce window, so «nothing arrived» has had its chance to. */
const SETTLE = 400
/**
 * The silence a session is read as waiting after (spec-00003-FR-6). Nothing here
 * is proved by waiting out the real ten seconds — only that the flip happens.
 */
const AWAIT_THRESHOLD = 500

const IDEA = doc({ id: 'idea-00001-x', type: 'idea', status: 'active' }, '# Idea X\n')
const OTHER_IDEA = doc({ id: 'idea-00002-y', type: 'idea', status: 'draft' }, '# Idea Y\n')
const AUDIT = { kind: 'audit', sourceId: 'idea-00001-x', instruction: 'audit this' } as const

/**
 * A pty stand-in whose output and exit this test fires: a spawned process speaks
 * and ends when it does, and both are what these tests hold in their own hands.
 */
function scriptedAgent() {
  let said = (_data: string) => {}
  let ended = (_exitCode: number) => {}
  const spawn: SpawnPty = (): PtyProcess => {
    const readers: Array<(data: string) => void> = []
    const listeners: Array<(event: { exitCode: number }) => void> = []
    // Once, like a process: whichever ends it, the second attempt is nothing.
    let gone = false
    said = (data) => {
      for (const reader of readers) reader(data)
    }
    ended = (exitCode) => {
      if (gone) return
      gone = true
      for (const listener of listeners) listener({ exitCode })
    }
    return {
      onData: (listener) => void readers.push(listener),
      onExit: (listener) => void listeners.push(listener),
      write: () => {},
      resize: () => {},
      kill: () => ended(0),
    }
  }
  return { spawn, say: (data: string) => said(data), exit: (exitCode = 0) => ended(exitCode) }
}

const opened: Array<{ board: Board; server: Server }> = []
const sockets: WebSocket[] = []

/**
 * A board mounted the way a host mounts one: `attach()` for the routes and the
 * upgrade entry, and one http server the caller owns (design-00003 §1). The kind
 * is read off the tail of the path here, which is all a host has in hand after
 * `/w/:wid/api/` (design-00003 §5) — this board's own path table is never
 * consulted.
 */
async function hosted(
  options: {
    spawn?: SpawnPty
    command?: string
    awaitThresholdMs?: number
    onSessionsChanged?: () => void
  } = {},
) {
  const { repoRoot, docsDir } = makeRepo({ 'idea/a.md': IDEA })
  const config = testConfig()
  if (options.command) config.agents[0] = { ...config.agents[0]!, command: options.command, args: ['-e', ''] }
  const board = new Board({
    repoRoot,
    docsDir,
    config,
    spawn: options.spawn,
    awaitThresholdMs: options.awaitThresholdMs,
    onSessionsChanged: options.onSessionsChanged,
  })
  const { app, handleUpgrade } = board.attach()
  const server = createServer(app)
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = new URL(request.url ?? '/', 'http://host')
    handleUpgrade(pathname.slice(1), request, socket, head)
  })
  // Bound to the address the calls below dial, so the port is this board's own (issue-00028).
  await new Promise<void>((resolve) => void server.listen(0, '127.0.0.1', resolve))
  opened.push({ board, server })
  return { board, docsDir, port: (server.address() as { port: number }).port }
}

/** A socket through the host's upgrade entry; `opened` is false if it was refused. */
async function connect(port: number, path: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  sockets.push(socket)
  const frames: string[] = []
  socket.addEventListener('message', (event) => void frames.push(String(event.data)))
  socket.addEventListener('error', () => {})
  const settled = new Promise<boolean>((resolve) => {
    socket.addEventListener('open', () => resolve(true))
    socket.addEventListener('close', () => resolve(false))
  })
  return { socket, frames, opened: await settled }
}

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  for (const { board, server } of opened.splice(0)) {
    server.close()
    await board.close()
  }
})

/**
 * spec-00011-FR-8: the process has one http server, and a board serving under it
 * takes its upgrades handed in rather than routing them off a server of its own.
 */
describe('a board attached to somebody else’s http server', () => {
  // spec-00011-FR-8
  it('routes a terminal upgrade to that session’s own channel', async () => {
    const agent = scriptedAgent()
    const { board, port } = await hosted({ spawn: agent.spawn })
    const session = board.sessions.start(AUDIT)
    agent.say('what the agent printed')

    const terminal = await connect(port, `/terminal?sessionId=${session.id}`)

    expect(terminal.opened).toBe(true)
    await vi.waitFor(() => expect(terminal.frames.join('')).toContain('what the agent printed'), SIGNAL_WAIT)
  })

  // spec-00011-FR-8, and spec-00001-FR-42 for what the socket carries
  it('routes an events upgrade to the docs-change signal', async () => {
    const { board, port } = await hosted()
    const events = await connect(port, '/events')
    expect(events.opened).toBe(true)
    await vi.waitFor(() => expect(board.watcher.followers).toBe(1), SIGNAL_WAIT)

    board.watcher.signal()

    await vi.waitFor(() => expect(events.frames).toHaveLength(1), SIGNAL_WAIT)
  })

  // spec-00011-FR-8 — the refusal `test/server.test.ts` fixes for an unknown path
  it('destroys an upgrade of any other kind', async () => {
    const { port } = await hosted()

    expect((await connect(port, '/nothing-here')).opened).toBe(false)
  })

  // spec-00011-FR-8: a second attach must not leave a second pair of sockets
  it('hands back the same attachment on a second call', async () => {
    const { board } = await hosted()

    expect(board.attach()).toBe(board.attach())
  })
})

/**
 * spec-00011-FR-16: a normal shutdown is about sessions, and a board under a host
 * hears nothing of the http server's `close` — so what `listen()` used to hang on
 * that event is `close()`'s, and the two must be separable.
 */
describe('closing a board without shutting it down', () => {
  // spec-00011-FR-16
  it('closes the docs watch that shutdown leaves running', async () => {
    const { board, docsDir, port } = await hosted()
    await armWatch(board.watcher, docsDir)
    const events = await connect(port, '/events')

    await board.shutdown()
    writeFileSync(join(docsDir, 'idea/b.md'), OTHER_IDEA)
    await vi.waitFor(() => expect(events.frames).toHaveLength(1), SIGNAL_WAIT)

    await board.close()
    writeFileSync(join(docsDir, 'idea/c.md'), OTHER_IDEA)

    await new Promise((resolve) => setTimeout(resolve, SETTLE))
    expect(events.frames).toHaveLength(1)
  })

  /**
   * issue-00031: `close()` in `noServer` mode only stops `ws` taking new
   * upgrades — it ends no client, and Node has already dropped an upgraded
   * socket from the http server's own connection list, so nothing else can
   * either. Letting go of what `attach()` took has to include them.
   */
  // spec-00011-FR-16, and the exit half of spec-00011-AC-16.1
  it('drops the sockets a live browser is holding', async () => {
    const agent = scriptedAgent()
    const { board, port } = await hosted({ spawn: agent.spawn })
    const session = board.sessions.start(AUDIT)
    const terminal = await connect(port, `/terminal?sessionId=${session.id}`)
    const events = await connect(port, '/events')
    expect([terminal.opened, events.opened]).toEqual([true, true])
    const dropped = Promise.all([closed(terminal.socket), closed(events.socket)])

    await board.close()

    await expect(bounded(dropped)).resolves.toEqual(['closed', 'closed'])
  })

  // spec-00011-FR-16
  it('refuses the upgrades shutdown leaves open', async () => {
    const { board, port } = await hosted()

    await board.shutdown()
    expect((await connect(port, '/events')).opened).toBe(true)

    await board.close()
    expect((await connect(port, '/events')).opened).toBe(false)
  })
})

/**
 * spec-00011-FR-12: session state is one workspace's own, and a host learns that
 * a board's has moved through this hook — the same moments the refresh signal
 * goes out on, and no others.
 */
describe('the session-state hook', () => {
  // spec-00011-FR-12 — the waiting flip (spec-00003-FR-6)
  it('fires when a session goes quiet, and again when it speaks', async () => {
    const agent = scriptedAgent()
    let calls = 0
    const { board } = await hosted({
      spawn: agent.spawn,
      awaitThresholdMs: AWAIT_THRESHOLD,
      onSessionsChanged: () => void (calls += 1),
    })

    board.sessions.start(AUDIT)
    expect(calls).toBe(0)
    await vi.waitFor(() => expect(calls).toBe(1), SIGNAL_WAIT)

    agent.say('here is what I found')

    await vi.waitFor(() => expect(calls).toBe(2), SIGNAL_WAIT)
  })

  // spec-00011-FR-12 — the wrap-up and the end, which are two moments, not one
  it('fires at a session’s wrap-up and again at its end', async () => {
    const agent = scriptedAgent()
    let calls = 0
    const { board } = await hosted({ spawn: agent.spawn, onSessionsChanged: () => void (calls += 1) })
    board.sessions.start(AUDIT)

    agent.exit(0)
    await board.sessions.whenFinished()

    await vi.waitFor(() => expect(calls).toBe(2), SIGNAL_WAIT)
  })

  // spec-00011-FR-12 — a start that never came off has no wrap-up, only an end
  it('fires once for a session that never started', async () => {
    let calls = 0
    const { board } = await hosted({
      command: 'definitely-not-an-agent-cli',
      onSessionsChanged: () => void (calls += 1),
    })

    expect(board.sessions.start(AUDIT).status).toBe('failed')

    await vi.waitFor(() => expect(calls).toBe(1), SIGNAL_WAIT)
  })

  // spec-00011-FR-12 — a docs change moves no session (design-00003 §5)
  it('does not fire on a change written under docs', async () => {
    let calls = 0
    const { board, docsDir, port } = await hosted({ onSessionsChanged: () => void (calls += 1) })
    await armWatch(board.watcher, docsDir)
    const events = await connect(port, '/events')

    writeFileSync(join(docsDir, 'idea/b.md'), OTHER_IDEA)

    await vi.waitFor(() => expect(events.frames).toHaveLength(1), SIGNAL_WAIT)
    expect(calls).toBe(0)
  })

  // spec-00001-AC-42.8: followers count browsers, and a host is not one
  it('follows nothing, so the board still has no followers', async () => {
    const agent = scriptedAgent()
    const { board } = await hosted({ spawn: agent.spawn, onSessionsChanged: () => {} })

    board.sessions.start(AUDIT)
    agent.exit(0)
    await board.sessions.whenFinished()

    expect(board.watcher.followers).toBe(0)
  })
})
