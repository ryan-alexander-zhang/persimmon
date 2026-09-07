import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_FILE, ConfigError, loadFlowConfig } from './config.ts'
import type { WorkspaceEntry } from './workspaceRegistry.ts'

/** Whether a registered workspace can be opened, and if not, why (design-00003 §3). */
export type Availability = 'available' | 'missing' | 'noGit' | 'noConfig' | 'invalidConfig'

/**
 * One entry's verdict, as `GET /api/workspaces` carries it (design-00003 §5).
 * Unavailability is data, not a failure: each of the four reasons carries the one
 * sentence that says what to fix, and nothing here throws for any of them.
 */
export interface AvailabilityJudgement {
  availability: Availability
  error?: string
}

/**
 * The availability judgement of spec-00011-FR-6, in the order design-00003 §3
 * draws it: missing -> noGit -> (live? available) -> noConfig -> invalidConfig.
 *
 * It holds one piece of state, the git top-level cache: `/api/workspaces` is
 * refetched on every session-state change, and a synchronous child process per
 * entry per listing is not a price that judgement is worth (design-00003 §3).
 * The cache is per path and lives with the registry entry — the host drops it
 * through {@link forget} when the entry is removed.
 */
export class AvailabilityJudge {
  /** path -> whether git's top level is that path itself. */
  private readonly repoRoots = new Map<string, boolean>()

  judge(entry: WorkspaceEntry, live: boolean): AvailabilityJudgement {
    const { path } = entry
    if (!isDirectory(path)) return { availability: 'missing', error: `workspace directory does not exist: ${path}` }
    if (!this.isRepoRoot(path)) return { availability: 'noGit', error: `directory is not a git repository: ${path}` }
    // A live instance reads the config once, when it is built; an edit after that
    // takes a restart, which is the standing reading of `exclude` widened to the
    // whole config (spec-00011-FR-6). The carve-out covers the two config checks
    // and no more: a deleted directory or a deleted `.git` invalidates the
    // instance itself, so both are judged every time (spec-00011-AC-6.8).
    if (live) return { availability: 'available' }
    const config = join(path, CONFIG_FILE)
    // Before `loadFlowConfig`, whose own "no flow config at ..." would otherwise
    // fold an absent file into `invalidConfig` (design-00003 §3).
    if (!existsSync(config)) return { availability: 'noConfig', error: `directory has no ${CONFIG_FILE}: ${path}` }
    try {
      loadFlowConfig(config)
    } catch (cause) {
      if (!(cause instanceof ConfigError)) throw cause
      // Verbatim: the same sentence a single-workspace start printed for this
      // config (spec-00011-FR-6, spec-00011-AC-6.4).
      return { availability: 'invalidConfig', error: cause.message }
    }
    return { availability: 'available' }
  }

  /** Drop a path's cached top level; the host calls it when the entry is removed (design-00003 §3). */
  forget(path: string): void {
    this.repoRoots.delete(path)
  }

  private isRepoRoot(path: string): boolean {
    // `.git` is a directory normally and a file in a worktree or a submodule, so
    // existence is all this tests. Its absence is a certain no and costs no child
    // process, which is what catches a deleted `.git` between two listings.
    if (!existsSync(join(path, '.git'))) return false
    const cached = this.repoRoots.get(path)
    if (cached !== undefined) return cached
    const root = isTopLevel(path)
    this.repoRoots.set(path, root)
    return root
  }
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}

/**
 * Git's top level for the directory, compared against the directory itself: a
 * subdirectory of another repository is not a workspace (design-00003 §3).
 * `execFileSync` as `gitLayer.ts` runs its own reads — the judgement is
 * synchronous, and simple-git is async throughout.
 */
function isTopLevel(path: string): boolean {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: path,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    // Both realpath'd: git answers with the path it was reached by, which need
    // not be spelled as the registry spells it.
    return realpathSync(top) === realpathSync(path)
  } catch {
    return false
  }
}
