#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { runCli } from './cli/index.js'

const code = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (l) => process.stdout.write(l + '\n'),
  err: (l) => process.stderr.write(l + '\n'),
  ...(process.stdin.isTTY
    ? {
        ask: (prompt: string) =>
          new Promise<string>((resolve) => {
            process.stdout.write(prompt)
            const lines: string[] = []
            const rl = createInterface({ input: process.stdin })
            rl.on('line', (l) => (l === '.' ? rl.close() : lines.push(l)))
            rl.on('close', () => resolve(lines.join('\n')))
          }),
      }
    : {}),
})
process.exit(code)
