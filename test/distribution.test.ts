import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
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
  for (const shipped of ['bin', 'lib', 'scripts', 'dist/web']) {
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

// issue-00029 · spec-00011-AC-20.1 — the installed layout runs from node_modules.
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
