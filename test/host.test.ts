import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONFIG_FILE } from '../src/config.ts'
import { Host } from '../src/host.ts'
import type { Board, BoardOptions } from '../src/server.ts'
import type { PtyProcess, SpawnPty } from '../src/sessionManager.ts'
import type { WorkspaceEntry } from '../src/workspaceRegistry.ts'
import { armWatch, commitCount, doc, git, makeRepo } from './helpers.ts'

/**
 * The host of design-00003 §4/§5/§7: the instance table and its laziness, the
 * two-segment routing and the host-level entries, the upgrade dispatch, and the
 * shutdown fan-out. What a board does under it is `test/server.test.ts`'s and
 * `test/boardSeams.test.ts`'s; what is asserted here is only ever the host's
 * share of it.
 */

// A signal crosses a file watch, a debounce and a socket, and a suite running
// its files side by side stretches all three past the default five seconds.
vi.setConfig({ testTimeout: 30_000 })

/**
 * Every board the host builds, in build order — the one honest way to tell «no
 * instance» from «one instance» from the outside (design-00003 §4), and the only
 * way to see that two concurrent first requests built one board rather than two.
 */
const built = vi.hoisted(() => [] as unknown[])

vi.mock('../src/server.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/server.ts')>()
  return {
    ...actual,
    Board: class extends actual.Board {
      constructor(options: BoardOptions) {
        super(options)
        built.push(this)
      }
    },
  }
})

const SIGNAL_WAIT = { timeout: 10_000, interval: 25 }
/** Longer than the debounce window, so «nothing arrived» has had its chance to. */
const SETTLE = 400

const DRAFT_IDEA = doc({ id: 'idea-00001-x', type: 'idea', status: 'draft' }, '# Idea X\n')
const OTHER_IDEA = doc({ id: 'idea-00002-y', type: 'idea', status: 'draft' }, '# Idea Y\n')

/** A flow config as it lives on disk: the host loads each workspace's own, rather than being handed one. */
function configText(extra = ''): string {
  return `types:
  idea: { kind: living }
  spec: { kind: living }
relations: [parent, informs]
flow:
  idea:
    - { next: spec, carry: parent }
entry: [idea]
focus:
  idea: is it worth doing, and for whom
  spec: the boundaries of each FR
agents:
  claude:
    command: node
    args: []
${extra}`
}

const made: string[] = []
const hosts: Host[] = []
const sockets: WebSocket[] = []

function temporary(prefix: string): string {
  // `realpath` because macOS puts the temporary directory behind a symlink and
  // the registry stores the resolved path (design-00003 §2).
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  made.push(dir)
  return dir
}

/** A registrable workspace: a git repository with a `docs/` tree and a flow config of its own. */
function workspace(id: string, files: Record<string, string> = { 'idea/a.md': DRAFT_IDEA }, extra = '') {
  const { repoRoot } = makeRepo(files)
  made.push(repoRoot)
  const path = realpathSync(repoRoot)
  writeFileSync(join(path, CONFIG_FILE), configText(extra))
  return { id, name: id, path, docsDir: join(path, 'docs') }
}

/** A host serving the given registry, on an ephemeral port, with a fetch bound to it. */
function hostOn(workspaces: WorkspaceEntry[], seams: Pick<BoardOptions, 'spawn'> | Record<string, never> = {}) {
  const registryPath = join(temporary('wb-registry-'), 'workspaces.json')
  writeFileSync(registryPath, `${JSON.stringify({ version: 1, workspaces }, null, 2)}\n`)
  const host = new Host({ registryPath, version: '9.9.9', ...seams })
  hosts.push(host)
  const server = host.listen(0)
  const port = (server.address() as { port: number }).port

  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, body: parsed(await response.text()) }
  }
  return { host, registryPath, port, call }
}

/** The body as JSON where there is JSON: the SPA fallback answers with a page, or with nothing at all. */
function parsed(text: string): any {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** A socket through the host's one upgrade listener; `opened` is false if it was destroyed or refused. */
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

/**
 * Stand-in agents whose output and exit the test fires, in start order — the
 * same one `test/server.test.ts` scripts a board with. One spawn seam serves
 * every board the host builds, which is what makes the index the session order
 * across workspaces.
 */
function scriptedAgents() {
  const exits: Array<(exitCode: number) => void> = []
  const says: Array<(data: string) => void> = []
  const spawn: SpawnPty = (): PtyProcess => {
    const listeners: Array<(event: { exitCode: number }) => void> = []
    const readers: Array<(data: string) => void> = []
    // Once, like a process: whichever ends it, the second attempt is nothing.
    let gone = false
    const end = (exitCode: number) => {
      if (gone) return
      gone = true
      for (const listener of listeners) listener({ exitCode })
    }
    exits.push(end)
    says.push((data) => {
      for (const reader of readers) reader(data)
    })
    return {
      onData: (listener) => void readers.push(listener),
      onExit: (listener) => void listeners.push(listener),
      write: () => {},
      resize: () => {},
      kill: () => end(0),
    }
  }
  return { spawn, exit: (index: number, exitCode = 0) => exits[index]!(exitCode), say: (index: number, data: string) => says[index]!(data) }
}

/** The board the host built for that workspace, in build order — for the watch and the signal a test drives. */
const board = (index: number) => built[index] as Board

beforeEach(() => {
  built.length = 0
})

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close()
  for (const host of hosts.splice(0)) await host.shutdown()
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** design-00003 §5, and the handshake spec-00011-FR-14 rests on. */
describe('GET /api/instance', () => {
  // spec-00011-FR-14
  it('names the app, the version and the process', async () => {
    const { call } = hostOn([])

    const { status, body } = await call('GET', '/api/instance')

    expect(status).toBe(200)
    expect(body).toEqual({ app: 'persimmon', version: '9.9.9', pid: process.pid })
  })
})

/**
 * design-00003 §4: an instance is built by the first `/w/<wid>/api/...` request
 * and by nothing else — ten registered projects are looked at one or two at a
 * time, and each instance costs a watch and a parsed tree.
 */
describe('building an instance', () => {
  // spec-00011-FR-8, design-00003 §4
  it('builds none for the entry page', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])

    await call('GET', '/')

    expect(built).toHaveLength(0)
  })

  // spec-00011-FR-8 — a bare mount would let this one through (design-00003 §4)
  it('builds none for an asset under a workspace path', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])

    await call('GET', '/w/alpha/favicon.ico')

    expect(built).toHaveLength(0)
  })

  // spec-00011-FR-8
  it('builds one for the first API request of that workspace', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])

    const { status, body } = await call('GET', '/w/alpha/api/graph')

    expect(status).toBe(200)
    expect(body.nodes.map((node: { id: string }) => node.id)).toEqual(['idea-00001-x'])
    expect(built).toHaveLength(1)
  })

  // spec-00011-FR-8, design-00003 §4: the first screen asks for two at once, and
  // two boards would each hold a watch, a reconcile and a set of writes
  it('builds one for two concurrent first requests', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])

    const [graph, config] = await Promise.all([call('GET', '/w/alpha/api/graph'), call('GET', '/w/alpha/api/config')])

    expect([graph.status, config.status]).toEqual([200, 200])
    expect(built).toHaveLength(1)
  })

  // spec-00011-FR-8 — the instance is the process's, not the request's
  it('keeps the one it built for every request after', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])

    await call('GET', '/w/alpha/api/graph')
    await call('GET', '/w/alpha/api/graph')

    expect(built).toHaveLength(1)
  })
})

/** design-00003 §5: `api.ts` reads every response as JSON, so every refusal is JSON. */
describe('a workspace the host cannot route to', () => {
  // spec-00011-AC-9.2, design-00003 §5 — checked before any file system read
  it('answers 404 for an id that cannot be one', async () => {
    const { call } = hostOn([workspace('alpha')])

    const { status, body } = await call('GET', '/w/Alpha!/api/graph')

    expect(status).toBe(404)
    expect(body.error).toContain('is not registered')
    expect(built).toHaveLength(0)
  })

  // spec-00011-AC-9.2
  it('answers 404 for an id that is not in the registry', async () => {
    const { call } = hostOn([workspace('alpha')])

    const { status, body } = await call('GET', '/w/ghost/api/graph')

    expect(status).toBe(404)
    expect(body.error).toContain('"ghost"')
    expect(built).toHaveLength(0)
  })

  // spec-00011-AC-6.1, AC-9.3 — the reason rides with the refusal (design-00003 §5)
  it('answers 503 and builds nothing when the directory is gone', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])
    rmSync(alpha.path, { recursive: true })

    const { status, body } = await call('GET', '/w/alpha/api/graph')

    expect(status).toBe(503)
    expect(body).toEqual({ error: `workspace directory does not exist: ${alpha.path}`, reason: 'missing' })
    expect(built).toHaveLength(0)
  })

  // spec-00011-AC-6.2
  it('answers 503 when the flow config is gone', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])
    rmSync(join(alpha.path, CONFIG_FILE))

    const { status, body } = await call('GET', '/w/alpha/api/graph')

    expect(status).toBe(503)
    expect(body.reason).toBe('noConfig')
    expect(built).toHaveLength(0)
  })

  // spec-00011-AC-6.3
  it('answers 503 when the directory is not a git repository', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])
    rmSync(join(alpha.path, '.git'), { recursive: true })

    const { status, body } = await call('GET', '/w/alpha/api/graph')

    expect(status).toBe(503)
    expect(body.reason).toBe('noGit')
    expect(built).toHaveLength(0)
  })

  // spec-00011-AC-6.4 — the message is the one a single-workspace start printed
  it('answers 503 carrying the config error when the config is invalid', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])
    writeFileSync(join(alpha.path, CONFIG_FILE), configText('max_sessions: 0\n'))

    const { status, body } = await call('GET', '/w/alpha/api/graph')

    expect(status).toBe(503)
    expect(body.reason).toBe('invalidConfig')
    expect(body.error).toContain('max_sessions')
    expect(built).toHaveLength(0)
  })
})

/** design-00003 §5: the mount strips the prefix, so the routes under it do not know they are mounted. */
describe('forwarding to the workspace’s own board', () => {
  // spec-00011-FR-8, spec-00011-AC-8.1
  it('serves each workspace its own graph', async () => {
    const alpha = workspace('alpha')
    const demo = workspace('demo', { 'idea/b.md': OTHER_IDEA })
    const { call } = hostOn([alpha, demo])

    const first = await call('GET', '/w/alpha/api/graph')
    const second = await call('GET', '/w/demo/api/graph')

    expect(first.body.nodes.map((node: { id: string }) => node.id)).toEqual(['idea-00001-x'])
    expect(second.body.nodes.map((node: { id: string }) => node.id)).toEqual(['idea-00002-y'])
    expect(built).toHaveLength(2)
  })

  // spec-00011-FR-8 — the board sees `/api/docs/:id`, never the prefix
  it('reaches a route that carries a parameter of its own', async () => {
    const { call } = hostOn([workspace('alpha')])

    const { status, body } = await call('GET', '/w/alpha/api/docs/idea-00001-x')

    expect(status).toBe(200)
    expect(body.path).toBe('idea/a.md')
    expect(body.content).toContain('idea-00001-x')
  })
})

/** design-00003 §5: the assets, and the index.html every other GET falls back to. */
describe('the SPA fallback', () => {
  // design-00003 §5 — it is a GET's; nothing else falls into it
  it('leaves a request that is not a GET to the 404 it would have got', async () => {
    const { call } = hostOn([workspace('alpha')])

    expect((await call('POST', '/nothing-here')).status).toBe(404)
  })
})

/** design-00003 §5: what the switcher lists, and what the notification layer reads (design-00003 §9). */
describe('GET /api/workspaces', () => {
  // spec-00011-AC-1.2 — re-read every call, so a hand edit shows up without a restart
  it('lists the registry in file order, with no sessions before an instance exists', async () => {
    const alpha = workspace('alpha')
    const demo = workspace('demo')
    const { call, registryPath } = hostOn([alpha])

    writeFileSync(registryPath, JSON.stringify({ version: 1, workspaces: [alpha, demo].map(entry) }))
    const { status, body } = await call('GET', '/api/workspaces')

    expect(status).toBe(200)
    expect(body.workspaces).toEqual([
      { id: 'alpha', name: 'alpha', path: alpha.path, availability: 'available', sessions: [] },
      { id: 'demo', name: 'demo', path: demo.path, availability: 'available', sessions: [] },
    ])
  })

  // spec-00011-AC-6.1, AC-6.2 — an unavailable entry stays in the list, with its reason
  it('judges every entry, carrying the reason and the sentence that says what to fix', async () => {
    const alpha = workspace('alpha')
    const broken = workspace('broken')
    rmSync(join(broken.path, CONFIG_FILE))
    const { call } = hostOn([alpha, broken])

    const { body } = await call('GET', '/api/workspaces')

    expect(body.workspaces[0].availability).toBe('available')
    expect(body.workspaces[1]).toMatchObject({
      id: 'broken',
      availability: 'noConfig',
      error: `directory has no ${CONFIG_FILE}: ${broken.path}`,
    })
  })

  // spec-00011-AC-6.6 — an instance reads its config once; a later edit takes a restart
  it('goes on calling an open workspace available after its config is broken', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])
    await call('GET', '/w/alpha/api/graph')

    writeFileSync(join(alpha.path, CONFIG_FILE), configText('max_sessions: 0\n'))

    expect((await call('GET', '/api/workspaces')).body.workspaces[0].availability).toBe('available')
  })

  // spec-00011-FR-7, design-00003 §5: the switcher's counts come off these rows
  it('carries the live workspace’s sessions, in the shape the switcher counts', async () => {
    const agents = scriptedAgents()
    const alpha = workspace('alpha')
    const demo = workspace('demo')
    const { call } = hostOn([alpha, demo], { spawn: agents.spawn })
    const started = await call('POST', '/w/alpha/api/sessions/clarify', { docId: 'idea-00001-x' })

    const { body } = await call('GET', '/api/workspaces')

    expect(body.workspaces[0].sessions).toEqual([
      { id: started.body.id, kind: 'clarify', sourceId: 'idea-00001-x', status: 'running' },
    ])
    expect(body.workspaces[1].sessions).toEqual([])
  })

  // spec-00011-FR-18, for the reading it leaves open: it rules on the start, and a
  // hand edit that breaks the file while the process is up surfaces on this read
  it('answers 500 naming the file when a hand edit made the registry ill-formed', async () => {
    const { call, registryPath } = hostOn([workspace('alpha')])

    writeFileSync(registryPath, 'not json at all')
    const { status, body } = await call('GET', '/api/workspaces')

    expect(status).toBe(500)
    expect(body.error).toContain(registryPath)
  })
})

/** spec-00011-FR-2, FR-3 and design-00003 §5's three status codes. */
describe('POST /api/workspaces', () => {
  // spec-00011-AC-2.1
  it('registers a new directory and answers 201', async () => {
    const { call } = hostOn([])
    const demo = workspace('demo')

    const { status, body } = await call('POST', '/api/workspaces', { path: demo.path })

    expect(status).toBe(201)
    // The id is derived from the directory name and the name defaults to it
    // (design-00003 §2); the fixture's own label plays no part in either.
    expect(body.workspace).toEqual({ id: basename(demo.path).toLowerCase(), name: basename(demo.path).toLowerCase(), path: demo.path })
    expect((await call('GET', '/api/workspaces')).body.workspaces).toHaveLength(1)
  })

  // spec-00011-AC-2.3 — idempotent by resolved path, which `ainpt new` rests on
  it('answers 200 with the entry that was already there', async () => {
    const demo = workspace('demo')
    const { call } = hostOn([entry(demo)])

    const { status, body } = await call('POST', '/api/workspaces', { path: demo.path, name: 'renamed' })

    expect(status).toBe(200)
    expect(body.workspace).toEqual({ id: 'demo', name: 'demo', path: demo.path })

  })

  // spec-00011-AC-3.1 — a directory with no flow config is refused, and nothing is written
  it('answers 422 for a directory the registry refuses', async () => {
    const { call } = hostOn([])
    const bare = temporary('wb-bare-')

    const { status, body } = await call('POST', '/api/workspaces', { path: bare })

    expect(status).toBe(422)
    expect(body.error).toContain(CONFIG_FILE)
    expect((await call('GET', '/api/workspaces')).body.workspaces).toEqual([])
  })

  // spec-00011-FR-2 — the path is the one thing an add cannot do without, and a
  // display name that is not one would go into the file and make it ill-formed
  it('answers 422 for a body that names no path, or a name that is not one', async () => {
    const { call } = hostOn([])

    expect((await call('POST', '/api/workspaces', { name: 'demo' })).status).toBe(422)
    expect((await call('POST', '/api/workspaces')).status).toBe(422)
    expect((await call('POST', '/api/workspaces', { path: workspace('demo').path, name: 7 })).status).toBe(422)
  })

  // spec-00011-AC-14.2, server half: an open switcher lists the new entry at once
  it('signals the host events channel on a new entry', async () => {
    const { call, port } = hostOn([])
    const events = await connect(port, '/api/workspaces/events')
    expect(events.opened).toBe(true)

    await call('POST', '/api/workspaces', { path: workspace('demo').path })

    await vi.waitFor(() => expect(events.frames).toHaveLength(1), SIGNAL_WAIT)
  })

  // design-00003 §5: only the two triggers, and a second add of the same path is neither
  it('does not signal when the entry was already there', async () => {
    const demo = workspace('demo')
    const { call, port } = hostOn([entry(demo)])
    const events = await connect(port, '/api/workspaces/events')

    await call('POST', '/api/workspaces', { path: demo.path })

    await new Promise((resolve) => setTimeout(resolve, SETTLE))
    expect(events.frames).toEqual([])
  })
})

/** spec-00011-FR-4 and FR-5, and design-00003 §4's way out of an instance. */
describe('DELETE /api/workspaces/:wid', () => {
  // spec-00011-AC-5.2
  it('answers 404 for an id that is not registered', async () => {
    const { call } = hostOn([workspace('alpha')])

    const { status, body } = await call('DELETE', '/api/workspaces/ghost')

    expect(status).toBe(404)
    expect(body.error).toContain('"ghost"')
  })

  // spec-00011-AC-5.1
  it('answers 409 while the workspace has a running session, and keeps the entry', async () => {
    const agents = scriptedAgents()
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha], { spawn: agents.spawn })
    await call('POST', '/w/alpha/api/sessions/clarify', { docId: 'idea-00001-x' })

    const { status, body } = await call('DELETE', '/api/workspaces/alpha')

    expect(status).toBe(409)
    expect(body.error).toContain('running session')
    expect((await call('GET', '/api/workspaces')).body.workspaces).toHaveLength(1)
  })

  // spec-00011-AC-4.1, server half: the entry goes, and so does the instance's watch
  it('removes a live workspace, letting its instance go', async () => {
    const alpha = workspace('alpha')
    const { call, port } = hostOn([alpha])
    await call('GET', '/w/alpha/api/graph')
    await connect(port, '/w/alpha/api/events')
    await vi.waitFor(() => expect(board(0).watcher.followers).toBe(1), SIGNAL_WAIT)

    const { status } = await call('DELETE', '/api/workspaces/alpha')

    expect(status).toBe(200)
    expect(board(0).watcher.followers).toBe(0)
    expect((await call('GET', '/api/workspaces')).body.workspaces).toEqual([])
    expect((await call('GET', '/w/alpha/api/graph')).status).toBe(404)
  })

  // spec-00011-FR-4 — nothing inside the directory is touched
  it('leaves the workspace’s own files where they are', async () => {
    const alpha = workspace('alpha')
    const { call } = hostOn([alpha])
    const commits = commitCount(alpha.path)

    await call('DELETE', '/api/workspaces/alpha')

    expect(commitCount(alpha.path)).toBe(commits)
    expect(git(alpha.path, 'show', 'HEAD:docs/idea/a.md')).toContain('idea-00001-x')
  })

  // spec-00011-AC-4.1, and design-00003 §5's second trigger
  it('signals the host events channel', async () => {
    const { call, port } = hostOn([workspace('alpha')])
    const events = await connect(port, '/api/workspaces/events')

    await call('DELETE', '/api/workspaces/alpha')

    await vi.waitFor(() => expect(events.frames).toHaveLength(1), SIGNAL_WAIT)
  })
})

/**
 * spec-00011-FR-12 and FR-19: every judgement, every cap and every write is one
 * workspace's own. The host is what keeps them apart, so this is its share of
 * the isolation the whole spec rests on.
 */
describe('two workspaces side by side', () => {
  // spec-00011-AC-12.1 — the cap is each workspace's own `max_sessions`
  it('counts the session cap per workspace', async () => {
    const agents = scriptedAgents()
    const alpha = workspace('alpha', { 'idea/a.md': DRAFT_IDEA }, 'max_sessions: 1\n')
    const demo = workspace('demo', { 'idea/a.md': DRAFT_IDEA }, 'max_sessions: 1\n')
    const { call } = hostOn([alpha, demo], { spawn: agents.spawn })
    await call('POST', '/w/alpha/api/sessions/clarify', { docId: 'idea-00001-x' })

    const { status } = await call('POST', '/w/demo/api/sessions/clarify', { docId: 'idea-00001-x' })

    expect(status).toBe(200)
  })

  // spec-00011-AC-12.2 — and a workspace at its cap is still at its cap
  it('refuses a second session in the workspace whose cap is reached', async () => {
    const agents = scriptedAgents()
    const alpha = workspace('alpha', { 'idea/a.md': DRAFT_IDEA, 'idea/b.md': OTHER_IDEA }, 'max_sessions: 1\n')
    const demo = workspace('demo', { 'idea/a.md': DRAFT_IDEA }, 'max_sessions: 1\n')
    const { call } = hostOn([alpha, demo], { spawn: agents.spawn })
    await call('POST', '/w/alpha/api/sessions/clarify', { docId: 'idea-00001-x' })
    await call('POST', '/w/demo/api/sessions/clarify', { docId: 'idea-00001-x' })

    const { status, body } = await call('POST', '/w/alpha/api/sessions/clarify', { docId: 'idea-00002-y' })

    expect(status).toBe(409)
    expect(body.error).toContain('sessions')
  })

  // spec-00011-AC-12.5, server half: a change under one workspace's docs signals
  // that workspace's events socket and no other
  it('signals only the workspace whose docs moved', async () => {
    const alpha = workspace('alpha')
    const demo = workspace('demo')
    const { call, port } = hostOn([alpha, demo])
    await call('GET', '/w/alpha/api/graph')
    await call('GET', '/w/demo/api/graph')
    await armWatch(board(1).watcher, demo.docsDir)
    const alphaEvents = await connect(port, '/w/alpha/api/events')
    const demoEvents = await connect(port, '/w/demo/api/events')

    writeFileSync(join(demo.docsDir, 'idea/b.md'), OTHER_IDEA)

    await vi.waitFor(() => expect(demoEvents.frames).toHaveLength(1), SIGNAL_WAIT)
    expect(alphaEvents.frames).toEqual([])
  })

  // spec-00011-AC-12.7 — id uniqueness is judged inside one workspace
  it('reads the same id in both as no clash in either', async () => {
    const alpha = workspace('alpha')
    const demo = workspace('demo')
    const { call } = hostOn([alpha, demo])

    const first = await call('GET', '/w/alpha/api/graph')
    const second = await call('GET', '/w/demo/api/graph')

    expect(first.body.issues).toEqual([])
    expect(second.body.issues).toEqual([])
  })

  // spec-00011-AC-19.1, server half: an action writes one workspace's git and no other
  it('commits into the workspace the action was made in, and no other', async () => {
    const alpha = workspace('alpha')
    const demo = workspace('demo')
    const { call } = hostOn([alpha, demo])
    await call('GET', '/w/demo/api/graph')
    const commits = { alpha: commitCount(alpha.path), demo: commitCount(demo.path) }

    const { status } = await call('POST', '/w/alpha/api/docs/idea-00001-x/status', { to: 'active' })

    expect(status).toBe(200)
    expect(commitCount(alpha.path)).toBeGreaterThan(commits.alpha)
    expect(commitCount(demo.path)).toBe(commits.demo)
    expect(git(demo.path, 'status', '--porcelain', '--', 'docs').trim()).toBe('')
  })
})

/** design-00003 §5: one upgrade listener, three destinations, and a destroyed socket for the rest. */
describe('websocket upgrades', () => {
  // spec-00011-FR-8 — the terminal of that workspace's own session
  it('routes a terminal upgrade to the session of the workspace named in the path', async () => {
    const agents = scriptedAgents()
    const { call, port } = hostOn([workspace('alpha')], { spawn: agents.spawn })
    const started = await call('POST', '/w/alpha/api/sessions/clarify', { docId: 'idea-00001-x' })
    agents.say(0, 'what the agent printed')

    const terminal = await connect(port, `/w/alpha/api/terminal?sessionId=${started.body.id}`)

    expect(terminal.opened).toBe(true)
    await vi.waitFor(() => expect(terminal.frames.join('')).toContain('what the agent printed'), SIGNAL_WAIT)
  })

  // spec-00011-FR-8, design-00003 §4: the events socket is part of a first load,
  // so an upgrade builds the instance as an API request would
  it('builds the instance an events upgrade is the first request for', async () => {
    const { port } = hostOn([workspace('alpha')])

    const events = await connect(port, '/w/alpha/api/events')

    expect(events.opened).toBe(true)
    expect(built).toHaveLength(1)
    await vi.waitFor(() => expect(board(0).watcher.followers).toBe(1), SIGNAL_WAIT)
    board(0).watcher.signal()
    await vi.waitFor(() => expect(events.frames).toHaveLength(1), SIGNAL_WAIT)
  })

  // design-00003 §5 — the host's own channel needs no workspace
  it('accepts the host events upgrade without building anything', async () => {
    const { port } = hostOn([workspace('alpha')])

    expect((await connect(port, '/api/workspaces/events')).opened).toBe(true)
    expect(built).toHaveLength(0)
  })

  // spec-00011-FR-18 — an upgrade has no body to answer a refusal with
  it('destroys an upgrade when a hand edit made the registry ill-formed', async () => {
    const { port, registryPath } = hostOn([workspace('alpha')])

    writeFileSync(registryPath, 'not json at all')

    expect((await connect(port, '/w/alpha/api/events')).opened).toBe(false)
  })

  // spec-00011-FR-8 — the refusal an unknown path has always got (spec-00001-FR-42)
  it('destroys an upgrade on any other path', async () => {
    const { port } = hostOn([workspace('alpha')])

    expect((await connect(port, '/w/alpha/api/nothing-here')).opened).toBe(false)
    expect((await connect(port, '/nothing-here')).opened).toBe(false)
    expect((await connect(port, '/w/ghost/api/events')).opened).toBe(false)
  })
})

/** spec-00011-FR-16 and design-00003 §7: one signal, every workspace wrapped up. */
describe('shutting the host down', () => {
  /** Two workspaces, each with a running session that has written under `docs/`. */
  async function twoThatWrote() {
    const agents = scriptedAgents()
    const alpha = workspace('alpha')
    const demo = workspace('demo')
    const open = hostOn([alpha, demo], { spawn: agents.spawn })
    await open.call('POST', '/w/alpha/api/sessions/clarify', { docId: 'idea-00001-x' })
    await open.call('POST', '/w/demo/api/sessions/clarify', { docId: 'idea-00001-x' })
    appendFileSync(join(alpha.docsDir, 'idea/a.md'), '\nasked and answered in alpha\n')
    appendFileSync(join(demo.docsDir, 'idea/a.md'), '\nasked and answered in demo\n')
    return { ...open, alpha, demo }
  }

  // spec-00011-AC-16.1, AC-16.2, server half
  it('wraps up the running session of every workspace before it resolves', async () => {
    const open = await twoThatWrote()
    const commits = { alpha: commitCount(open.alpha.path), demo: commitCount(open.demo.path) }

    await open.host.shutdown()

    expect(commitCount(open.alpha.path)).toBeGreaterThan(commits.alpha)
    expect(commitCount(open.demo.path)).toBeGreaterThan(commits.demo)
    expect(git(open.alpha.path, 'show', 'HEAD:docs/idea/a.md')).toContain('asked and answered in alpha')
    expect(git(open.demo.path, 'show', 'HEAD:docs/idea/a.md')).toContain('asked and answered in demo')
  })

  // spec-00011-AC-16.3 — a second signal joins the shutdown already running
  it('does nothing on a second shutdown', async () => {
    const open = await twoThatWrote()
    await open.host.shutdown()
    const commits = { alpha: commitCount(open.alpha.path), demo: commitCount(open.demo.path) }

    await open.host.shutdown()

    expect(commitCount(open.alpha.path)).toBe(commits.alpha)
    expect(commitCount(open.demo.path)).toBe(commits.demo)
  })

  // spec-00011-FR-18: an ill-formed registry refuses the start, before a port is taken
  it('refuses to start on an ill-formed registry', async () => {
    const registryPath = join(temporary('wb-registry-'), 'workspaces.json')
    writeFileSync(registryPath, JSON.stringify({ version: 2, workspaces: [] }))
    const host = new Host({ registryPath, version: '9.9.9' })

    expect(() => host.listen(0)).toThrow(registryPath)
    // Nothing was ever taken, so the shutdown has nothing to give back.
    await expect(host.shutdown()).resolves.toBeUndefined()
  })
})

/** The registry entry of a workspace fixture, without the `docsDir` the tests carry alongside it. */
function entry({ id, name, path }: WorkspaceEntry): WorkspaceEntry {
  return { id, name, path }
}
