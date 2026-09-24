#!/usr/bin/env node
import { asker } from './cli/ask.js'
import { runCli } from './cli/index.js'

const code = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (l) => process.stdout.write(l + '\n'),
  err: (l) => process.stderr.write(l + '\n'),
  ...(process.stdin.isTTY ? { ask: asker(process.stdin, (s) => process.stdout.write(s)) } : {}),
})
process.exit(code)
