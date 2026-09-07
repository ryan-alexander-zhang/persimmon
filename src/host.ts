import type { IncomingMessage, Server } from 'node:http'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { WebSocketServer } from 'ws'
import { CONFIG_FILE, loadFlowConfig } from './config.ts'
import { Board, type BoardOptions } from './server.ts'
import { AvailabilityJudge } from './workspaceAvailability.ts'
import { type WorkspaceEntry, WorkspaceRefusedError, WorkspaceRegistry } from './workspaceRegistry.ts'

/** The seams a board takes for a test's sake (design-00001 §5); a host holds them for every board it builds. */
type BoardSeams = Pick<BoardOptions, 'spawn' | 'spawnHeadless' | 'awaitThresholdMs'>

export interface HostOptions extends BoardSeams {
  /**
   * The workspace registry file (design-00003 §2). A constructor parameter
   * rather than an environment variable, as the board's own seams are.
   */
  registryPath: string
  /** The package version, which `GET /api/instance` carries for the start handshake to print (design-00003 §8). */
  version: string
}

/** The id form of spec-00011-FR-2, checked before anything touches the file system (design-00003 §5). */
const WID = /^[a-z0-9-]+$/

/** The upgrade paths a board serves, under the two-segment prefix (design-00003 §5). */
const UPGRADE = /^\/w\/([a-z0-9-]+)\/api\/(terminal|events)$/

/** The host's own upgrade path: the registry-and-sessions signal of design-00003 §5. */
const HOST_EVENTS = '/api/workspaces/events'

const WEB_DIST = new URL('../dist/web', import.meta.url).pathname

/**
 * The layer in front of the boards (design-00003 §1): it reads and writes the
 * workspace registry, judges availability, builds a board per workspace as the
 * first request for one arrives, routes HTTP and websocket upgrades to it,
 * serves the SPA, and fans a shutdown out over the lot. It parses no document
 * and starts no session — those are a board's, one per workspace.
 */
export class Host {
  readonly app: Express
  private readonly registry: WorkspaceRegistry
  private readonly judge = new AvailabilityJudge()
  /**
   * The instance table of design-00003 §4, holding **promises**: the first
   * screen asks for the config and the graph at once, and two requests missing
   * together must not build two boards — each with its own watch, its own
   * reconcile and its own writes.
   */
  private readonly instances = new Map<string, Promise<Board>>()
  private readonly seams: BoardSeams
  private readonly version: string
  private readonly events = new WebSocketServer({ noServer: true })
  private server?: Server
  private stopping?: Promise<void>

  constructor(options: HostOptions) {
    const { registryPath, version, ...seams } = options
    this.registry = new WorkspaceRegistry(registryPath)
    this.version = version
    this.seams = seams
    this.app = this.buildApp()
  }

  /**
   * Serve on the one http server the process has (design-00003 §1). An
   * ill-formed registry refuses the start here, before the port is taken
   * (spec-00011-FR-18): the error is thrown for the CLI to print.
   *
   * The bind is loopback by default — the constraint spec-00011 §6 and
   * ARCHITECTURE.md §2 already state, and the address the CLI's handshake
   * probes, so probe and bind ask the same question (issue-00028).
   */
  listen(port: number, host = '127.0.0.1'): Server {
    this.registry.read()
    const server = this.app.listen(port, host)
    server.on('upgrade', (request, socket, head) => void this.upgrade(request, socket, head))
    this.server = server
    return server
  }

  /**
   * A normal shutdown, fanned out (design-00003 §7): every board wraps its
   * running sessions up at once, and only once all of them are done is what
   * `attach()` took let go of. Idempotent, so a second signal joins the
   * shutdown already running (spec-00011-AC-16.3) — the same memoised promise
   * `Board.shutdown()` is idempotent by.
   */
  async shutdown(): Promise<void> {
    this.stopping ??= this.stop()
    await this.stopping
  }

  private async stop(): Promise<void> {
    const boards = await Promise.all([...this.instances.values()])
    await Promise.all(boards.map((board) => board.shutdown()))
    for (const board of boards) await board.close()
    this.events.close()
    const server = this.server
    if (server === undefined) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      // A keep-alive connection nobody is using would hold the close open for
      // ever; the requests still in flight are left to finish.
      server.closeIdleConnections()
    })
  }

  private buildApp(): Express {
    const app = express()
    app.use(express.json({ limit: '4mb' }))

    // The start handshake (design-00003 §8): who is on this port, and which
    // version — the version is printed, never judged on.
    app.get('/api/instance', (_req, res) => res.json({ app: 'persimmon', version: this.version, pid: process.pid }))

    // The switcher's one read (design-00003 §5): the registry re-read and every
    // entry judged, plus the session summary the counts and the desktop
    // notifications are both derived from (design-00003 §9).
    app.get('/api/workspaces', async (_req, res) => {
      const entries = this.registry.read()
      const workspaces = await Promise.all(
        entries.map(async (entry) => {
          const live = this.instances.get(entry.id)
          const { availability, error } = this.judge.judge(entry, live !== undefined)
          return {
            ...entry,
            availability,
            ...(error === undefined ? {} : { error }),
            sessions: live === undefined ? [] : sessionsOf(await live),
          }
        }),
      )
      res.json({ workspaces })
    })

    // 201 for a new entry, 200 for one that was already there — the add is
    // idempotent by resolved path, and `ainpt new` rests on that (design-00003 §2).
    app.post('/api/workspaces', (req, res) => {
      const { path, name } = addition(req.body)
      const before = this.registry.read()
      const workspace = this.registry.add(path, name)
      const created = !before.some((entry) => entry.id === workspace.id)
      if (created) this.signal()
      res.status(created ? 201 : 200).json({ workspace })
    })

    app.delete('/api/workspaces/:wid', async (req, res) => {
      await this.remove(req.params.wid, res)
    })

    // Only a path under `/api/` resolves a workspace; everything else falls
    // through to the SPA below (design-00003 §4) — `/w/A/favicon.ico` must not
    // build a whole set of services, which a bare mount would have it do.
    app.use('/w/:wid', (req, res, next) => this.forward(req, res, next))

    app.use(express.static(WEB_DIST))
    // Whatever the static assets did not answer is the SPA's: `/`, `/w/:wid`,
    // and a bookmark or a misspelling under either (design-00003 §5).
    app.use((req, res, next) => {
      if (req.method !== 'GET') {
        next()
        return
      }
      res.sendFile(join(WEB_DIST, 'index.html'))
    })
    app.use(errorHandler)
    return app
  }

  /**
   * One workspace's request, forwarded to its board with the `/w/<wid>` prefix
   * already stripped by the mount — the routes under it do not know they are
   * mounted, and the board does not know its own id (design-00003 §4, §5).
   */
  private async forward(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { wid } = req.params as { wid: string }
    // Before anything reads the file system, and whatever the rest of the path
    // is: an id that cannot be one names no workspace (design-00003 §5).
    if (!WID.test(wid)) {
      res.status(404).json({ error: unregistered(wid) })
      return
    }
    if (!req.url.startsWith('/api/')) {
      next()
      return
    }
    const entry = this.entry(wid)
    if (entry === undefined) {
      res.status(404).json({ error: unregistered(wid) })
      return
    }
    const { availability, error } = this.judge.judge(entry, this.instances.has(wid))
    if (availability !== 'available') {
      res.status(503).json({ error, reason: availability })
      return
    }
    let board: Board
    try {
      board = await this.instance(entry)
    } catch (cause) {
      // The config was read as valid a moment ago, by the judgement above, so a
      // build that failed all the same carries its own message and no reason of
      // the four (design-00003 §3): none of them is what happened.
      res.status(503).json({ error: (cause as Error).message })
      return
    }
    board.app(req, res, next)
  }

  /**
   * Drop a workspace (spec-00011-FR-4): the registry entry goes and the
   * directory is untouched. A live instance is let go of only after the entry
   * is gone, and only if it has nothing running (spec-00011-FR-5).
   */
  private async remove(wid: string, res: Response): Promise<void> {
    const entry = this.entry(wid)
    if (entry === undefined) {
      res.status(404).json({ error: unregistered(wid) })
      return
    }
    const live = this.instances.get(wid)
    const board = live === undefined ? undefined : await live
    if (board?.sessions.list().some((session) => session.status === 'running') === true) {
      res.status(409).json({ error: `workspace ${JSON.stringify(wid)} has a running session` })
      return
    }
    const workspace = this.registry.remove(wid)
    if (board !== undefined) {
      // Nothing is running, so the wrap-up returns at once; `close()` is what
      // actually lets the watch and the two socket servers go (design-00003 §4).
      await board.shutdown()
      await board.close()
    }
    this.instances.delete(wid)
    this.judge.forget(entry.path)
    this.signal()
    res.json({ workspace })
  }

  /** The registry entry of that id, re-read from the file as every read of it is (design-00003 §2). */
  private entry(wid: string): WorkspaceEntry | undefined {
    return this.registry.read().find((entry) => entry.id === wid)
  }

  /**
   * The board of that workspace, built on the first request for it and kept for
   * the life of the process (design-00003 §4). The promise goes into the table
   * before it settles, so concurrent first requests share one board; a build
   * that failed leaves nothing behind, and the next request tries again.
   */
  private instance(entry: WorkspaceEntry): Promise<Board> {
    const existing = this.instances.get(entry.id)
    if (existing !== undefined) return existing
    const building = (async () => {
      const config = loadFlowConfig(join(entry.path, CONFIG_FILE))
      const board = new Board({
        repoRoot: entry.path,
        docsDir: join(entry.path, 'docs'),
        config,
        onSessionsChanged: () => this.signal(),
        ...this.seams,
      })
      board.attach()
      return board
    })()
    this.instances.set(entry.id, building)
    building.catch(() => this.instances.delete(entry.id))
    return building
  }

  /**
   * The host-level signal (design-00003 §5): no payload, and exactly two things
   * send it — a registry write of this process's own, and a live board saying
   * its session state moved. A change under `docs/` is neither, and takes the
   * workspace's own events socket alone.
   */
  private signal(): void {
    for (const client of this.events.clients) {
      if (client.readyState === client.OPEN) client.send('')
    }
  }

  /**
   * The process has one upgrade listener (design-00003 §1): the host's own
   * channel, the two a board serves under its prefix, and — for anything else —
   * the destroyed socket an unknown path has always got (spec-00001-FR-42).
   * A workspace with no instance yet gets one built here as an API request
   * would build it: the events socket is part of a first load.
   */
  private async upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    try {
      const { pathname } = new URL(request.url ?? '/', 'http://host')
      if (pathname === HOST_EVENTS) {
        this.events.handleUpgrade(request, socket, head, (connection) =>
          this.events.emit('connection', connection, request),
        )
        return
      }
      const match = UPGRADE.exec(pathname)
      const entry = match === null ? undefined : this.entry(match[1]!)
      if (match === null || entry === undefined) {
        socket.destroy()
        return
      }
      const board = await this.instance(entry)
      board.attach().handleUpgrade(match[2]!, request, socket, head)
    } catch {
      // A registry that went ill-formed, or a workspace that cannot be built:
      // there is no board to hand this to, and no body to answer with.
      socket.destroy()
    }
  }
}

/**
 * The session rows `GET /api/workspaces` carries (design-00003 §5), off the very
 * list `GET /api/sessions` serves: the switcher's two counts and the desktop
 * notifications need these fields of it and no more.
 */
function sessionsOf(board: Board) {
  return board.sessions.list().map(({ id, kind, sourceId, status, awaiting }) => ({
    id,
    kind,
    sourceId,
    status,
    awaiting,
  }))
}

/** What an add names (design-00003 §5): the project root, and optionally the display name. */
function addition(body: unknown): { path: string; name?: string } {
  const { path, name } = (body ?? {}) as { path?: unknown; name?: unknown }
  if (typeof path !== 'string' || path === '') {
    throw new WorkspaceRefusedError('a workspace is added by the path of its project root')
  }
  if (name !== undefined && typeof name !== 'string') {
    throw new WorkspaceRefusedError('name is the display name of the workspace, as one string')
  }
  return { path, name }
}

const unregistered = (wid: string): string => `workspace ${JSON.stringify(wid)} is not registered`

/**
 * The host's refusals in the shape the board answers in — `{error}` and the
 * status read off the error's type (server.ts `errorHandler`). An add the
 * registry refused is 422 and a write that failed is 500 (design-00003 §5); so
 * is a registry a hand edit made ill-formed while the process was up, which
 * spec-00011-FR-18 rules on only for the start.
 */
function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction): void {
  res.status(error instanceof WorkspaceRefusedError ? 422 : 500).json({ error: error.message })
}
