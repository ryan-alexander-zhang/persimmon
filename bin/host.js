#!/usr/bin/env node
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Host } from '../lib/host.js'
import { AvailabilityJudge } from '../lib/workspaceAvailability.js'
import { WorkspaceRegistry } from '../lib/workspaceRegistry.js'

/**
 * The host package's bin: it serves and nothing else. Probing, registration and
 * the subcommands are the `persimmon` command's (design-00004 §3), which reaches
 * this file through `npx` and hands it `PORT` and `PERSIMMON_WORKSPACE`.
 */

const { version } = createRequire(import.meta.url)('../package.json')
// The same reading as the command's, so what it probed and what this binds are
// one `(127.0.0.1, PORT)` pair (design-00004 §3 追注); started by hand
// (`npm start`), the default is this one.
const port = Number(process.env.PORT ?? 4173)
// The registry lives in the user's home directory and takes no environment
// variable of its own (design-00003 §2); a test points `HOME` at a temporary
// directory, which is what `os.homedir()` reads on POSIX.
const registryPath = join(homedir(), '.persimmon', 'workspaces.json')

try {
  if (process.argv.includes('--judge')) judge()
  else start()
} catch (error) {
  // An ill-formed registry (spec-00011-FR-18) is one sentence and a non-zero
  // exit, never a stack.
  fail(error.message)
}

/** Serve on the port the command probed, and print the address only it knows the bound port of. */
function start() {
  const host = new Host({ registryPath, version })
  const server = host.listen(port)
  const workspace = process.env.PERSIMMON_WORKSPACE

  // A normal shutdown wraps up every running session before the process goes, so
  // what the agents wrote is committed and their transcripts are on disk
  // (spec-00011-FR-16). `host.shutdown()` is idempotent: a second Ctrl-C joins
  // the one already running rather than exiting out from under it.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      void host.shutdown().then(() => process.exit(0))
    })
  }

  server.on('listening', () => {
    const at = workspace === undefined ? '' : `w/${workspace}`
    console.log(`persimmon: http://localhost:${server.address().port}/${at}`)
  })
  server.on('error', (error) => {
    // The port was free when the command probed it and is not any more
    // (spec-00011-FR-15, design-00004 §3).
    const why = error.code === 'EADDRINUSE' ? 'is already in use' : `cannot be listened on — ${error.message}`
    fail(`port ${port} ${why}`)
  })
}

/**
 * `--judge` (design-00004 §4): the query mode `persimmon list` asks for, because
 * `available` and `invalidConfig` need the flow config validator the command
 * carries no second copy of. Same shape as `GET /api/workspaces` without the
 * sessions, and no server is listened on.
 */
function judge() {
  const judge = new AvailabilityJudge()
  // No process is running, so no workspace is live (spec-00011-FR-6).
  const entries = new WorkspaceRegistry(registryPath).read()
  const workspaces = entries.map((entry) => ({ ...entry, ...judge.judge(entry, false) }))
  console.log(JSON.stringify({ workspaces }))
}

function fail(message) {
  console.error(`persimmon-host: ${message}`)
  process.exit(1)
}
