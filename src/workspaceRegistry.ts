import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { CONFIG_FILE } from './config.ts'

/** One registered project directory (design-00003 §2). */
export interface WorkspaceEntry {
  /** The key in URLs and the API; matches `[a-z0-9-]+` and never changes once assigned (spec-00011-FR-2). */
  id: string
  /** The display name in the switcher and in notification titles; defaults to the id, never to the directory name. */
  name: string
  /** The project root, absolute and with symlinks resolved, so one directory is one entry however it is spelled. */
  path: string
}

/**
 * The registry file as a whole is ill-formed (spec-00011-FR-18): the process
 * refuses to start and every CLI subcommand refuses, both naming the file path
 * and the problem. Never partly applied and never rewritten — the file is the
 * user's, and the board does not decide for him which entry to drop.
 */
export class RegistryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RegistryError'
  }
}

/**
 * One add or remove the registry refuses (spec-00011-FR-3, spec-00011-FR-5 末句);
 * the file is untouched and the rest of the registry holds. Apart from the
 * ill-formed file above, because the API answers the two differently
 * (design-00003 §5: 422 for this one, 500 for a write that failed).
 */
export class WorkspaceRefusedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkspaceRefusedError'
  }
}

const ID = /^[a-z0-9-]+$/

/** The id a directory name derives (design-00003 §2): lowercase, every other run of characters folded to one `-`. */
function deriveId(directory: string): string {
  return (
    basename(directory)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'workspace'
  )
}

/** `demo`, then `demo-2`, `demo-3`… — a readable URL is worth this much de-duplication. */
function freeId(directory: string, taken: Set<string>): string {
  const base = deriveId(directory)
  let id = base
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`
  return id
}

/** One entry as the file spells it; every refusal names the file and the entry's position in it. */
function readEntry(raw: unknown, at: string, file: string): WorkspaceEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new RegistryError(`workspace registry: ${file}: \`${at}\` must be a mapping`)
  }
  const { id, name, path } = raw as Record<string, unknown>
  if (typeof id !== 'string') throw new RegistryError(`workspace registry: ${file}: \`${at}.id\` must be a string`)
  if (typeof name !== 'string') throw new RegistryError(`workspace registry: ${file}: \`${at}.name\` must be a string`)
  if (typeof path !== 'string') throw new RegistryError(`workspace registry: ${file}: \`${at}.path\` must be a string`)
  if (!ID.test(id)) {
    throw new RegistryError(`workspace registry: ${file}: \`${at}.id\` must match [a-z0-9-]+, got ${JSON.stringify(id)}`)
  }
  if (!isAbsolute(path)) {
    throw new RegistryError(
      `workspace registry: ${file}: \`${at}.path\` must be an absolute path, got ${JSON.stringify(path)}`,
    )
  }
  return { id, name, path }
}

/**
 * The workspace registry file (design-00003 §2): the one place `~/.persimmon/workspaces.json`
 * is read and written. The path is a constructor parameter rather than an
 * environment variable — the same test seam `spawn` and `awaitThresholdMs` are
 * (design-00001 §5), so a test points it at a temporary directory.
 */
export class WorkspaceRegistry {
  private readonly path: string

  constructor(registryPath: string) {
    this.path = registryPath
  }

  /**
   * The registry as it stands, in file order. The file is re-read on **every**
   * call — as `EffectiveAgents` re-reads its own (design-00001 §13.2) — so a
   * hand edit is visible on the next listing without a restart
   * (spec-00011-AC-1.2). No file at all is an empty registry, not a problem to
   * report (spec-00011-FR-1); anything else ill-formed is the whole file
   * refused (spec-00011-FR-18).
   */
  read(): WorkspaceEntry[] {
    const text = this.text()
    if (text === null) return []
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (cause) {
      throw new RegistryError(`workspace registry: ${this.path} is not readable JSON — ${(cause as Error).message}`)
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new RegistryError(`workspace registry: ${this.path} must hold a mapping`)
    }
    const { version, workspaces } = raw as Record<string, unknown>
    if (version !== 1) {
      throw new RegistryError(`workspace registry: ${this.path}: \`version\` must be 1, got ${JSON.stringify(version)}`)
    }
    if (!Array.isArray(workspaces)) {
      throw new RegistryError(`workspace registry: ${this.path}: \`workspaces\` must be a list`)
    }
    const entries = workspaces.map((entry, index) => readEntry(entry, `workspaces[${index}]`, this.path))
    const seen = new Set<string>()
    for (const { id } of entries) {
      if (seen.has(id)) {
        throw new RegistryError(`workspace registry: ${this.path}: \`id\` ${JSON.stringify(id)} is registered twice`)
      }
      seen.add(id)
    }
    return entries
  }

  /**
   * Register a directory (spec-00011-FR-2), appended at the end — the file order
   * is the switcher order. Idempotent by resolved path: adding a registered
   * directory returns its entry unchanged, which is what `ainpt new`'s
   * registration step rests on (design-00003 §8). Neither the flow config's
   * content nor git is checked here: an invalid config and a non-git directory
   * register fine and show up as unavailable instead (spec-00011-FR-3).
   */
  add(directory: string, name?: string): WorkspaceEntry {
    const entries = this.read()
    const path = projectRoot(directory)
    const existing = entries.find((entry) => entry.path === path)
    if (existing) return existing
    const id = freeId(path, new Set(entries.map((entry) => entry.id)))
    const entry: WorkspaceEntry = { id, name: name ?? id, path }
    this.write([...entries, entry])
    return entry
  }

  /**
   * Drop one entry (spec-00011-FR-4), by id or by path — the path form is
   * resolved and then looked up as an id, so the rest is one code path
   * (design-00003 §8) — a directory that is gone cannot be `realpath`'d, and a
   * `missing` workspace is removable all the same (spec-00011-FR-4), so the
   * plain resolution stands in. Nothing inside the directory is touched. Whether a
   * running session forbids the removal is the Host's check, not this one
   * (spec-00011-FR-5).
   */
  remove(idOrPath: string): WorkspaceEntry {
    const entries = this.read()
    const path = realpathOrNull(idOrPath) ?? resolve(idOrPath)
    const index = entries.findIndex((entry) => entry.id === idOrPath || entry.path === path)
    if (index === -1) {
      throw new WorkspaceRefusedError(`workspace ${JSON.stringify(idOrPath)} is not registered`)
    }
    const [removed] = entries.splice(index, 1)
    this.write(entries)
    return removed as WorkspaceEntry
  }

  /** The file's text, or null when there is none; anything else unreadable names the path (spec-00011-AC-18.3). */
  private text(): string | null {
    try {
      return readFileSync(this.path, 'utf8')
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new RegistryError(`workspace registry: ${this.path} could not be read — ${(cause as Error).message}`)
    }
  }

  /**
   * Through a temporary name and a rename, as `agentSettings.ts` writes the
   * local layer (design-00001 §13.3): the rename is atomic, so what is on disk
   * at any moment is the old file or the new one and never half of either.
   */
  private write(workspaces: WorkspaceEntry[]): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const staging = `${this.path}.tmp`
    try {
      writeFileSync(staging, `${JSON.stringify({ version: 1, workspaces }, null, 2)}\n`)
      renameSync(staging, this.path)
    } catch (cause) {
      // A write that got as far as the temporary name and no further would leave
      // it behind; clearing it is best-effort, the write's own failure is what
      // the caller is told about (design-00003 §5: 500 {error}).
      try {
        unlinkSync(staging)
      } catch {
        // Nothing to clear, or nothing that can be.
      }
      throw cause
    }
  }
}

/** The path as it goes on disk (design-00003 §2), or the refusal saying which of the three it failed. */
function projectRoot(directory: string): string {
  const path = realpathOrNull(directory)
  if (path === null) {
    throw new WorkspaceRefusedError(`the workspace directory does not exist: ${directory}`)
  }
  if (!statSync(path).isDirectory()) {
    throw new WorkspaceRefusedError(`the workspace path is not a directory: ${directory}`)
  }
  if (!existsSync(join(path, CONFIG_FILE))) {
    throw new WorkspaceRefusedError(`the directory holds no ${CONFIG_FILE}: ${path}`)
  }
  return path
}

/** Symlinks resolved — `/tmp/demo` and `/private/tmp/demo` are one workspace — or null when nothing is there. */
function realpathOrNull(directory: string): string | null {
  try {
    return realpathSync(directory)
  } catch {
    return null
  }
}
