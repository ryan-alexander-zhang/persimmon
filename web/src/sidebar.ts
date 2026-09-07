/**
 * The navigation sidebar's two preferences, in the same local layer the theme
 * and the notification switch live in (design-00002 §17.1). They are view state,
 * but they survive a reload: they are the user's preference about the interface,
 * not their place in a document. Nothing here reaches `docs/`.
 */

const OPEN_KEY = 'whiteboard-sidebar'
const EXPANDED_KEY = 'whiteboard-sidebar-expanded'

/**
 * The expanded state is one workspace's — its keys are that workspace's type
 * groups — so it is stored under the workspace, while the sidebar's own open
 * state is a browser-level preference and stays global (design-00003 §6). Values
 * written before there were workspaces are not migrated: an expanded state is a
 * convenience, and losing it once is the cheaper of the two (design-00003 §6).
 */
function scoped(wid: string): string {
  return `w:${wid}:${EXPANDED_KEY}`
}

/** No key means open: the sidebar is there until the user puts it away (spec-00008-AC-5.1). */
export function readSidebarOpen(): boolean {
  return localStorage.getItem(OPEN_KEY) !== 'closed'
}

export function writeSidebarOpen(open: boolean): void {
  localStorage.setItem(OPEN_KEY, open ? 'open' : 'closed')
}

/** The keys of the expanded groups; no key means every group is collapsed (spec-00008-AC-4.3). */
export function readExpanded(wid: string): string[] {
  const stored = localStorage.getItem(scoped(wid))
  return stored === null ? [] : (JSON.parse(stored) as string[])
}

export function writeExpanded(wid: string, keys: string[]): void {
  localStorage.setItem(scoped(wid), JSON.stringify(keys))
}
