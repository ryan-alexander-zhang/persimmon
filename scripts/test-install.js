// The installed forms this package has, run for real against one `npm pack`
// tarball (no publish was ever needed here, and none is possible yet — the name
// is unpublished). Four cells, each the place its acceptance reads from
// (design-00004 §7, spec-00011 §7, spec-00012 §7):
//
//   1. `npm link` in this checkout, then `persimmon version` from another
//      directory — spec-00012-AC-10.1 ("before publication this is how you get
//      it"). `npm pack` runs `prepack` (`npm run build`) for us, so the linked
//      copy is built; the AC's `npm ci` is the checkout's own state, not
//      something this script re-does under another agent's feet.
//   2. `npx --yes --package <tarball> -- persimmon list`.
//   3. the same tarball installed globally, then `persimmon list` — that cell is
//      spec-00011-AC-20.1 (bin on PATH, any directory, prints the registry), and
//      cells 2 and 3 are compared byte for byte: spec-00011-AC-20.2 and
//      spec-00012-AC-10.2.
//   4. a real pty through the cached (no-install-scripts) form — spec-00011
//      AC-20.3's obligation, which stays outside that spec's acceptance set, and
//      issue-00030's reading. `list` never opens a pty, which is exactly how
//      issue-00030 hid.
//
// Each cell runs under a clean `HOME` and its own npm prefix, so nothing here
// touches the developer's global install or npm cache.
//
// Not part of `npm test` — the tarball is local but its dependencies come from
// the registry (a clean `HOME` means a cold cache, and `--offline` is
// ENOTCACHED), so this is a network-bound, minute-scale smoke check
// (TESTING.md, E2E). It also covers issue-00029 §7 (nothing but built JS ships).
//
// npm >= 11.17 blocks dependency install scripts unless they are approved, so a
// plain install leaves node-pty's `spawn-helper` without its executable bit and
// this package's own `postinstall` unrun (`npm warn allow-scripts ... not yet
// covered by allowScripts`). The commands below deliberately run as a user's
// would; `--allow-scripts=<pkg>,node-pty` is npm's opt-in, and is npm policy to
// pass at install time rather than anything the package can arrange for itself.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE = '@ryan-alexander-zhang/persimmon'
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'persimmon-install-'))
const home = join(scratch, 'home')
const elsewhere = join(scratch, 'elsewhere')
const linkPrefix = join(scratch, 'prefix-link')
const globalPrefix = join(scratch, 'prefix-global')
for (const dir of [home, elsewhere, linkPrefix, globalPrefix]) mkdirSync(dir)

const failures = []

const tarball = join(scratch, run('pack', ROOT, 'npm', ['pack', '--pack-destination', scratch]).trim().split('\n').pop())
console.log(`tarball: ${tarball}`)

// «What is shipped must be runnable»: no source and no `.ts` in the tarball.
const shipped = run('tar -tf', scratch, 'tar', ['-tf', tarball])
for (const line of shipped.split('\n').filter((entry) => entry.endsWith('.ts') || entry.startsWith('package/src/'))) {
  fail(`tarball ships ${line}`)
}

// 1. spec-00012-AC-10.1: the checkout, linked, answering from another directory.
run('npm link', ROOT, 'npm', ['link'], { npm_config_prefix: linkPrefix })
const linkedVersion = check('link version', 'persimmon', ['version'], { prefix: linkPrefix })
console.log(`npm link: persimmon version → ${JSON.stringify(linkedVersion.trim())}`)

// 2 and 3. The same tarball, both acquisition forms, one `list` each. The clean
// `HOME` is seeded with one entry so the comparison has something to be equal
// about — two empty outputs would match however broken `list` were — and this
// checkout is the entry, so both forms also judge its availability.
mkdirSync(join(home, '.persimmon'))
writeFileSync(
  join(home, '.persimmon', 'workspaces.json'),
  `${JSON.stringify({ version: 1, workspaces: [{ id: 'persimmon', name: 'persimmon', path: resolve(ROOT) }] }, null, 2)}\n`,
)
const viaNpx = check('npx list', 'npx', ['--yes', '--package', tarball, '--', 'persimmon', 'list'])
run('npm install -g', scratch, 'npm', ['install', '-g', tarball], { npm_config_prefix: globalPrefix })
const viaGlobal = check('global list', 'persimmon', ['list'], { prefix: globalPrefix })
if (viaNpx !== viaGlobal) fail(`npx printed ${JSON.stringify(viaNpx)}, global printed ${JSON.stringify(viaGlobal)}`)
console.log(`npx list = global list: ${viaNpx === viaGlobal} — ${JSON.stringify(viaNpx)}`)

// 4. issue-00030: a pty through the installed copy's own `lib/pty.js`, with the
// helper's mode as the install left it. The npx copy lives wherever npm put
// first on the PATH it runs commands with; node-pty is resolved from the copy,
// as the runtime does, because npx hoists it beside the package.
const npxBin = check('npx PATH', 'npx', ['--yes', '--package', tarball, '--', 'node', '-p', 'process.env.PATH.split(":")[0]'])
const pty = join(npxBin.trim(), '..', ...PACKAGE.split('/'), 'lib', 'pty.js')
const mode = check('spawn-helper mode', 'node', ['--input-type=module', '-e', `
  import { createRequire } from 'node:module'
  import { statSync } from 'node:fs'
  import { dirname, join } from 'node:path'
  const helper = join(dirname(createRequire(${JSON.stringify(pty)}).resolve('node-pty')), '..', 'prebuilds', process.platform + '-' + process.arch, 'spawn-helper')
  console.log((statSync(helper).mode & 0o777).toString(8))
`])
console.log(`spawn-helper: ${mode.trim()} before the first spawn`)
check('npx pty', 'node', ['--input-type=module', '-e', `
  import { spawnPty } from ${JSON.stringify(pty)}
  spawnPty('true', [], process.cwd(), process.env).onExit(({ exitCode }) => process.exit(exitCode))
`])

if (failures.length > 0) {
  console.error(`\n${failures.length} failure(s):\n${failures.map((line) => `  - ${line}`).join('\n')}`)
  console.error(`scratch kept at ${scratch}`)
  process.exit(1)
}
rmSync(scratch, { recursive: true, force: true })
console.log('\nall four cells passed — ok')

/**
 * Run one of the installed commands from a directory that is not the checkout.
 * `prefix` puts that install's `bin` first on PATH, so the bin name is resolved
 * the way a user's shell resolves it; `expected`, when given, must match the
 * command's output exactly.
 */
function check(what, command, args, { expected, prefix } = {}) {
  // A port no whiteboard of the developer's is on: `list` reads the registry
  // file only when no process answers, and the seeded file is the fixture here.
  const env = { ...process.env, HOME: home, PORT: '47313' }
  if (prefix) env.PATH = `${join(prefix, 'bin')}:${env.PATH}`
  const result = spawnSync(command, args, { cwd: elsewhere, encoding: 'utf8', env })
  if (result.status !== 0) fail(`${what} exited ${result.status}: ${result.stderr.trim()}`)
  else if (expected !== undefined && result.stdout !== expected) {
    fail(`${what} printed ${JSON.stringify(result.stdout)}, expected ${JSON.stringify(expected)}`)
  }
  return result.stdout
}

/** A step the check cannot go on without: its failure is the whole run's. */
function run(what, cwd, command, args, env) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, HOME: home, ...env } })
  } catch (error) {
    console.error(`${what} failed: ${error.stderr ?? error.message}`)
    console.error(`scratch kept at ${scratch}`)
    process.exit(1)
  }
}

function fail(message) {
  console.error(`FAIL ${message}`)
  failures.push(message)
}
