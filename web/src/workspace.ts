import { useCallback, useEffect, useRef, useState } from 'react'
import { type WorkspaceSummary, hostApi } from './api.ts'

/**
 * Which workspace this browser was last in (design-00003 §6). A browser-level
 * preference, global like the theme: it is written every time the current
 * workspace settles — a switch, a direct open of `/w/<wid>`, the entry page's
 * redirect — so the address the CLI prints becomes the one a later `/` opens,
 * and, with several tabs open, the last one to settle wins (spec-00011-FR-11).
 */
export const LAST_WORKSPACE_KEY = 'whiteboard-last-workspace'

/** `/w/<wid>` is the current workspace; anything else is the entry page (design-00003 §6). */
export function widInPath(pathname: string): string | undefined {
  const match = /^\/w\/([^/]+)/.exec(pathname)
  return match === null ? undefined : decodeURIComponent(match[1]!)
}

/**
 * What the page is showing. Only `ready` addresses a workspace's API at all: an
 * unregistered or unavailable one is a page state and nothing is read from it
 * (spec-00011-FR-9, AC-9.3).
 */
export type WorkspaceState =
  | { status: 'loading' }
  | { status: 'ready'; wid: string }
  /** The registry is empty, or holds nothing available (design-00003 §6). */
  | { status: 'empty' }
  | { status: 'unregistered'; wid: string }
  | { status: 'unavailable'; wid: string; reason: string }

function remember(wid: string): void {
  localStorage.setItem(LAST_WORKSPACE_KEY, wid)
}

/**
 * The workspace the URL names, resolved against the registry. The entry page
 * `/` resolves to the last workspace this browser was in, else to the first
 * available entry, else to the empty state, and `replaceState`s to whichever it
 * picked — the URL is what carries the current workspace, so a reload comes back
 * to the same one (spec-00011-FR-10, design-00003 §6).
 */
function resolve(pathname: string, workspaces: WorkspaceSummary[]): WorkspaceState {
  const named = widInPath(pathname)
  if (named !== undefined) return settle(named, workspaces)
  const last = localStorage.getItem(LAST_WORKSPACE_KEY)
  const pick =
    workspaces.find((one) => one.id === last) ?? workspaces.find((one) => one.availability === 'available')
  // A remembered workspace that is no longer registered counts as none, and the
  // key goes with it (design-00003 §6).
  if (last !== null && !workspaces.some((one) => one.id === last)) localStorage.removeItem(LAST_WORKSPACE_KEY)
  if (pick === undefined) return { status: 'empty' }
  history.replaceState(null, '', `/w/${encodeURIComponent(pick.id)}`)
  return settle(pick.id, workspaces)
}

function settle(wid: string, workspaces: WorkspaceSummary[]): WorkspaceState {
  const entry = workspaces.find((one) => one.id === wid)
  if (entry === undefined) return { status: 'unregistered', wid }
  if (entry.availability !== 'available') {
    return { status: 'unavailable', wid, reason: entry.error ?? entry.availability }
  }
  // The current workspace has settled, which is one of the three points the
  // preference is written at (design-00003 §6).
  remember(wid)
  return { status: 'ready', wid }
}

export interface WorkspaceHandle {
  state: WorkspaceState
  /** The registry as it was last read, for the switcher to list (spec-00011-FR-7). */
  workspaces: WorkspaceSummary[]
  /**
   * Make `wid` the current workspace. An unavailable or unregistered target is
   * refused and the current workspace stays as it is — the reason is returned
   * for the caller to show (spec-00011-FR-9); `undefined` means it happened.
   */
  switchWorkspace: (wid: string) => string | undefined
  /** Re-read the registry, after an add, a remove, or a host signal (design-00003 §5). */
  reload: () => Promise<void>
}

export function useWorkspace(): WorkspaceHandle {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [state, setState] = useState<WorkspaceState>({ status: 'loading' })
  // Readable from the callbacks below without rebuilding them on every read.
  const held = useRef<WorkspaceSummary[]>([])

  const reload = useCallback(async () => {
    let read: WorkspaceSummary[] = []
    try {
      read = await hostApi.workspaces()
    } catch {
      // The registry could not be read, so no workspace can be shown to be
      // registered — the empty state, which carries the way to add one
      // (design-00003 §6). Nothing is addressed under a workspace prefix here.
    }
    held.current = read
    setWorkspaces(read)
    setState(resolve(location.pathname, read))
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Forward and back between two workspace addresses is a switch like any other
  // (spec-00011-FR-8, design-00003 §6).
  useEffect(() => {
    const onPop = () => setState(resolve(location.pathname, held.current))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const switchWorkspace = useCallback((wid: string): string | undefined => {
    const next = settle(wid, held.current)
    if (next.status === 'unregistered') return `no workspace ${wid} is registered`
    if (next.status === 'unavailable') return next.reason
    history.pushState(null, '', `/w/${encodeURIComponent(wid)}`)
    setState(next)
    return undefined
  }, [])

  return { state, workspaces, switchWorkspace, reload }
}

/**
 * Presentation state, one set per workspace (design-00003 §6, design-00002 §10).
 * A switch saves what is on show and puts back what the workspace being entered
 * was left on; putting it back is the same «hold it by id and let the payload
 * decide» the refresh path already does, so what a saved id pointed at having
 * gone closes only that and leaves the rest standing — there is no second
 * implementation of close-nearest here (spec-00011-AC-8.4, AC-8.5).
 *
 * The swap happens in the render that first sees the new `wid` — React's own way
 * of adjusting state to a changed input — so nothing of the workspace being left
 * is ever painted under the new one.
 */
export function useWorkspaceMemory<T>(wid: string, snapshot: T, restore: (saved: T | undefined) => void): void {
  const saved = useRef(new Map<string, T>())
  // The workspace the state on hand belongs to, as state and not as a ref: a
  // render React throws away must not leave the swap half made.
  const [held, setHeld] = useState(wid)
  const latest = useRef(snapshot)
  latest.current = snapshot
  if (held !== wid) {
    saved.current.set(held, latest.current)
    setHeld(wid)
    restore(saved.current.get(wid))
  }
}
