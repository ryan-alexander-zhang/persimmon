#!/usr/bin/env node
import { run } from '../lib/cli.js'

// The command's whole entry point: argv in, exit code out. Every line of the
// command itself lives in `src/cli.ts`, where the coverage gate reaches it —
// nothing but these three lines may ever be added here (spec-00012 §7).
process.exit(await run(process.argv.slice(2)))
