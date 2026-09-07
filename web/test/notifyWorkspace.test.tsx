// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { DocGraph, DocNode } from '../../src/docRepository.ts'
import { Board } from '../src/Board.tsx'
import { type ConfigPayload, type SessionListing, type WorkspaceSummary, boardApi } from '../src/api.ts'

/**
 * The desktop notifications of every open workspace (spec-00011-FR-17). The
 * harness is notifications.test.tsx's — a notification constructor under the
 * test's hand, `document.hidden` / `hasFocus` driven from here — with two
 * workspaces instead of one and the host's own summary as the source the notices
 * are diffed from (design-00003 §9).
 */

// The whole board is rendered per case, in a suite whose files run side by side.
vi.setConfig({ testTimeout: 30_000 })

/** Where the switch's boolean is kept (design-00002 §13); a test starts from a clean one. */
const SWITCH_KEY = 'whiteboard-desktop-notifications'

const alpha = boardApi('alpha')
const demo = boardApi('demo')

function node(overrides: Partial<DocNode> = {}): DocNode {
  return {
    id: 'prd-00001-a',
    path: 'prd/a.md',
    type: 'prd',
    status: 'draft',
    title: 'Alpha prd',
    relations: {},
    ok: true,
    problems: [],
    ...overrides,
  }
}

function graphOf(nodes: DocNode[]): DocGraph {
  return { nodes, edges: [], issues: [], diagnostics: [], idOwners: {} }
}

const ALPHA_GRAPH = graphOf([node()])
const DEMO_GRAPH = graphOf([node({ id: 'prd-00002-d', path: 'prd/d.md', title: 'Demo prd' })])

const CONFIG: ConfigPayload = {
  types: { prd: 'living' },
  relations: [],
  flow: {},
  focus: {},
  agents: [{ name: 'claude', headless: false, source: 'project' }],
  entry: [],
  carries: {},
  maxSessions: 3,
  clarifiable: [],
  auditable: [],
}

/** One row of `GET /api/sessions` (design-00001 §7). */
function listing(overrides: Partial<SessionListing> = {}): SessionListing {
  return {
    id: 's1',
    kind: 'clarify',
    agent: 'claude',
    sourceId: 'prd-00001-a',
    status: 'running',
    startedAt: '2026-02-01T09:00:00.000Z',
    ...overrides,
  }
}

/** The one session `demo` is running, on `demo`'s own document. */
function demoSession(overrides: Partial<SessionListing> = {}): SessionListing {
  return listing({ id: 'd1', sourceId: 'prd-00002-d', ...overrides })
}

/**
 * The browser's notification, under the test's hand — jsdom implements none,
 * which is the seam `notify.ts` reads the constructor off the global for
 * (design-00002 §13).
 */
class Notice {
  static permission: NotificationPermission = 'granted'
  static made: Notice[] = []
  onclick: (() => void) | null = null
  onclose: (() => void) | null = null
  closed = 0

  constructor(
    readonly title: string,
    readonly options: NotificationOptions = {},
  ) {
    Notice.made.push(this)
  }

  close(): void {
    this.closed += 1
    this.onclose?.()
  }

  static requestPermission(): Promise<NotificationPermission> {
    return Promise.resolve(Notice.permission)
  }
}

/** Everything a notification carries, as one string: what must and must not be in it. */
function content(notice: Notice): string {
  return `${notice.title} ${JSON.stringify(notice.options)}`
}

/** The docs channel of the workspace on show, and the host's own (design-00003 §5). */
class Socket {
  static channel?: Socket
  static host?: Socket
  static readonly OPEN = 1
  readyState = 1
  private listeners: Record<string, Array<(event: { data: string }) => void>> = {}

  constructor(readonly url: string) {
    if (url.endsWith('/api/workspaces/events')) Socket.host = this
    else if (url.includes('/api/events')) Socket.channel = this
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    ;(this.listeners[type] ??= []).push(listener)
  }

  removeEventListener() {}
  send() {}
  close() {}

  signal() {
    for (const listener of this.listeners.message ?? []) listener({ data: '' })
  }
}

async function settle(links = 4) {
  for (let link = 0; link < links; link += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** A change pushed from the server: the board re-reads, and so does the union. */
async function push() {
  await act(async () => {
    Socket.channel?.signal()
    Socket.host?.signal()
  })
  await settle()
}

/** What each workspace's summary carries, and what its own board serves. */
let alphaSessions: SessionListing[]
let demoSessions: SessionListing[]
let demoState: Partial<WorkspaceSummary>
let registered: string[]

/** The next union read, held on its way back (issue-00018). */
let release: (() => void) | undefined
let holding = false

function holdUnion() {
  holding = true
}

function summary(id: string, name: string, sessions: SessionListing[], overrides: Partial<WorkspaceSummary> = {}) {
  return {
    id,
    name,
    path: `/tmp/${id}`,
    availability: 'available',
    sessions: sessions.map(({ id: sessionId, kind, sourceId, status, awaiting }) => ({
      id: sessionId,
      kind,
      sourceId,
      status,
      awaiting,
    })),
    ...overrides,
  }
}

function registry() {
  const all = [summary('alpha', 'Alpha', alphaSessions), summary('demo', 'Demo', demoSessions, demoState)]
  return { workspaces: all.filter((one) => registered.includes(one.id)) }
}

function serve() {
  alphaSessions = []
  demoSessions = []
  demoState = {}
  registered = ['alpha', 'demo']
  for (const [client, graph, sessions] of [
    [alpha, () => ALPHA_GRAPH, () => alphaSessions],
    [demo, () => DEMO_GRAPH, () => demoSessions],
  ] as const) {
    vi.spyOn(client, 'graph').mockImplementation(async () => structuredClone(graph()))
    vi.spyOn(client, 'sessions').mockImplementation(async () => structuredClone(sessions()))
    vi.spyOn(client, 'config').mockResolvedValue(CONFIG)
    vi.spyOn(client, 'transitions').mockResolvedValue([])
    vi.spyOn(client, 'nextSteps').mockResolvedValue([])
  }
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input)
    if (!url.endsWith('/api/workspaces')) throw new TypeError(`fetch failed: ${url}`)
    // Read now, not when the response is awaited: a held response carries the
    // state the host had when the read went out (issue-00018).
    const body = registry()
    const answer = { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response
    if (!holding) return answer
    holding = false
    return new Promise<Response>((resolve) => {
      release = () => resolve(answer)
    })
  })
}

/** The board, up, on `wid` and with its first node drawn. */
async function openBoard(wid = 'alpha', firstNode = 'prd-00001-a') {
  history.replaceState(null, '', `/w/${wid}`)
  const rendered = render(<Board />)
  await waitFor(() => expect(screen.getByTestId(`node-${firstNode}`)).toBeTruthy(), { timeout: 20_000 })
  await settle()
  return rendered
}

/** Away = hidden or unfocused (design-00002 §13). */
let hidden = false
let focused = true

async function leave() {
  focused = false
  await act(async () => void window.dispatchEvent(new Event('blur')))
  await settle()
}

async function comeBack() {
  focused = true
  await act(async () => void window.dispatchEvent(new Event('focus')))
  await settle()
}

/** The one notification a case has posted, clicked as the user would click it. */
async function click(notice: Notice) {
  await act(async () => void notice.onclick?.())
  await settle()
}

beforeEach(() => {
  Socket.channel = undefined
  Socket.host = undefined
  release = undefined
  holding = false
  hidden = false
  focused = true
  localStorage.clear()
  localStorage.setItem(SWITCH_KEY, 'on')
  Notice.permission = 'granted'
  Notice.made = []
  history.replaceState(null, '', '/')
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('Notification', Notice)
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused)
  vi.spyOn(window, 'focus').mockImplementation(() => {})
  vi.spyOn(toast, 'error').mockImplementation(() => 'id')
  vi.spyOn(toast, 'message').mockImplementation(() => 'id')
  serve()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('a session of a workspace that is not the one on show', () => {
  /**
   * spec-00011-AC-17.1 — the page is away on `alpha` and it is `demo`'s session
   * that starts waiting: one notification, and its title says which project it
   * came from.
   */
  it('posts a notification whose title starts with the workspace display name', async () => {
    await openBoard()
    await leave()

    demoSessions = [demoSession({ awaiting: true })]
    await push()

    expect(Notice.made).toHaveLength(1)
    expect(Notice.made[0]!.title.startsWith('Demo · ')).toBe(true)
    expect(Notice.made[0]!.options.body).toBe('awaiting')
  })

  /**
   * spec-00011-AC-17.6 — one session of each workspace turns to waiting in the
   * same away stint: two notices, and neither takes the other down. Replacement
   * is per workspace **and** session (design-00003 §9).
   */
  it('leaves another workspace notification standing', async () => {
    await openBoard()
    await leave()

    alphaSessions = [listing({ awaiting: true })]
    await push()
    demoSessions = [demoSession({ awaiting: true })]
    await push()

    expect(Notice.made).toHaveLength(2)
    expect(Notice.made[0]!.closed).toBe(0)
    expect(Notice.made[1]!.closed).toBe(0)
    expect(Notice.made.map((notice) => notice.options.tag?.split(':').slice(0, 2).join(':'))).toEqual([
      'alpha:s1',
      'demo:d1',
    ])
  })

  /**
   * spec-00011-FR-17 — the replacement itself, per key: the second notice of
   * `demo:d1` closes the first, and nothing else is touched (spec-00004-FR-6).
   */
  it('replaces an earlier notice of the same workspace and session', async () => {
    await openBoard()
    await leave()

    demoSessions = [demoSession({ awaiting: true })]
    await push()
    demoSessions = [demoSession({ status: 'exited', exitCode: 0 })]
    await push()

    expect(Notice.made).toHaveLength(2)
    expect(Notice.made[0]!.closed).toBe(1)
    expect(Notice.made[1]!.closed).toBe(0)
    expect(Notice.made[1]!.options.body).toBe('exited')
  })

  /**
   * spec-00011-AC-17.7 — the title is the display name, the kind and the
   * document id, the body is the state, and the workspace's directory path is
   * nowhere in either.
   */
  it('carries the display name, the kind, the id and the state, and nothing else', async () => {
    await openBoard()
    await leave()

    demoSessions = [demoSession({ awaiting: true })]
    await push()

    expect(Notice.made).toHaveLength(1)
    expect(Notice.made[0]!.title).toBe('Demo · clarify · prd-00002-d')
    expect(Notice.made[0]!.options.body).toBe('awaiting')
    expect(content(Notice.made[0]!)).not.toContain('/tmp/demo')
  })

  /**
   * spec-00011-AC-17.8 — a workspace's sessions as the page first reads them are
   * a baseline, not news: `demo`'s session is already waiting when the page
   * loads, and it is the page being reloaded that must not announce it.
   */
  it('says nothing about a session that was already waiting when the page loaded', async () => {
    demoSessions = [demoSession({ awaiting: true })]
    await openBoard()

    expect(Notice.made).toHaveLength(0)
  })

  /**
   * spec-00011-AC-17.9 — the catch-up on going away covers every open workspace,
   * not only the one on show (spec-00004-FR-2 as amended).
   */
  it('catches up on another workspace waiting session when the page goes away', async () => {
    demoSessions = [demoSession({ awaiting: true })]
    await openBoard()
    expect(Notice.made).toHaveLength(0)

    await leave()

    expect(Notice.made).toHaveLength(1)
    expect(Notice.made[0]!.title).toBe('Demo · clarify · prd-00002-d')
    // The same stint owes nothing more, however often the page is left again
    // (spec-00004-AC-2.3).
    await comeBack()
    await leave()
    expect(Notice.made).toHaveLength(1)
  })

  /**
   * spec-00011-AC-12.6 — the end toast is this board's: `demo`'s session ending
   * is not news on `alpha`'s page (spec-00003-FR-7's scope). The desktop notice
   * is the one feedback that crosses (spec-00011-FR-17).
   */
  it('raises no end toast on this page when another workspace session ends', async () => {
    demoSessions = [demoSession()]
    await openBoard()
    await leave()

    demoSessions = [demoSession({ status: 'exited', exitCode: 0 })]
    await push()

    expect(toast.message).not.toHaveBeenCalled()
    expect(Notice.made).toHaveLength(1)
  })

  /**
   * issue-00018 — one ordered queue over the union: a read taken before the one
   * that follows it must be folded in before it, so the older reading never puts
   * back a waiting mark the newer one has already taken down. The page then goes
   * away with nothing waiting, and is owed nothing.
   */
  it('does not let an older union read put back a waiting mark', async () => {
    demoSessions = [demoSession()]
    await openBoard()

    // The waiting reading, held on its way back.
    holdUnion()
    demoSessions = [demoSession({ awaiting: true })]
    await push()

    // Answered in front of the board and printing again: the mark is down, and
    // this signal queues behind the held read rather than racing it.
    demoSessions = [demoSession({ awaiting: false })]
    await push()
    await act(async () => void release?.())
    await settle(6)

    await leave()

    expect(Notice.made).toHaveLength(0)
  })
})

describe('clicking a notification of another workspace', () => {
  /**
   * spec-00011-AC-17.2 — the notice came from `demo` while `alpha` was on show:
   * the click switches workspace and, once `demo`'s own listing has landed,
   * shows that session in the terminal panel.
   */
  it('switches to that workspace and shows the session', async () => {
    await openBoard()
    await leave()

    demoSessions = [demoSession({ awaiting: true })]
    await push()
    expect(Notice.made).toHaveLength(1)

    await click(Notice.made[0]!)

    expect(window.focus).toHaveBeenCalled()
    await waitFor(() => expect(location.pathname).toBe('/w/demo'), { timeout: 20_000 })
    await waitFor(() => expect(screen.getByTestId('node-prd-00002-d')).toBeTruthy(), { timeout: 20_000 })
    await waitFor(() => expect(screen.getByLabelText('Agent session').textContent).toContain('prd-00002-d'), {
      timeout: 20_000,
    })
  })

  /**
   * spec-00011-AC-17.3 — the workspace the notice came from is already the one on
   * show: nothing is switched and the session is shown (spec-00004-FR-5).
   */
  it('shows the session without switching when that workspace is already current', async () => {
    await openBoard('demo', 'prd-00002-d')
    await leave()

    demoSessions = [demoSession({ awaiting: true })]
    await push()
    await click(Notice.made[0]!)

    expect(location.pathname).toBe('/w/demo')
    await waitFor(() => expect(screen.getByLabelText('Agent session').textContent).toContain('prd-00002-d'), {
      timeout: 20_000,
    })
  })

  /**
   * spec-00011-AC-17.4 — the workspace was removed from the registry after the
   * notice went out: the click says so and the view does not move.
   */
  it('refuses and leaves the view alone when that workspace has been removed', async () => {
    await openBoard()
    await leave()

    demoSessions = [demoSession({ awaiting: true })]
    await push()
    expect(Notice.made).toHaveLength(1)

    registered = ['alpha']
    await push()
    await click(Notice.made[0]!)

    expect(toast.error).toHaveBeenCalledWith('no workspace demo is registered')
    expect(location.pathname).toBe('/w/alpha')
    expect(screen.getByTestId('node-prd-00001-a')).toBeTruthy()
  })

  /**
   * spec-00011-AC-17.5 — the workspace's directory was deleted after the notice
   * went out: the click carries the reason and the view does not move
   * (design-00003 §3).
   */
  it('refuses with the reason when that workspace is no longer available', async () => {
    await openBoard()
    await leave()

    demoSessions = [demoSession({ awaiting: true })]
    await push()
    expect(Notice.made).toHaveLength(1)

    demoState = { availability: 'missing', error: 'the directory /tmp/demo is not there any more' }
    await push()
    await click(Notice.made[0]!)

    expect(toast.error).toHaveBeenCalledWith('the directory /tmp/demo is not there any more')
    expect(location.pathname).toBe('/w/alpha')
    expect(screen.getByTestId('node-prd-00001-a')).toBeTruthy()
  })
})
