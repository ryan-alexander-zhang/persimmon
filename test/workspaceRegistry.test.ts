import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CONFIG_FILE } from '../src/config.ts'
import { RegistryError, WorkspaceRefusedError, WorkspaceRegistry } from '../src/workspaceRegistry.ts'

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** A temporary stand-in for the user's home; `realpath` because macOS puts `/tmp` behind a symlink. */
function home(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'wb-registry-')))
  made.push(dir)
  return dir
}

/** A project directory: a name and a flow config inside it, which is all `add` looks at. */
function project(parent: string, name: string, config = 'types: {}\n'): string {
  const dir = join(parent, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, CONFIG_FILE), config)
  return dir
}

/** The registry under a temporary home, with the file already written when the test wants one. */
function registry(at: string, body?: unknown): WorkspaceRegistry {
  const path = join(at, '.persimmon', 'workspaces.json')
  if (body !== undefined) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, typeof body === 'string' ? body : JSON.stringify(body))
  }
  return new WorkspaceRegistry(path)
}

const registryPath = (at: string): string => join(at, '.persimmon', 'workspaces.json')

describe('reading the registry', () => {
  // spec-00011-AC-1.1 at the data level: the switcher's empty state rests on this, its rendering is T9's half
  it('reads an absent file as an empty registry', () => {
    expect(registry(home()).read()).toEqual([])
  })

  // spec-00011-AC-21.1 and spec-00011-AC-21.2 at the data level: what `persimmon list` prints, in file order (T7's half)
  it('returns the entries in file order, and an empty list for an empty registry', () => {
    const at = home()
    const entries = [
      { id: 'alpha', name: 'alpha', path: '/work/alpha' },
      { id: 'demo', name: 'demo', path: '/work/demo' },
    ]

    expect(registry(at, { version: 1, workspaces: entries }).read()).toEqual(entries)
    expect(registry(home(), { version: 1, workspaces: [] }).read()).toEqual([])
  })

  // spec-00011-AC-1.2: the file is re-read on every call, so a hand edit needs no restart
  it('sees a hand edit on the next read', () => {
    const at = home()
    const store = registry(at, { version: 1, workspaces: [{ id: 'alpha', name: 'alpha', path: '/work/alpha' }] })

    writeFileSync(
      registryPath(at),
      JSON.stringify({
        version: 1,
        workspaces: [
          { id: 'alpha', name: 'alpha', path: '/work/alpha' },
          { id: 'demo', name: 'Demo', path: '/work/demo' },
        ],
      }),
    )

    expect(store.read().map((entry) => entry.id)).toEqual(['alpha', 'demo'])
  })

  /**
   * spec-00011-AC-18.1 and spec-00011-AC-18.2, and every other reading of «the whole file
   * is ill-formed» (spec-00011-FR-18): the refusal names the file path and the
   * problem, and the caller — process start or CLI subcommand — refuses with it.
   */
  it('refuses an ill-formed file, naming the path and the problem', () => {
    for (const [body, problem] of [
      ['not json at all', /JSON/],
      [[], /mapping/],
      [{ version: 2, workspaces: [] }, /`version`/],
      [{ version: 1, workspaces: {} }, /`workspaces`/],
      [{ version: 1, workspaces: ['demo'] }, /workspaces\[0\]/],
      [{ version: 1, workspaces: [{ name: 'demo', path: '/work/demo' }] }, /\.id`/],
      [{ version: 1, workspaces: [{ id: 'demo', path: '/work/demo' }] }, /\.name`/],
      [{ version: 1, workspaces: [{ id: 'demo', name: 'demo' }] }, /\.path`/],
      [{ version: 1, workspaces: [{ id: 'Demo', name: 'demo', path: '/work/demo' }] }, /\[a-z0-9-\]/],
      [{ version: 1, workspaces: [{ id: 'demo', name: 'demo', path: 'work/demo' }] }, /absolute/],
      [
        {
          version: 1,
          workspaces: [
            { id: 'demo', name: 'demo', path: '/work/demo' },
            { id: 'demo', name: 'other', path: '/work/other' },
          ],
        },
        /twice/,
      ],
    ] as const) {
      const at = home()
      const store = registry(at, body)

      expect(() => store.read()).toThrowError(RegistryError)
      expect(() => store.read()).toThrowError(problem)
      expect(() => store.read()).toThrowError(registryPath(at))
    }
  })

  // spec-00011-AC-18.1 末句: the file is the user's, so a refusal never rewrites it
  it('leaves an ill-formed file as it stands', () => {
    const at = home()
    const store = registry(at, 'not json at all')

    expect(() => store.add(project(at, 'demo'))).toThrowError(RegistryError)
    expect(readFileSync(registryPath(at), 'utf8')).toBe('not json at all')
  })

  // spec-00011-AC-18.3: `~/.persimmon` is a file, so the directory itself cannot be read
  it('refuses when the registry directory is a file, naming the path', () => {
    const at = home()
    writeFileSync(join(at, '.persimmon'), 'not a directory')
    const store = new WorkspaceRegistry(registryPath(at))

    expect(() => store.read()).toThrowError(RegistryError)
    expect(() => store.read()).toThrowError(registryPath(at))
    expect(() => store.add(project(at, 'demo'))).toThrowError(RegistryError)
  })
})

describe('adding a workspace', () => {
  // spec-00011-AC-2.1: the derived id, the name defaulting to it, and the file shape of design-00003 §2
  it('appends one entry with the id derived from the directory name', () => {
    const at = home()
    const store = registry(at)
    const dir = project(at, 'demo')

    expect(store.add(dir)).toEqual({ id: 'demo', name: 'demo', path: dir })
    expect(JSON.parse(readFileSync(registryPath(at), 'utf8'))).toEqual({
      version: 1,
      workspaces: [{ id: 'demo', name: 'demo', path: dir }],
    })
  })

  // spec-00011-AC-2.2: two `demo` directories, and the name follows the id so the two are tellable apart
  it('numbers a colliding id and keeps both entries', () => {
    const at = home()
    const store = registry(at)
    store.add(project(at, 'demo'))
    const second = project(join(at, 'elsewhere'), 'demo')

    expect(store.add(second)).toEqual({ id: 'demo-2', name: 'demo-2', path: second })
    expect(store.read().map((entry) => entry.id)).toEqual(['demo', 'demo-2'])
  })

  // spec-00011-AC-2.3: the idempotence `ainpt new`'s registration step rests on (design-00003 §8)
  it('returns the existing entry for an already registered path', () => {
    const at = home()
    const store = registry(at)
    const dir = project(at, 'demo')
    const first = store.add(dir)

    expect(store.add(dir, 'a different name')).toEqual(first)
    expect(store.read()).toEqual([first])
  })

  // spec-00011-AC-2.5: `/tmp` behind a symlink is the same directory, so it is the same entry
  it('collapses a symlinked spelling of a registered path', () => {
    const at = home()
    const store = registry(at)
    const dir = project(at, 'demo')
    const link = join(at, 'link')
    symlinkSync(at, link)

    const first = store.add(dir)

    expect(store.add(join(link, 'demo'))).toEqual(first)
    expect(store.read()).toEqual([{ id: 'demo', name: 'demo', path: dir }])
  })

  // spec-00011-AC-2.6: a directory name with no ASCII alphanumerics still gets a URL-safe id
  it('falls back to `workspace` when the directory name derives an empty id', () => {
    const at = home()
    const store = registry(at)

    const entry = store.add(project(at, '演示'), '演示')

    expect(entry).toEqual({ id: 'workspace', name: '演示', path: join(at, '演示') })
  })

  // spec-00011-AC-2.7: the id is assigned once; a repointed `path` does not re-derive it
  it('keeps the id when the user repoints an entry at a renamed directory', () => {
    const at = home()
    const renamed = project(at, 'demo-renamed')
    const store = registry(at, { version: 1, workspaces: [{ id: 'demo', name: 'demo', path: renamed }] })

    expect(store.read()[0]?.id).toBe('demo')
    expect(store.add(renamed).id).toBe('demo')
  })

  // spec-00011-AC-3.1: the path does not exist; the CLI and the dialog report the reason (T7/T9)
  it('refuses a path that does not exist, leaving the registry alone', () => {
    const at = home()
    const store = registry(at)
    store.add(project(at, 'demo'))

    expect(() => store.add(join(at, 'nope'))).toThrowError(WorkspaceRefusedError)
    expect(() => store.add(join(at, 'nope'))).toThrowError(/does not exist/)
    expect(store.read().map((entry) => entry.id)).toEqual(['demo'])
  })

  it('refuses a path that is not a directory', () => {
    const at = home()
    const file = join(at, 'plain.txt')
    writeFileSync(file, 'x')

    expect(() => registry(at).add(file)).toThrowError(/not a directory/)
  })

  // spec-00011-AC-3.2: no flow config in the directory
  it('refuses a directory without a flow config, naming the file it looked for', () => {
    const at = home()
    const dir = join(at, 'plain')
    mkdirSync(dir)

    expect(() => registry(at).add(dir)).toThrowError(WorkspaceRefusedError)
    expect(() => registry(at).add(dir)).toThrowError(CONFIG_FILE)
  })

  // spec-00011-AC-3.3: an illegal flow config is availability (T4), not a refusal to register
  it('registers a directory whose flow config is invalid', () => {
    const at = home()

    expect(registry(at).add(project(at, 'demo', 'max_sessions: -1\n')).id).toBe('demo')
  })

  // spec-00011-AC-3.4: no ancestry check — a nested directory with its own git repo registers
  it('registers a directory nested inside another workspace', () => {
    const at = home()
    const store = registry(at)
    const alpha = project(at, 'alpha')
    const sub = project(join(alpha, 'vendor'), 'sub')
    mkdirSync(join(sub, '.git'))

    store.add(alpha)

    expect(store.add(sub)).toEqual({ id: 'sub', name: 'sub', path: sub })
    expect(store.read().map((entry) => entry.id)).toEqual(['alpha', 'sub'])
  })

  /**
   * design-00003 §2 的原子写: the file on disk is the old one or the new one and
   * never half of either. A directory in the staging file's place is a write
   * that cannot succeed, whoever runs the test.
   */
  it('leaves the previous file intact when the write fails', () => {
    const at = home()
    const store = registry(at)
    const first = store.add(project(at, 'demo'))
    const before = readFileSync(registryPath(at), 'utf8')
    mkdirSync(`${registryPath(at)}.tmp`)

    expect(() => store.add(project(at, 'alpha'))).toThrowError()
    expect(readFileSync(registryPath(at), 'utf8')).toBe(before)
    expect(store.read()).toEqual([first])
  })
})

describe('removing a workspace', () => {
  // spec-00011-AC-4.1 at the data level: only the entry goes; the directory is T6/T9's half
  it('removes the entry named by id and leaves the directory alone', () => {
    const at = home()
    const store = registry(at)
    const dir = project(at, 'demo')
    store.add(project(at, 'alpha'))
    const demo = store.add(dir)

    expect(store.remove('demo')).toEqual(demo)
    expect(store.read().map((entry) => entry.id)).toEqual(['alpha'])
    expect(readFileSync(join(dir, CONFIG_FILE), 'utf8')).toBe('types: {}\n')
  })

  // design-00003 §8: the path form is resolved to a real path first, then looked up as an id
  it('removes the entry named by a symlinked path', () => {
    const at = home()
    const store = registry(at)
    const demo = store.add(project(at, 'demo'))
    const link = join(at, 'link')
    symlinkSync(at, link)

    expect(store.remove(join(link, 'demo'))).toEqual(demo)
    expect(store.read()).toEqual([])
  })

  // spec-00011-AC-6.1 的 missing 态与 spec-00011-FR-4: a deleted directory cannot be realpath'd, and is removable all the same
  it('removes the entry named by the path of a directory that is gone', () => {
    const at = home()
    const store = registry(at)
    const dir = project(at, 'demo')
    store.add(dir)
    rmSync(dir, { recursive: true })

    expect(store.remove(dir).id).toBe('demo')
    expect(store.read()).toEqual([])
  })

  // spec-00011-AC-5.2: an id nothing answers to is refused, and the registry is untouched
  it('refuses an id or path that is not registered', () => {
    const at = home()
    const store = registry(at)
    const demo = store.add(project(at, 'demo'))

    expect(() => store.remove('ghost')).toThrowError(WorkspaceRefusedError)
    expect(() => store.remove('ghost')).toThrowError(/ghost/)
    expect(() => store.remove(join(at, 'ghost'))).toThrowError(WorkspaceRefusedError)
    expect(store.read()).toEqual([demo])
  })
})
