// The one installed form the host package has, run for real: `npm pack`, then
// `npx --package <tarball> -- persimmon-host --judge`. That is how the
// `persimmon` command reaches the host (design-00004 §3), so it is the only
// acquisition form there is to test — the global install and the `persimmon` bin
// the two halves of this check used to cover went with `bin/persimmon.js`
// (plan-00033 T7); the command itself is acquired through `install.sh` and the
// Release archives, which `test/install.test.ts` covers.
//
// Not part of `npm test` — the tarball is local but its dependencies come from
// the registry (a clean `HOME` means a cold cache, and `--offline` is
// ENOTCACHED), so this is a network-bound, minute-scale smoke check
// (TESTING.md, E2E). It covers issue-00029 §7 and issue-00030 §5 (a real pty in
// the installed copy, which `--judge` never opens).
//
// npm >= 11.17 blocks dependency install scripts unless they are approved, so a
// plain install leaves node-pty's `spawn-helper` without its executable bit and
// this package's own `postinstall` unrun (`npm warn allow-scripts ... not yet
// covered by allowScripts`). The commands below deliberately run as a user's
// would; `--allow-scripts=<pkg>,node-pty` is npm's opt-in, and is npm policy to
// pass at install time rather than anything the package can arrange for itself.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), 'persimmon-install-'))
const home = join(scratch, 'home')
const elsewhere = join(scratch, 'elsewhere')
for (const dir of [home, elsewhere]) mkdirSync(dir)

const failures = []

const tarball = join(scratch, run('pack', ROOT, 'npm', ['pack', '--pack-destination', scratch]).trim().split('\n').pop())
console.log(`tarball: ${tarball}`)

// «What is shipped must be runnable»: no source and no `.ts` in the tarball.
const shipped = run('tar -tf', scratch, 'tar', ['-tf', tarball])
for (const line of shipped.split('\n').filter((entry) => entry.endsWith('.ts') || entry.startsWith('package/src/'))) {
  fail(`tarball ships ${line}`)
}

// The query mode, because it answers and exits: the registry of an untouched
// `HOME` is empty, and reading it at all proves the installed copy runs.
const judged = check('npx --judge', 'npx', ['--yes', '--package', tarball, '--', 'persimmon-host', '--judge'], '{"workspaces":[]}\n')

// issue-00030: a pty through the installed copy's own `lib/pty.js`, with the
// helper's mode as the install left it. The npx copy lives wherever npm put
// first on the PATH it runs commands with; node-pty is resolved from the copy,
// as the runtime does, because npx hoists it beside the package.
const npxBin = check('npx PATH', 'npx', ['--yes', '--package', tarball, '--', 'node', '-p', 'process.env.PATH.split(":")[0]'])
const pty = join(npxBin.trim(), '..', '@ryan-alexander-zhang', 'persimmon-host', 'lib', 'pty.js')
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
console.log(`\nthe installed host answered ${JSON.stringify(judged.trim())} — ok`)

/** Run one of the installed commands; `expected`, when given, must match its output exactly. */
function check(what, command, args, expected) {
  const result = spawnSync(command, args, {
    cwd: elsewhere,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  })
  if (result.status !== 0) fail(`${what} exited ${result.status}: ${result.stderr.trim()}`)
  else if (expected !== undefined && result.stdout !== expected) {
    fail(`${what} printed ${JSON.stringify(result.stdout)}, expected ${JSON.stringify(expected)}`)
  }
  return result.stdout
}

/** A step the check cannot go on without: its failure is the whole run's. */
function run(what, cwd, command, args) {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } })
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
