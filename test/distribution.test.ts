import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { freePort } from './helpers.ts'

/**
 * What the package ships has to run from inside `node_modules`, where Node
 * refuses to strip types (issue-00029). The installer is not what this proves —
 * the layout is: a copy of the published files under a `node_modules` tree, its
 * dependencies resolved from a sibling, and the real entry point spawned out of
 * it. It stays in the default suite because it needs no network and no install.
 */

const ROOT = new URL('..', import.meta.url).pathname
const PACKAGE = '@ryan-alexander-zhang/persimmon'
const SCOPE = '@ryan-alexander-zhang'

const made: string[] = []

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/**
 * The `files` list of `package.json` copied to `<tmp>/node_modules/<name>/`, with
 * the repository's own dependencies symlinked in as siblings — Node walks up from
 * the entry point and finds them there, which is how an installed package reaches
 * `express`, `ws` and `node-pty`. `dist/web` is the browser bundle, so it is
 * copied when a UI build is around and left out otherwise: no command reads it
 * from Node, and the default suite does not presuppose `npm run build`.
 */
function installedTree(): { pkg: string; home: string } {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'wb-dist-')))
  made.push(tmp)
  const modules = join(tmp, 'node_modules')
  const pkg = join(modules, PACKAGE)
  mkdirSync(pkg, { recursive: true })
  cpSync(join(ROOT, 'package.json'), join(pkg, 'package.json'))
  // Mirrors `files` in package.json: only the postinstall helper ships from scripts/ (plan-00033 T8).
  for (const shipped of ['bin', 'lib', 'scripts/fix-pty-permissions.js', 'dist/web']) {
    if (existsSync(join(ROOT, shipped))) cpSync(join(ROOT, shipped), join(pkg, shipped), { recursive: true })
  }
  for (const entry of readdirSync(join(ROOT, 'node_modules'))) {
    // The scope directory the package itself occupies is already there.
    if (entry !== SCOPE) symlinkSync(join(ROOT, 'node_modules', entry), join(modules, entry))
  }
  const home = join(tmp, 'home')
  mkdirSync(home)
  return { pkg, home }
}

// issue-00029 — the installed layout runs from node_modules. `list` is what it
// is spawned in: on an empty home it reads the registry, prints nothing and
// exits, so the assertion is about the layout and not about a server.
it('runs the shipped entry point from under node_modules', async () => {
  const { pkg, home } = installedTree()

  const result = spawnSync(process.execPath, [join(pkg, 'bin', 'persimmon.js'), 'list'], {
    cwd: pkg,
    encoding: 'utf8',
    env: { ...process.env, HOME: home, PORT: String(await freePort()) },
    timeout: 20_000,
  })

  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  expect(result.stdout).toBe('')
})

// spec-00012-AC-9.3 — the version is read from the package.json that ships, so
// the shape it was obtained in does not change it (spec-00012-FR-9). This layout
// is the `npm pack` + global install of the AC, minus the install itself.
it('prints the version of the installed package.json', async () => {
  const { pkg, home } = installedTree()
  const declared = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version as string

  const result = spawnSync(process.execPath, [join(pkg, 'bin', 'persimmon.js'), 'version'], {
    cwd: pkg,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
    timeout: 20_000,
  })

  expect(result.stderr).toBe('')
  expect(result.status).toBe(0)
  expect(result.stdout.trim()).toBe(`persimmon ${declared}`)
})
