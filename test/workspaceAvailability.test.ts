import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG_FILE, loadFlowConfig } from '../src/config.ts'
import { AvailabilityJudge } from '../src/workspaceAvailability.ts'
import type { WorkspaceEntry } from '../src/workspaceRegistry.ts'
import { git } from './helpers.ts'

const VALID = `types:
  idea: { kind: living }
relations: [parent]
flow: {}
focus:
  idea: is it worth doing
agents:
  claude:
    command: node
    args: []
`

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * An available workspace: a git repository with a valid flow config in it. Every
 * case below starts from one and breaks the one thing it is about, which is how
 * the acceptance reads it — a registered workspace that stopped being usable.
 */
function workspace(): WorkspaceEntry {
  // `realpath` because macOS puts `/tmp` behind a symlink and the registry stores the resolved path.
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'wb-availability-')))
  made.push(path)
  git(path, 'init', '-q', '-b', 'main')
  writeFileSync(join(path, CONFIG_FILE), VALID)
  return { id: 'demo', name: 'demo', path }
}

describe('a workspace the host has never opened', () => {
  it('is available when the directory is a repository root holding a valid config', () => {
    expect(new AvailabilityJudge().judge(workspace(), false)).toEqual({ availability: 'available' })
  })

  // spec-00011-AC-6.1
  it('is missing once its directory is gone', () => {
    const entry = workspace()
    rmSync(entry.path, { recursive: true })

    expect(new AvailabilityJudge().judge(entry, false)).toEqual({
      availability: 'missing',
      error: `workspace directory does not exist: ${entry.path}`,
    })
  })

  // spec-00011-AC-6.1, for the reading design-00003 §3 leaves open: the check is
  // "exists and is a directory", so a path that is a file is missing too
  it('is missing when the path leads to a file rather than a directory', () => {
    const entry = workspace()
    const file = join(entry.path, 'not-a-directory')
    writeFileSync(file, '')

    expect(new AvailabilityJudge().judge({ ...entry, path: file }, false).availability).toBe('missing')
  })

  // spec-00011-AC-6.3
  it('is noGit when the directory holds a config but is not a repository', () => {
    const entry = workspace()
    rmSync(join(entry.path, '.git'), { recursive: true })

    expect(new AvailabilityJudge().judge(entry, false)).toEqual({
      availability: 'noGit',
      error: `directory is not a git repository: ${entry.path}`,
    })
  })

  // spec-00011-AC-6.3 at the boundary design-00003 §3 draws it: a subdirectory of
  // another repository is noGit too — gitLayer filters top-level-relative paths by
  // a repoRoot-relative `docs/` prefix, so a repoRoot below the top level would
  // commit nothing and never say so
  it('is noGit when the directory is a subdirectory of a repository', () => {
    const entry = workspace()
    const inner = join(entry.path, 'inner')
    mkdirSync(inner)
    writeFileSync(join(inner, CONFIG_FILE), VALID)

    expect(new AvailabilityJudge().judge({ ...entry, path: inner }, false).availability).toBe('noGit')
  })

  // spec-00011-AC-6.2
  it('is noConfig when the flow config is gone', () => {
    const entry = workspace()
    rmSync(join(entry.path, CONFIG_FILE))

    expect(new AvailabilityJudge().judge(entry, false)).toEqual({
      availability: 'noConfig',
      error: `directory has no ${CONFIG_FILE}: ${entry.path}`,
    })
  })

  // spec-00011-AC-6.4: the same sentence a single-workspace start printed for this
  // config, which is why it is asserted against `loadFlowConfig` itself
  it('is invalidConfig carrying the very message loadFlowConfig throws', () => {
    const entry = workspace()
    const config = join(entry.path, CONFIG_FILE)
    writeFileSync(config, `${VALID}max_sessions: 0\n`)
    const thrown = (() => {
      try {
        loadFlowConfig(config)
        return null
      } catch (cause) {
        return (cause as Error).message
      }
    })()

    expect(new AvailabilityJudge().judge(entry, false)).toEqual({
      availability: 'invalidConfig',
      error: thrown,
    })
    expect(thrown).toContain('max_sessions')
  })

  // spec-00011-AC-6.5: the same judge instance, so nothing was restarted
  it('is available again on the next judgement once the config is fixed', () => {
    const entry = workspace()
    const config = join(entry.path, CONFIG_FILE)
    const judge = new AvailabilityJudge()
    writeFileSync(config, `${VALID}max_sessions: 0\n`)
    expect(judge.judge(entry, false).availability).toBe('invalidConfig')

    writeFileSync(config, VALID)

    expect(judge.judge(entry, false)).toEqual({ availability: 'available' })
  })
})

describe('a workspace the host already holds an instance for', () => {
  // spec-00011-AC-6.6, spec-00011-AC-6.7: it runs on the config it was opened with
  it('stays available when its config is made invalid after it was opened', () => {
    const entry = workspace()
    writeFileSync(join(entry.path, CONFIG_FILE), `${VALID}max_sessions: 0\n`)

    expect(new AvailabilityJudge().judge(entry, true)).toEqual({ availability: 'available' })
  })

  // spec-00011-AC-6.6: the carve-out covers both config checks, not just the parse
  it('stays available when its config is deleted after it was opened', () => {
    const entry = workspace()
    rmSync(join(entry.path, CONFIG_FILE))

    expect(new AvailabilityJudge().judge(entry, true)).toEqual({ availability: 'available' })
  })

  // spec-00011-AC-6.8
  it('is missing when its directory is deleted', () => {
    const entry = workspace()
    rmSync(entry.path, { recursive: true })

    expect(new AvailabilityJudge().judge(entry, true)).toEqual({
      availability: 'missing',
      error: `workspace directory does not exist: ${entry.path}`,
    })
  })

  // design-00003 §3: missing and noGit are judged every time, live or not — both
  // are things that invalidate the instance itself
  it('is noGit when its .git is deleted', () => {
    const entry = workspace()
    rmSync(join(entry.path, '.git'), { recursive: true })

    expect(new AvailabilityJudge().judge(entry, true).availability).toBe('noGit')
  })
})

/**
 * `/api/workspaces` is refetched on every session-state change (design-00003 §5),
 * so the top-level lookup may not be a child process per entry per listing.
 */
describe('the git top-level cache', () => {
  // Breaking the repository without removing `.git`: a second `git rev-parse`
  // would answer noGit, so an unchanged verdict is the spawn that did not happen
  it('asks git once per path', () => {
    const judge = new AvailabilityJudge()
    const entry = workspace()
    expect(judge.judge(entry, false).availability).toBe('available')

    rmSync(join(entry.path, '.git', 'HEAD'))

    expect(judge.judge(entry, false).availability).toBe('available')
  })

  it('answers noGit from the .git check alone, without asking git again', () => {
    const judge = new AvailabilityJudge()
    const entry = workspace()
    expect(judge.judge(entry, false).availability).toBe('available')

    rmSync(join(entry.path, '.git'), { recursive: true })

    expect(judge.judge(entry, false).availability).toBe('noGit')
  })

  // design-00003 §3: the cache lives with the entry, so the host drops it when the entry goes
  it('asks git again after the path is forgotten', () => {
    const judge = new AvailabilityJudge()
    const entry = workspace()
    expect(judge.judge(entry, false).availability).toBe('available')
    rmSync(join(entry.path, '.git', 'HEAD'))

    judge.forget(entry.path)

    expect(judge.judge(entry, false).availability).toBe('noGit')
  })
})
