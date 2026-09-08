import {
  CircleAlert,
  FolderOpen,
  FolderPlus,
  Keyboard,
  LayoutGrid,
  type LucideIcon,
  TerminalIcon,
  Trash2,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Toaster, toast } from 'sonner'
import { type WorkspaceSummary, hostApi } from './api.ts'
import { connectWorkspaceEvents } from './eventSocket.ts'
import { useTheme } from './theme.ts'
import type { WorkspaceHandle, WorkspaceState } from './workspace.ts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'

/**
 * The switcher of spec-00011-FR-7: the leftmost thing in the top bar, the way
 * into every registered workspace and the place they are added and removed from
 * (design-00002 §3, design-00003 §6).
 *
 * An unavailable row is **not** disabled — it is reached and activated like any
 * other and answers with its reason, which is the only way a user can find out
 * what to fix (spec-00011-FR-9, AC-7.3, AC-9.1).
 */
export function WorkspaceSwitcher({ workspace }: { workspace: WorkspaceHandle }) {
  const { state, workspaces, switchWorkspace, reload } = workspace
  const [adding, setAdding] = useState(false)
  const [open, setOpen] = useState(false)
  // Only a settled workspace is the current one: an unregistered or unavailable
  // address is a page state and nothing on the list is checked (spec-00011-FR-9).
  const current = state.status === 'ready' ? state.wid : undefined

  // The counts and the entries move with the host while the menu is open, and
  // only while it is: that is what spec-00011-FR-7 asks for, and a channel held
  // open behind a closed menu would have every session state change anywhere
  // re-read the registry (spec-00011-AC-7.2, AC-14.2, design-00003 §5). Dialling
  // it re-reads at once, which is the «every opening re-reads» of design-00003
  // §5; a channel that is not there is silent and the last read stays on show.
  useEffect(() => {
    if (!open) return
    const link = connectWorkspaceEvents(() => void reload())
    return () => link.close()
  }, [open, reload])

  async function remove(entry: WorkspaceSummary) {
    try {
      await hostApi.removeWorkspace(entry.id)
    } catch (error) {
      // A running session (409) and an entry that is no longer registered (404)
      // both come back as the host's own sentence (spec-00011-FR-5, AC-5.1).
      toast.error((error as Error).message)
      return
    }
    // Removing the workspace on show hands the page back to the entry rule: the
    // first available entry, else the empty state (spec-00011-AC-4.3…AC-4.5).
    if (entry.id === current) history.replaceState(null, '', '/')
    await reload()
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-2" aria-label="Switch workspace">
            <LayoutGrid className="size-4" aria-hidden />
            {workspaces.find((entry) => entry.id === current)?.name ?? 'Workspaces'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-96">
          {workspaces.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">no workspace is registered yet</p>
          ) : (
            <DropdownMenuRadioGroup
              value={current ?? ''}
              onValueChange={(wid) => {
                const refused = switchWorkspace(wid)
                if (refused !== undefined) toast.error(refused)
              }}
            >
              {workspaces.map((entry) => (
                // The remove control is a menu item of its own, laid out in the
                // row: Radix moves the arrow keys over items wherever they sit,
                // which is what makes it keyboard-reachable — a plain button
                // nested in a row is not (design-00002 §6, spec-00011-AC-7.3).
                <div key={entry.id} className="flex items-start">
                  <DropdownMenuRadioItem value={entry.id} className="min-w-0 flex-1 items-start">
                    <span className="flex min-w-0 flex-col">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate">{entry.name}</span>
                        <Count icon={TerminalIcon} of="running" entry={entry} />
                        <Count icon={Keyboard} of="awaiting" entry={entry} />
                      </span>
                      <span className="text-muted-foreground truncate font-mono text-xs">{entry.path}</span>
                      {entry.availability === 'available' ? null : (
                        <span className="text-muted-foreground flex items-start gap-1 text-xs">
                          <CircleAlert className="mt-0.5 size-3" aria-hidden />
                          {entry.error ?? entry.availability}
                        </span>
                      )}
                    </span>
                  </DropdownMenuRadioItem>
                  <DropdownMenuItem
                    aria-label={`Remove ${entry.name}`}
                    onSelect={(event) => {
                      // The menu stays open: a refusal is read where the entry
                      // it is about still is (spec-00011-AC-5.1).
                      event.preventDefault()
                      void remove(entry)
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </DropdownMenuItem>
                </div>
              ))}
            </DropdownMenuRadioGroup>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setAdding(true)}>
            <FolderPlus className="size-4" aria-hidden />
            Add workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddWorkspaceDialog open={adding} onOpenChange={setAdding} onAdded={reload} />
    </>
  )
}

/**
 * One of the two counts a row carries (spec-00011-FR-7): how many of the
 * workspace's sessions run and how many wait for input, with §12's two icons and
 * a number rather than colour alone. A count of zero is not rendered at all —
 * every registered workspace would otherwise carry two zeroes.
 */
function Count({ icon: Icon, of, entry }: { icon: LucideIcon; of: 'running' | 'awaiting'; entry: WorkspaceSummary }) {
  const count = entry.sessions.filter((one) =>
    of === 'running' ? one.status === 'running' : one.awaiting === true,
  ).length
  if (count === 0) return null
  return (
    <Badge variant="outline" className="gap-1 px-1.5 py-0" aria-label={`${count} ${of} in ${entry.name}`}>
      <Icon className="size-3" aria-hidden />
      {count}
    </Badge>
  )
}

/**
 * The add dialog of spec-00011-FR-2: the path, and a display name if the derived
 * one will not do. A refusal — 422 for a path that is no project, 500 for a
 * write that failed — is said in a toast and leaves the dialog open with what
 * was typed still in it (spec-00011-AC-3.1, design-00002 §3).
 */
function AddWorkspaceDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => Promise<void>
}) {
  const [path, setPath] = useState('')
  const [name, setName] = useState('')
  const [sending, setSending] = useState(false)
  const [browsing, setBrowsing] = useState(false)

  /**
   * spec-00011-FR-22: the server opens the native dialog and hands back an
   * absolute path, which lands in the field without submitting anything. A
   * cancel is `path: null` and says nothing; a refusal — one already open, or no
   * picker on this machine — is a toast, and typing a path stays available
   * either way (spec-00011-FR-23, spec-00011-FR-24).
   */
  async function browse() {
    setBrowsing(true)
    try {
      const { path: picked } = await hostApi.pickDirectory()
      if (picked !== null) setPath(picked)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setBrowsing(false)
    }
  }

  async function confirm() {
    setSending(true)
    try {
      await hostApi.addWorkspace(path, name === '' ? undefined : name)
    } catch (error) {
      toast.error((error as Error).message)
      return
    } finally {
      setSending(false)
    }
    setPath('')
    setName('')
    onOpenChange(false)
    // Registered, not entered: nothing in spec-00011 makes an add a switch, so
    // the current workspace stays where it was (design-00003 §6).
    await onAdded()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add workspace</DialogTitle>
          <DialogDescription>
            A project directory with a `whiteboard.config.yaml` in it. The id comes from the directory name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void confirm()
          }}
        >
          <label className="flex flex-col gap-1 text-xs" htmlFor="add-workspace-path">
            Project directory
            <div className="flex gap-2">
              <Input id="add-workspace-path" value={path} onChange={(event) => setPath(event.target.value)} />
              {/* Disabled only while this page's own call is out; at most one
                  dialog is the server's to hold (spec-00011-AC-22.4). */}
              <Button type="button" variant="outline" onClick={() => void browse()} disabled={browsing}>
                <FolderOpen className="size-4" aria-hidden />
                Browse…
              </Button>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-xs" htmlFor="add-workspace-name">
            Display name (optional)
            <Input id="add-workspace-name" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <DialogFooter>
            <Button type="submit" disabled={path === '' || sending}>
              <FolderPlus className="size-4" aria-hidden />
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function said(state: WorkspaceState): string {
  if (state.status === 'empty') return 'No workspace is registered.'
  if (state.status === 'unregistered') return `No workspace ${state.wid} is registered.`
  if (state.status === 'unavailable') return state.reason
  return 'Opening…'
}

/**
 * The page when the address names no workspace this browser can open
 * (spec-00011-FR-9): what happened, and the switcher in the bar above it — every
 * state has a way out of itself, which is why the bar is here and not only on a
 * board (design-00003 §6). Nothing is read from the workspace the URL names
 * (spec-00011-AC-9.3); the empty state is instead an invitation to register the
 * first one (spec-00011-AC-1.1, AC-13.4).
 */
export function WorkspacePage({ workspace }: { workspace: WorkspaceHandle }) {
  const theme = useTheme()
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <WorkspaceSwitcher workspace={workspace} />
      </header>
      <div
        role="status"
        className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-3 p-8 text-sm"
      >
        {said(workspace.state)}
        {workspace.state.status === 'empty' ? (
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setAdding(true)}>
            <FolderPlus className="size-4" aria-hidden />
            Add your first workspace
          </Button>
        ) : null}
      </div>
      <AddWorkspaceDialog open={adding} onOpenChange={setAdding} onAdded={workspace.reload} />
      {/* A refusal from the switcher or the dialog is read here too, so this
          page needs its own (the board's is Canvas's). */}
      <Toaster position="bottom-right" theme={theme.isDark ? 'dark' : 'light'} richColors closeButton />
    </div>
  )
}
