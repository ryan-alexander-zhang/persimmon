// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Board } from '../src/Board.tsx'
import { WorkspacePage, WorkspaceSwitcher } from '../src/WorkspaceSwitcher.tsx'
import type { WorkspaceSummary } from '../src/api.ts'
import { useWorkspace } from '../src/workspace.ts'

/** The host channel under the test's hand: the switcher dials it on mount (design-00003 §5). */
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
  /** What the host sends: a bare signal that the registry or some board's sessions moved. */
  signal() {
    this.listeners.message?.({ data: '' })
  }
  close() {
    this.closed = true
  }
}

function summary(overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
  return { id: 'alpha', name: 'Alpha', path: '/tmp/alpha', availability: 'available', sessions: [], ...overrides }
}

const DEMO = summary({ id: 'demo', name: 'Demo', path: '/tmp/demo' })

function json(status: number, body: unknown) {
  return { ok: status < 400, status, statusText: 'answer', json: async () => body }
}

/** The registry as `GET /api/workspaces` answers it, and every call made to the host. */
let registry: WorkspaceSummary[]
let fetches: string[]
/** What the two writing endpoints answer; a test that needs a refusal replaces one. */
let addAnswer: (body: { path: string; name?: string }) => ReturnType<typeof json>
let removeAnswer: (wid: string) => ReturnType<typeof json>

function serveHost() {
  registry = [summary()]
  fetches = []
  addAnswer = (body) => {
    registry = [...registry, summary({ id: 'added', name: body.name ?? 'added', path: body.path })]
    return json(201, { workspace: registry.at(-1) })
  }
  removeAnswer = (wid) => {
    if (!registry.some((entry) => entry.id === wid)) return json(404, { error: `no workspace ${wid} is registered` })
    registry = registry.filter((entry) => entry.id !== wid)
    return json(200, {})
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      fetches.push(`${method} ${url}`)
      if (url === '/api/workspaces' && method === 'GET') return json(200, { workspaces: registry })
      if (url === '/api/workspaces' && method === 'POST') return addAnswer(JSON.parse(String(init?.body)))
      if (url.startsWith('/api/workspaces/') && method === 'DELETE') {
        return removeAnswer(decodeURIComponent(url.slice('/api/workspaces/'.length)))
      }
      throw new TypeError(`fetch failed: ${url}`)
    }),
  )
}

/**
 * `Board()` minus the canvas: the same switcher in a bar and the same page
 * states, without the graph and config reads a full board render needs. The
 * canvas half of a switch is workspaceSwitch.test.tsx's.
 */
function Harness() {
  const workspace = useWorkspace()
  if (workspace.state.status !== 'ready') return <WorkspacePage workspace={workspace} />
  return (
    <div>
      <WorkspaceSwitcher workspace={workspace} />
      <p>board of {workspace.state.wid}</p>
    </div>
  )
}

/** Open the page at `path` and wait for the workspace it lands on to be settled. */
async function openAt(path: string, wid: string) {
  history.replaceState(null, '', path)
  render(<Harness />)
  await waitFor(() => expect(screen.getByText(`board of ${wid}`)).toBeTruthy())
}

function trigger() {
  return screen.getByLabelText('Switch workspace')
}

async function openMenu() {
  await userEvent.click(trigger())
  await screen.findByRole('menu')
}

async function removeRow(name: string) {
  await userEvent.click(screen.getByRole('menuitem', { name: `Remove ${name}` }))
}

beforeEach(() => {
  localStorage.clear()
  history.replaceState(null, '', '/')
  FakeSocket.opened = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.spyOn(toast, 'error').mockImplementation(() => 'id')
  serveHost()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the switcher', () => {
  // spec-00011-AC-7.1
  it('lists every entry in file order, marks the current one and counts its sessions', async () => {
    registry = [
      summary({ id: 'beta', name: 'Beta', path: '/tmp/beta' }),
      summary(),
      summary({
        id: 'gamma',
        name: 'Gamma',
        path: '/tmp/gamma',
        // An awaiting session is a running one that waits (sessionManager only
        // sets the flag on a running session), so one such session is both counts.
        sessions: [{ id: 's1', kind: 'cowrite', sourceId: 'spec-00001-x', status: 'running', awaiting: true }],
      }),
    ]
    await openAt('/w/alpha', 'alpha')

    await openMenu()

    const rows = screen.getAllByRole('menuitemradio')
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Beta'),
      expect.stringContaining('Alpha'),
      expect.stringContaining('Gamma'),
    ])
    expect(rows.map((row) => row.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(trigger().textContent).toContain('Alpha')
    expect(screen.getByText('/tmp/gamma')).toBeTruthy()
    expect(screen.getByLabelText('1 running in Gamma')).toBeTruthy()
    expect(screen.getByLabelText('1 awaiting in Gamma')).toBeTruthy()
    expect(screen.queryByLabelText(/in Beta/)).toBeNull()
  })

  // spec-00011-AC-7.2
  it('follows the counts of another workspace while it stays open', async () => {
    registry = [summary(), DEMO]
    await openAt('/w/alpha', 'alpha')
    await openMenu()
    expect(screen.queryByLabelText(/awaiting in Demo/)).toBeNull()

    registry = [
      summary(),
      { ...DEMO, sessions: [{ id: 's1', kind: 'ask', sourceId: 'spec-00001-x', status: 'running', awaiting: true }] },
    ]
    await act(async () => FakeSocket.opened.at(-1)!.signal())

    await waitFor(() => expect(screen.getByLabelText('1 awaiting in Demo')).toBeTruthy())
  })

  // spec-00011-AC-7.3
  it('lets the keyboard onto an unavailable row and its remove control', async () => {
    registry = [summary({ id: 'broken', name: 'Broken', path: '/tmp/broken', availability: 'missing', error: 'no directory at /tmp/broken' }), summary()]
    await openAt('/w/alpha', 'alpha')
    await openMenu()

    await userEvent.keyboard('{ArrowDown}')

    const row = screen.getByRole('menuitemradio', { name: /Broken/ })
    expect(document.activeElement).toBe(row)
    expect(row.getAttribute('data-disabled')).toBeNull()
    expect(row.textContent).toContain('no directory at /tmp/broken')

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Remove Broken' }))
    await userEvent.keyboard('{Enter}')

    await waitFor(() => expect(fetches).toContain('DELETE /api/workspaces/broken'))
  })

  // spec-00011-AC-9.1
  it('refuses an unavailable row with its reason and stays where it is', async () => {
    registry = [
      summary(),
      summary({
        id: 'broken',
        name: 'Broken',
        path: '/tmp/broken',
        availability: 'invalidConfig',
        error: 'max_sessions must be a positive integer',
      }),
    ]
    await openAt('/w/alpha', 'alpha')
    await openMenu()

    await userEvent.click(screen.getByRole('menuitemradio', { name: /Broken/ }))

    expect(toast.error).toHaveBeenCalledWith('max_sessions must be a positive integer')
    expect(location.pathname).toBe('/w/alpha')
    expect(screen.getByText('board of alpha')).toBeTruthy()
  })

  // spec-00011-AC-8.1 (the interface half: the choice itself; what the canvas
  // does with it is workspaceSwitch.test.tsx's)
  it('makes an available row the current workspace', async () => {
    registry = [summary(), DEMO]
    await openAt('/w/alpha', 'alpha')
    await openMenu()

    await userEvent.click(screen.getByRole('menuitemradio', { name: /Demo/ }))

    await waitFor(() => expect(screen.getByText('board of demo')).toBeTruthy())
    expect(location.pathname).toBe('/w/demo')
    expect(toast.error).not.toHaveBeenCalled()
  })

  // spec-00011-AC-14.2 (the page half: the entry a running process registered appears here)
  it('shows an entry added elsewhere while it stays open', async () => {
    await openAt('/w/alpha', 'alpha')
    await openMenu()

    registry = [summary(), DEMO]
    await act(async () => FakeSocket.opened.at(-1)!.signal())

    await waitFor(() => expect(screen.getByRole('menuitemradio', { name: /Demo/ })).toBeTruthy())
  })
})

describe('removing a workspace', () => {
  // spec-00011-AC-4.1
  it('drops the entry and refreshes the list', async () => {
    registry = [summary(), DEMO]
    await openAt('/w/alpha', 'alpha')
    await openMenu()

    await removeRow('Demo')

    await waitFor(() => expect(screen.queryByRole('menuitemradio', { name: /Demo/ })).toBeNull())
    expect(fetches).toContain('DELETE /api/workspaces/demo')
    expect(location.pathname).toBe('/w/alpha')
  })

  // spec-00011-AC-4.3
  it('lands the page on the first available entry when the current one goes', async () => {
    registry = [summary(), DEMO]
    await openAt('/w/demo', 'demo')
    await openMenu()

    await removeRow('Demo')

    await waitFor(() => expect(location.pathname).toBe('/w/alpha'))
    expect(screen.getByText('board of alpha')).toBeTruthy()
  })

  // spec-00011-AC-4.4
  it('lands on the empty state when the current one was the only entry', async () => {
    registry = [DEMO]
    await openAt('/w/demo', 'demo')
    await openMenu()

    await removeRow('Demo')

    await waitFor(() => expect(screen.getByText('No workspace is registered.')).toBeTruthy())
    expect(location.pathname).toBe('/')
    expect(screen.getByRole('button', { name: 'Add your first workspace' })).toBeTruthy()
  })

  // spec-00011-AC-4.5
  it('skips an unavailable entry when it lands', async () => {
    registry = [
      summary({ id: 'broken', name: 'Broken', path: '/tmp/broken', availability: 'noGit', error: '/tmp/broken is not a git repository' }),
      DEMO,
      summary(),
    ]
    await openAt('/w/demo', 'demo')
    await openMenu()

    await removeRow('Demo')

    await waitFor(() => expect(location.pathname).toBe('/w/alpha'))
  })

  // spec-00011-AC-5.1
  it('reports a refused removal and keeps the entry', async () => {
    registry = [summary(), DEMO]
    removeAnswer = () => json(409, { error: 'workspace "demo" has a running session' })
    await openAt('/w/alpha', 'alpha')
    await openMenu()

    await removeRow('Demo')

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('workspace "demo" has a running session'))
    expect(screen.getByRole('menuitemradio', { name: /Demo/ })).toBeTruthy()
  })
})

describe('adding a workspace', () => {
  async function fillIn(path: string, name?: string) {
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add workspace' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(screen.getByLabelText('Project directory'), path)
    if (name !== undefined) await userEvent.type(screen.getByLabelText('Display name (optional)'), name)
    return dialog
  }

  // spec-00011-AC-3.1
  it('keeps the dialog and what was typed when the add is refused', async () => {
    addAnswer = () => json(422, { error: 'no directory at /work/nope' })
    await openAt('/w/alpha', 'alpha')
    await openMenu()
    await fillIn('/work/nope')

    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('no directory at /work/nope'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText('Project directory') as HTMLInputElement).value).toBe('/work/nope')
  })

  // spec-00011-AC-2.1 (the interface half: the entry the registry gained is listed)
  it('closes on a successful add, lists the new entry and stays where it is', async () => {
    await openAt('/w/alpha', 'alpha')
    await openMenu()
    await fillIn('/tmp/demo', 'Demo')

    await userEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(fetches).toContain('POST /api/workspaces')
    expect(location.pathname).toBe('/w/alpha')
    await openMenu()
    expect(screen.getByRole('menuitemradio', { name: /Demo/ })).toBeTruthy()
  })
})

describe('the page when the URL names no workspace to open', () => {
  // spec-00011-AC-9.2
  it('says an unregistered workspace is not registered, with the switcher in the bar', async () => {
    history.replaceState(null, '', '/w/ghost')
    render(<Board />)

    await waitFor(() => expect(screen.getByText('No workspace ghost is registered.')).toBeTruthy())
    expect(trigger()).toBeTruthy()
    expect(fetches.filter((call) => call.includes('/w/'))).toEqual([])
  })

  // spec-00011-AC-9.3
  it('says why an unavailable workspace cannot be opened, and reads nothing from it', async () => {
    registry = [summary({ id: 'broken', name: 'Broken', path: '/tmp/broken', availability: 'missing', error: 'no directory at /tmp/broken' })]
    history.replaceState(null, '', '/w/broken')
    render(<Board />)

    await waitFor(() => expect(screen.getByText('no directory at /tmp/broken')).toBeTruthy())
    expect(trigger()).toBeTruthy()
    expect(fetches.filter((call) => call.includes('/w/'))).toEqual([])
  })

  // spec-00011-AC-13.7, the page half: the address `persimmon` printed for a
  // project whose flow config is invalid opens on that config's own error, with
  // the switcher in the bar and nothing addressed to the workspace.
  it('says which config error keeps a registered workspace from opening', async () => {
    const error = 'flow: idea -> memo names a type no `types` entry declares'
    registry = [summary({ id: 'broken', name: 'Broken', path: '/tmp/broken', availability: 'invalidConfig', error })]
    history.replaceState(null, '', '/w/broken')
    render(<Board />)

    await waitFor(() => expect(screen.getByText(error)).toBeTruthy())
    expect(trigger()).toBeTruthy()
    expect(fetches.filter((call) => call.includes('/w/'))).toEqual([])
  })

  // spec-00011-AC-1.1, spec-00011-AC-13.4
  it('invites the first workspace when the registry is empty, switcher and all', async () => {
    registry = []
    render(<Board />)

    await waitFor(() => expect(screen.getByText('No workspace is registered.')).toBeTruthy())
    await userEvent.click(screen.getByRole('button', { name: 'Add your first workspace' }))
    expect(await screen.findByRole('dialog')).toBeTruthy()
    await userEvent.keyboard('{Escape}')

    await openMenu()
    expect(screen.getByText('no workspace is registered yet')).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Add workspace' })).toBeTruthy()
  })
})
