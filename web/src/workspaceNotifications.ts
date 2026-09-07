import { useCallback, useEffect, useRef, useState } from 'react'
import { type WorkspaceSummary, hostApi } from './api.ts'
import { connectWorkspaceEvents } from './eventSocket.ts'
import { type NoticeSubject, useDesktopNotifications } from './notify.ts'
import { ended } from './useBoard.ts'

/** How each session of each workspace was last read (design-00003 §9). */
type State = { status: string; awaiting: boolean }

/**
 * The desktop notifications of every open workspace, not just the one on show
 * (spec-00011-FR-17). One source and one reader: `GET /api/workspaces` carries
 * every live instance's sessions, and this layer is the only thing that diffs
 * them — the current workspace's own `/api/sessions` stays with the session
 * panel, the terminal and the end toast, whose scope is this board
 * (spec-00003-FR-7, design-00003 §9).
 *
 * `open` is what a click does: the `wid` it names may not be the one on show,
 * so the caller switches workspace before it resolves the session
 * (spec-00011-AC-17.2).
 */
export function useWorkspaceNotifications(open: (wid: string, sessionId: string) => void) {
  const [subjects, setSubjects] = useState<NoticeSubject[]>([])
  const notifications = useDesktopNotifications(subjects, open)
  /**
   * How each workspace was last read, by `wid` and then by session id. A `wid`
   * that is not in here at all is «nothing read yet», and its sessions are a
   * baseline rather than news — which is the same reading `useBoard` takes of
   * `before === undefined`, held per workspace: a reload, a workspace becoming
   * live for the first time, one coming back from unavailable or from having
   * been removed (spec-00011-AC-17.8, design-00003 §9).
   */
  const seen = useRef(new Map<string, Map<string, State>>())
  /**
   * The read in flight, so the next one queues behind it. Two reads at once fold
   * their summaries into `seen` in whatever order the responses land, and
   * waiting is not a state a session climbs to and stays in: an older reading
   * applied after the newer one it came before loses that turn and nobody is
   * ever told (issue-00018). One ordered queue is the whole of the fix, and it
   * is the reason this layer reads for itself rather than sharing the
   * switcher's reads (design-00003 §9).
   */
  const reading = useRef<Promise<unknown>>(Promise.resolve())

  /**
   * One reading of the union, folded in. Every difference is per key
   * `wid:sessionId`: an end that has just appeared and a session that has just
   * turned to waiting are the same two events `useBoard` announces the toast
   * from, counted over every open workspace instead of one
   * (spec-00011-FR-17, design-00002 §13).
   *
   * Only available workspaces are in the union at all: an unavailable one has
   * no instance and so no sessions, and dropping it from `seen` is what makes
   * its return a baseline again (design-00003 §3, §9).
   */
  const fold = useCallback(
    (read: WorkspaceSummary[]) => {
      const before = seen.current
      const now = new Map<string, Map<string, State>>()
      const next: NoticeSubject[] = []
      for (const workspace of read) {
        if (workspace.availability !== 'available') continue
        const was = before.get(workspace.id)
        const mine = new Map<string, State>()
        now.set(workspace.id, mine)
        for (const session of workspace.sessions) {
          const awaiting = session.awaiting === true
          mine.set(session.id, { status: session.status, awaiting })
          const subject: NoticeSubject = {
            key: `${workspace.id}:${session.id}`,
            wid: workspace.id,
            sessionId: session.id,
            // The display name, not the path: the notification lands in the
            // system's notification centre (spec-00011-AC-17.7).
            title: `${workspace.name} · ${session.kind} · ${session.sourceId}`,
            status: session.status,
            awaiting,
            ended: ended(session),
          }
          next.push(subject)
          if (was === undefined) continue
          const state = was.get(session.id)
          if (subject.ended && state?.status !== session.status) notifications.ended(subject)
          if (!subject.ended && awaiting && state?.awaiting !== true) notifications.waiting(subject)
        }
      }
      seen.current = now
      setSubjects(next)
    },
    [notifications.ended, notifications.waiting],
  )

  /**
   * The one way in, one read at a time. A read that failed changes nothing and
   * says nothing — the same silence the registry read on the page itself keeps:
   * there is no user act behind this one to report to (design-00003 §6).
   */
  const refresh = useCallback(() => {
    reading.current = reading.current
      .then(async () => fold(await hostApi.workspaces()))
      .catch(() => undefined)
  }, [fold])

  // Two triggers, one queue: the first read, and the host's own channel — which
  // fires on a registry write and on any live workspace's session state moving
  // (design-00003 §5). This subscription is the notifications' own and is held
  // for as long as the page is: the switcher's is dialled only while its menu is
  // open, and a menu nobody opened is exactly when a notification is owed.
  useEffect(() => {
    refresh()
    const link = connectWorkspaceEvents(refresh)
    return () => link.close()
  }, [refresh])

  // The switch itself is unchanged: one boolean, one permission, three readings
  // of them (spec-00004-FR-1, design-00002 §13).
  return { state: notifications.state, toggle: notifications.toggle }
}
