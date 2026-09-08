import { type SpawnOptions, spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'

/**
 * The native directory picker of spec-00011-FR-22 … FR-24, run by the server
 * because the browser will not give up an absolute path: `webkitdirectory`
 * yields only `webkitRelativePath`, and `showDirectoryPicker()` only a handle.
 * The board binds loopback, so the machine that pops the dialog is the one
 * sitting in front of it (design-00003 §5, §11).
 */
export type Picked = { kind: 'picked'; path: string } | { kind: 'cancelled' } | { kind: 'unavailable'; error: string }

/** The spawn seam, so the three outcomes are testable without a dialog on somebody's screen. */
export type SpawnPicker = (command: string, args: string[], options: SpawnOptions) => ChildProcess

/**
 * `activate` first, or the dialog routinely opens behind the frontmost window —
 * and with the Browse button disabled while the call is in flight, an unseen
 * dialog reads as a hang (design-00003 §5).
 */
const SCRIPT = 'tell application "System Events" to activate\nreturn POSIX path of (choose folder)'

/** AppleScript's own code for «the user cancelled», matched as the number rather than the English sentence it sits in — the wording is localised, the code is not. */
const CANCELLED = '-128'

export class DirectoryPicker {
  /**
   * The one child there may be (spec-00011-FR-22). Held here rather than per
   * page because a second tab's button knows nothing of the first one's.
   */
  private child?: ChildProcess

  constructor(private readonly spawnPicker: SpawnPicker = spawn) {}

  get busy(): boolean {
    return this.child !== undefined
  }

  /** Kill whatever dialog is open — the shutdown's first act, and an abandoned request's last (design-00003 §7). */
  dismiss(): void {
    this.child?.kill()
    this.child = undefined
  }

  async pick(): Promise<Picked> {
    if (process.platform !== 'darwin') {
      return { kind: 'unavailable', error: 'a native directory picker is only wired up for macOS' }
    }
    // No shell: the script is a fixed literal and the path only ever travels
    // back on stdout, so nothing the user picks is ever parsed as a command.
    const child = this.spawnPicker('osascript', ['-e', SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    try {
      return read(await settle(child))
    } finally {
      this.child = undefined
    }
  }
}

/** What the run said, gathered whether it ended by exiting or by never starting at all. */
function settle(child: ChildProcess): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    child.stdout?.on('data', (chunk) => {
      out += chunk
    })
    child.stderr?.on('data', (chunk) => {
      err += chunk
    })
    child.on('error', (error) => resolve({ code: null, out, err: error.message }))
    child.on('close', (code) => resolve({ code, out, err }))
  })
}

function read({ code, out, err }: { code: number | null; out: string; err: string }): Picked {
  if (code === 0) return { kind: 'picked', path: trimSeparator(out.trim()) }
  // Cancel is the one non-zero exit that is not a failure; everything else —
  // no window server, osascript missing, a killed dialog — is «cannot open
  // here», because no other exit was measured and none is worth guessing at.
  if (err.includes(CANCELLED)) return { kind: 'cancelled' }
  return { kind: 'unavailable', error: `the directory picker could not be opened: ${err.trim() || `exit ${code}`}` }
}

/**
 * `POSIX path of` hands back a trailing slash. Stripping it is presentation
 * only — the registry realpaths what it stores, so the two forms were never
 * going to become two entries — and the root is the exception, since stripping
 * that leaves no path at all (spec-00011-FR-22, spec-00011-AC-22.2).
 */
function trimSeparator(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}
