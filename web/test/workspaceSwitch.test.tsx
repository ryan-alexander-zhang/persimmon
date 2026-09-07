// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocGraph, DocNode } from '../../src/docRepository.ts'
import type { ItemsView } from '../../src/requirements.ts'
import { Board } from '../src/Board.tsx'
import { type ConfigPayload, type SessionListing, type WorkspaceSummary, boardApi, hostApi } from '../src/api.ts'
import { connectWorkspaceEvents } from '../src/eventSocket.ts'
import { LAST_WORKSPACE_KEY, useWorkspace } from '../src/workspace.ts'

// The whole board is rendered per case, in a suite whose files run side by side.
vi.setConfig({ testTimeout: 30_000 })

/**
 * The terminals under the test's hand, as terminalSessions.test.tsx stands them
 * in: what spec-00011-AC-8.3 promises is about the **instance** — a workspace
 * left and come back to must be the same terminal, with the same buffer and the
 * same scroll position, which nothing above this level can observe.
 */
const xterms = vi.hoisted(() => ({
  made: [] as Array<{ written: string[]; viewportY: number; disposed: boolean }>,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: Record<string, unknown>
    written: string[] = []
    viewportY = 0
    cols = 80
    rows = 24
    disposed = false

    constructor(options: Record<string, unknown>) {
      this.options = options
      xterms.made.push(this as unknown as (typeof xterms.made)[number])
    }

    loadAddon(addon: { activate?: (terminal: unknown) => void }) {
      addon.activate?.(this)
    }
    open() {}
    write(data: string) {
      this.written.push(data)
    }
    onData() {}
    resize() {}
    dispose() {
      this.disposed = true
    }
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    activate() {}
    dispose() {}
    proposeDimensions() {
      return { cols: 100, rows: 40 }
    }
    fit() {}
  },
}))

/** One terminal channel, kept by the url it was dialled on (design-00003 §5). */
class FakeSocket {
  static opened: FakeSocket[] = []
  static readonly OPEN = 1
  readyState = 1
  closed = false
  private listeners: Record<string, (event: { data: string }) => void> = {}

  constructor(readonly url: string) {
    FakeSocket.opened.push(this)
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners[type] = listener
  }
  removeEventListener() {}
  send() {}
  emit(data: string) {
    this.listeners.message?.({ data })
  }
  close() {
    this.closed = true
  }
}

const alpha = boardApi('alpha')
const demo = boardApi('demo')

function node(overrides: Partial<DocNode> = {}): DocNode {
  return {
    id: 'spec-00001-a',
    path: 'spec/a.md',
    type: 'spec',
    status: 'active',
    title: 'Alpha spec',
    relations: {},
    ok: true,
    problems: [],
    ...overrides,
  }
}

function graphOf(nodes: DocNode[]): DocGraph {
  return { nodes, edges: [], issues: [], diagnostics: [], idOwners: {} }
}

const ALPHA_GRAPH = graphOf([node(), node({ id: 'idea-00001-a', path: 'idea/a.md', type: 'idea', title: 'Alpha idea' })])
const DEMO_GRAPH = graphOf([node({ id: 'spec-00002-d', path: 'spec/d.md', title: 'Demo spec' })])

/** Enough of a chain for a document to be drillable (spec-00001-FR-35). */
const ITEMS: ItemsView = {
  items: [
    {
      id: 'spec-00001-FR-1',
      text: 'what spec-00001-FR-1 asks of the system',
      criteria: [{ id: 'spec-00001-AC-1.1', text: 'Given a board When it loads Then it works', rows: [] }],
      rows: [],
      coverage: 'uncovered',
    },
  ],
  diagnostics: [],
}

const CONFIG: ConfigPayload = {
  types: { idea: 'living', spec: 'living' },
  relations: [],
  flow: {},
  focus: {},
  agents: [{ name: 'claude', headless: false, source: 'project' }],
  entry: ['idea'],
  carries: {},
  maxSessions: 3,
  clarifiable: [],
  auditable: [],
}

function summary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return {
    id: 'alpha',
    name: 'Alpha',
    path: '/tmp/alpha',
    availability: 'available',
    sessions: [],
    ...overrides,
  }
}

const REGISTERED = [summary(), summary({ id: 'demo', name: 'Demo', path: '/tmp/demo' })]

/** The registry as `GET /api/workspaces` answers it; the test names the entries. */
let registry: WorkspaceSummary[]

function serveRegistry() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('/api/workspaces')) {
        return { ok: true, status: 200, statusText: 'OK', json: async () => ({ workspaces: registry }) }
      }
      throw new TypeError(`fetch failed: ${url}`)
    }),
  )
}

/** Each workspace answers with its own graph and its own sessions (spec-00011-FR-12). */
let alphaGraph: DocGraph
let demoGraph: DocGraph
let alphaSessions: SessionListing[]

function serveBoards() {
  alphaGraph = ALPHA_GRAPH
  demoGraph = DEMO_GRAPH
  alphaSessions = []
  for (const [client, graph, sessions] of [
    [alpha, () => alphaGraph, () => alphaSessions],
    [demo, () => demoGraph, () => [] as SessionListing[]],
  ] as const) {
    vi.spyOn(client, 'graph').mockImplementation(async () => structuredClone(graph()))
    vi.spyOn(client, 'sessions').mockImplementation(async () => structuredClone(sessions()))
    vi.spyOn(client, 'config').mockResolvedValue(CONFIG)
    vi.spyOn(client, 'items').mockResolvedValue(ITEMS)
    vi.spyOn(client, 'transitions').mockResolvedValue([])
    vi.spyOn(client, 'doc').mockResolvedValue({ path: 'spec/a.md', content: '# Spec\n\nbody\n', hash: 'hash-1' })
    vi.spyOn(client, 'nextSteps').mockResolvedValue([])
  }
}

const SETTLED = { timeout: 20_000, interval: 25 }

/** Open the board at `path` and wait for the first node of the workspace it lands on. */
async function openAt(path: string, firstNode: string) {
  history.replaceState(null, '', path)
  const rendered = render(<Board />)
  await waitFor(() => expect(screen.getByTestId(`node-${firstNode}`)).toBeTruthy(), SETTLED)
  return rendered
}

/**
 * A switch, driven the way the browser's back and forward buttons drive one:
 * design-00003 §6 puts `popstate` and the switcher on the same path, and the
 * switcher itself is T9's.
 */
async function goTo(wid: string, firstNode: string) {
  history.pushState(null, '', `/w/${wid}`)
  await act(async () => {
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await waitFor(() => expect(screen.getByTestId(`node-${firstNode}`)).toBeTruthy(), SETTLED)
}

beforeEach(() => {
  registry = REGISTERED
  xterms.made.length = 0
  FakeSocket.opened = []
  localStorage.clear()
  history.replaceState(null, '', '/')
  serveRegistry()
  serveBoards()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** design-00003 §6: the `wid` is bound into every call, never into a shared base. */
describe('boardApi', () => {
  it('puts every path under its own workspace prefix', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      void url
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)

    await boardApi('one').config()
    await boardApi('one').doc('spec-00001-a')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/w/one/api/config',
      '/w/one/api/docs/spec-00001-a',
    ])
  })

  it('keeps two workspaces clients side by side, each addressing its own', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      void url
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({}) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const one = boardApi('one')
    const two = boardApi('two')

    await one.graph()
    await two.graph()
    await one.graph()

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/w/one/api/graph',
      '/w/two/api/graph',
      '/w/one/api/graph',
    ])
    expect(boardApi('one')).toBe(one)
  })

  /** design-00003 §5: the registry is the host's, so these three keep one `/api`. */
  it('addresses the host level calls without a workspace prefix', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      void url
      void init
      return { ok: true, status: 200, statusText: 'OK', json: async () => ({ workspaces: REGISTERED }) }
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await hostApi.workspaces()).toEqual(REGISTERED)
    await hostApi.addWorkspace('/tmp/demo', 'Demo')
    await hostApi.removeWorkspace('demo')

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/workspaces',
      '/api/workspaces',
      '/api/workspaces/demo',
    ])
    expect(fetchMock.mock.calls.map(([, init]) => init.method)).toEqual(['GET', 'POST', 'DELETE'])
  })

  it('dials the host channel on the host path', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    connectWorkspaceEvents(() => {}).close()

    expect(FakeSocket.opened.at(-1)!.url).toMatch(/^ws:\/\/.*\/api\/workspaces\/events$/)
  })
})

/** design-00003 §6: `/` is the entry page, `/w/<wid>` is the current workspace. */
describe('the workspace the page opens on', () => {
  // spec-00011-AC-13.2, the page half: the entry point opens the workspace this
  // browser was last in; that the command prints that entry point is AC-14.3's.
  it('goes to the workspace this browser was last in', async () => {
    localStorage.setItem(LAST_WORKSPACE_KEY, 'demo')
    const { result } = renderHook(() => useWorkspace())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', wid: 'demo' }))
    expect(location.pathname).toBe('/w/demo')
  })

  // spec-00011-AC-13.3, the page half with nothing remembered: the first entry
  // of the registry. That the landing skips an unavailable entry is pinned by
  // spec-00011-AC-4.5's case in workspaceSwitcher.test.tsx, on the same rule.
  it('goes to the first available entry when nothing was remembered', async () => {
    const { result } = renderHook(() => useWorkspace())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', wid: 'alpha' }))
    expect(location.pathname).toBe('/w/alpha')
  })

  it('forgets a remembered workspace that is no longer registered', async () => {
    localStorage.setItem(LAST_WORKSPACE_KEY, 'gone')
    const { result } = renderHook(() => useWorkspace())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', wid: 'alpha' }))
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe('alpha')
  })

  it('shows the empty state when nothing is registered', async () => {
    registry = []
    const { result } = renderHook(() => useWorkspace())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'empty' }))
    expect(location.pathname).toBe('/')
  })

  // spec-00011-AC-9.2 — the page state itself is T9's; nothing is read from the
  // workspace either way (spec-00011-AC-9.3).
  it('names an unregistered workspace and reads nothing from it', async () => {
    history.replaceState(null, '', '/w/ghost')
    render(<Board />)

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('ghost'), SETTLED)
    expect(vi.mocked(alpha.graph)).not.toHaveBeenCalled()
    expect(vi.mocked(demo.graph)).not.toHaveBeenCalled()
    const asked = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))
    expect(asked.every((url) => url === '/api/workspaces')).toBe(true)
  })

  // spec-00011-AC-9.3
  it('gives the reason for an unavailable workspace and reads nothing from it', async () => {
    registry = [summary({ id: 'broken', availability: 'missing', error: 'the directory /tmp/broken is gone' })]
    history.replaceState(null, '', '/w/broken')
    render(<Board />)

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('/tmp/broken is gone'), SETTLED)
    // Nothing was addressed under the workspace: the only call is the registry's.
    const asked = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url))
    expect(asked.every((url) => url === '/api/workspaces')).toBe(true)
  })

  // spec-00011-AC-11.3 — every settle point writes it, so the last tab to settle wins.
  it('remembers the workspace a direct address settles on', async () => {
    history.replaceState(null, '', '/w/demo')
    const { result } = renderHook(() => useWorkspace())

    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', wid: 'demo' }))
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe('demo')
  })
})

describe('switching workspace', () => {
  // spec-00011-AC-8.2 — the URL says which workspace, and the page never reloads.
  it('pushes the new workspace address and remembers it', async () => {
    const { result } = renderHook(() => useWorkspace())
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', wid: 'alpha' }))

    act(() => void result.current.switchWorkspace('demo'))

    expect(location.pathname).toBe('/w/demo')
    expect(result.current.state).toEqual({ status: 'ready', wid: 'demo' })
    expect(localStorage.getItem(LAST_WORKSPACE_KEY)).toBe('demo')
  })

  // spec-00011-FR-9 as this task owes it: the refusal is returned, the current
  // workspace does not move. What is shown for it is T9's.
  it('refuses an unavailable target and leaves the current workspace where it is', async () => {
    registry = [
      summary(),
      summary({ id: 'broken', availability: 'invalidConfig', error: 'max_sessions must be a positive integer' }),
    ]
    const { result } = renderHook(() => useWorkspace())
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', wid: 'alpha' }))

    let refusal: string | undefined
    act(() => {
      refusal = result.current.switchWorkspace('broken')
    })

    expect(refusal).toBe('max_sessions must be a positive integer')
    expect(result.current.state).toEqual({ status: 'ready', wid: 'alpha' })
    expect(location.pathname).toBe('/w/alpha')
  })

  // spec-00011-AC-8.1
  it('replaces the graph and the navigation sidebar with the new workspace own', async () => {
    localStorage.setItem('w:alpha:whiteboard-sidebar-expanded', JSON.stringify(['idea', 'spec']))
    localStorage.setItem('w:demo:whiteboard-sidebar-expanded', JSON.stringify(['spec']))
    await openAt('/w/alpha', 'spec-00001-a')
    expect(screen.getByRole('button', { name: /Alpha idea/ })).toBeTruthy()

    await goTo('demo', 'spec-00002-d')

    expect(screen.queryByTestId('node-spec-00001-a')).toBeNull()
    expect(screen.queryByRole('button', { name: /Alpha idea/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Demo spec/ })).toBeTruthy()
  })

  // spec-00011-AC-8.7 — back and forward are switches like any other.
  it('follows the browser back button between two workspaces', async () => {
    await openAt('/w/alpha', 'spec-00001-a')
    await goTo('demo', 'spec-00002-d')

    await goTo('alpha', 'spec-00001-a')

    expect(screen.getByTestId('node-spec-00001-a')).toBeTruthy()
  })

  // spec-00011-AC-8.4 — the selection is held by id and comes back with it.
  it('brings the selection back when the workspace is', async () => {
    await openAt('/w/alpha', 'spec-00001-a')
    fireEvent.click(screen.getByTestId('node-spec-00001-a'))
    await waitFor(() => expect(screen.getByLabelText('Requirements of spec-00001-a')).toBeTruthy(), SETTLED)

    await goTo('demo', 'spec-00002-d')
    expect(screen.queryByLabelText('Requirements of spec-00001-a')).toBeNull()
    await goTo('alpha', 'spec-00001-a')

    await waitFor(() => expect(screen.getByLabelText('Requirements of spec-00001-a')).toBeTruthy(), SETTLED)
  })

  // spec-00011-AC-8.5 — close-nearest, the very rule a refresh follows: what the
  // drilldown pointed at has gone, so the drilldown goes and nothing else does.
  it('closes a drilldown whose document was deleted while the user was away', async () => {
    await openAt('/w/alpha', 'spec-00001-a')
    fireEvent.click(screen.getByTestId('node-spec-00001-a'))
    await userEvent.click(await screen.findByRole('button', { name: /Expand as sub-canvas/ }, SETTLED))
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toBeTruthy(), SETTLED)

    await goTo('demo', 'spec-00002-d')
    alphaGraph = graphOf([node({ id: 'idea-00001-a', path: 'idea/a.md', type: 'idea', title: 'Alpha idea' })])
    await goTo('alpha', 'idea-00001-a')

    // Back on the top-level board, and the rest of the workspace is still drawn.
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'breadcrumb' })).toBeNull(), SETTLED)
    expect(screen.getByTestId('node-idea-00001-a')).toBeTruthy()
  })

  /**
   * spec-00011-FR-8 — the editor is presentation state like the rest: a
   * workspace left mid-write comes back with its buffer. A draft is on no
   * document yet (spec-00001-FR-53), so nothing in the graph can take it away.
   */
  it('brings an unsaved draft back with the workspace', async () => {
    vi.spyOn(alpha, 'createPrefill').mockResolvedValue({
      idPrefix: 'idea-00002-',
      template: '---\nid: \nstatus: draft\n---\n\n# New\n',
    })
    await openAt('/w/alpha', 'spec-00001-a')
    await userEvent.click(screen.getByRole('button', { name: 'New' }))
    await userEvent.type(screen.getByLabelText('Slug'), 'a-new-idea')
    await userEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(
      () => expect(screen.getByTestId('editor-host').textContent).toContain('id: idea-00002-a-new-idea'),
      SETTLED,
    )

    await goTo('demo', 'spec-00002-d')
    expect(screen.queryByTestId('editor-host')).toBeNull()
    await goTo('alpha', 'spec-00001-a')

    await waitFor(
      () => expect(screen.getByTestId('editor-host').textContent).toContain('id: idea-00002-a-new-idea'),
      SETTLED,
    )
  })

  // spec-00011-AC-8.5 — the same one-level closure the drilldown gets: the
  // editor's document has left the graph, so the editor goes and nothing else.
  it('closes an editor whose document was deleted while the user was away', async () => {
    await openAt('/w/alpha', 'spec-00001-a')
    fireEvent.click(screen.getByTestId('node-spec-00001-a'))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }, SETTLED))
    await waitFor(() => expect(screen.getByTestId('editor-host')).toBeTruthy(), SETTLED)

    await goTo('demo', 'spec-00002-d')
    alphaGraph = graphOf([node({ id: 'idea-00001-a', path: 'idea/a.md', type: 'idea', title: 'Alpha idea' })])
    await goTo('alpha', 'idea-00001-a')

    expect(screen.queryByTestId('editor-host')).toBeNull()
    // The rest of the workspace is still drawn.
    expect(screen.getByTestId('node-idea-00001-a')).toBeTruthy()
  })

  // spec-00011-AC-8.6 — the palette searches the current workspace and no other.
  it('finds only the current workspace documents in the command palette', async () => {
    await openAt('/w/alpha', 'spec-00001-a')
    await goTo('demo', 'spec-00002-d')

    await userEvent.click(screen.getByRole('button', { name: /Find a document/ }))
    await userEvent.type(screen.getByPlaceholderText('Find a document by id or title'), 'spec-00001-a')

    expect(screen.queryByRole('option', { name: /spec-00001-a/ })).toBeNull()
  })

  // spec-00011-AC-11.1 — the expanded state is one workspace's, under its own key.
  it('keeps the expanded type groups of each workspace apart', async () => {
    localStorage.setItem('w:alpha:whiteboard-sidebar-expanded', JSON.stringify([]))
    localStorage.setItem('w:demo:whiteboard-sidebar-expanded', JSON.stringify(['spec']))

    await openAt('/w/alpha', 'spec-00001-a')
    expect(screen.queryByRole('button', { name: /Alpha spec/ })).toBeNull()

    await goTo('demo', 'spec-00002-d')

    expect(screen.getByRole('button', { name: /Demo spec/ })).toBeTruthy()
  })

  // spec-00011-AC-11.2 — browser-level preferences do not move with a workspace.
  it('leaves the sidebar and the theme as they were', async () => {
    localStorage.setItem('whiteboard-sidebar', 'closed')
    localStorage.setItem('whiteboard-theme', 'dark')
    await openAt('/w/alpha', 'spec-00001-a')
    expect(screen.queryByRole('navigation', { name: 'Documents' })).toBeNull()

    await goTo('demo', 'spec-00002-d')

    expect(screen.queryByRole('navigation', { name: 'Documents' })).toBeNull()
    expect(localStorage.getItem('whiteboard-theme')).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  /**
   * design-00003 §6: every read carries the `wid` it went out under, and an
   * answer that lands after the workspace has moved on is dropped — the
   * discipline `reading` keeps for order, kept here for context (issue-00018).
   */
  it('drops an answer that arrives after the workspace has moved on', async () => {
    await openAt('/w/demo', 'spec-00002-d')
    // The read alpha's switch issues is held open, so it can land late.
    let release = () => {}
    vi.mocked(alpha.graph).mockImplementationOnce(
      async () =>
        new Promise<DocGraph>((resolve) => {
          release = () => resolve(graphOf([node({ id: 'spec-09999-late', title: 'A late answer' })]))
        }),
    )

    history.pushState(null, '', '/w/alpha')
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await waitFor(() => expect(vi.mocked(alpha.graph)).toHaveBeenCalled(), SETTLED)
    await goTo('demo', 'spec-00002-d')
    await act(async () => {
      release()
    })

    expect(screen.queryByTestId('node-spec-09999-late')).toBeNull()
    expect(screen.getByTestId('node-spec-00002-d')).toBeTruthy()
  })
})

/** spec-00011-AC-8.3 — a terminal is unmounted by a switch, never disposed. */
describe('the terminals of a workspace across a switch', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeSocket)
    alphaSessions = [
      {
        id: 's1',
        kind: 'clarify',
        agent: 'claude',
        sourceId: 'spec-00001-a',
        status: 'running',
        startedAt: '2026-01-01T00:00:00.000Z',
      } as SessionListing,
    ]
  })

  it('keeps the instance, its output and its scroll position', async () => {
    await openAt('/w/alpha', 'spec-00001-a')
    await waitFor(() => expect(xterms.made).toHaveLength(1), SETTLED)
    const first = xterms.made[0]!
    const channel = FakeSocket.opened.find((one) => one.url.includes('/w/alpha/api/terminal'))!
    act(() => channel.emit('what alpha printed\r\n'))
    // The reader scrolls back through the output before leaving the workspace.
    first.viewportY = 42

    await goTo('demo', 'spec-00002-d')
    await goTo('alpha', 'spec-00001-a')

    expect(xterms.made).toHaveLength(1)
    expect(first.disposed).toBe(false)
    expect(first.written.join('')).toContain('what alpha printed')
    expect(first.viewportY).toBe(42)
    expect(channel.closed).toBe(false)
  })
})

/**
 * spec-00011-FR-10: a reload comes back to the same workspace and to nothing
 * else — the presentation state is memory, and memory is what a reload loses.
 */
describe('reloading the page', () => {
  // spec-00011-AC-10.1
  it('comes back to the same workspace', async () => {
    const { unmount } = await openAt('/w/demo', 'spec-00002-d')
    unmount()

    render(<Board />)

    await waitFor(() => expect(screen.getByTestId('node-spec-00002-d')).toBeTruthy(), SETTLED)
    expect(location.pathname).toBe('/w/demo')
  })

  // spec-00011-AC-10.2
  it('comes back to the top level, not to the drilldown', async () => {
    const { unmount } = await openAt('/w/demo', 'spec-00002-d')
    fireEvent.click(screen.getByTestId('node-spec-00002-d'))
    await userEvent.click(await screen.findByRole('button', { name: /Expand as sub-canvas/ }, SETTLED))
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'breadcrumb' })).toBeTruthy(), SETTLED)
    unmount()

    render(<Board />)

    await waitFor(() => expect(screen.getByTestId('node-spec-00002-d')).toBeTruthy(), SETTLED)
    expect(screen.queryByRole('navigation', { name: 'breadcrumb' })).toBeNull()
  })
})
