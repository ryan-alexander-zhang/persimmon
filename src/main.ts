#!/usr/bin/env node
import { runCli } from './cli/index.js'

const code = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (l) => process.stdout.write(l + '\n'),
  err: (l) => process.stderr.write(l + '\n'),
})
process.exit(code)
