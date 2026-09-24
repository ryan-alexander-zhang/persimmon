#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { runCli } from './cli/index.js'

const code = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (l) => process.stdout.write(l + '\n'),
  err: (l) => process.stderr.write(l + '\n'),
  ...(process.stdin.isTTY
    ? {
        ask: (prompt: string, mode: 'line' | 'block') =>
          new Promise<string | null>((resolve) => {
            process.stdout.write(prompt)
            const lines: string[] = []
            let done = false
            const rl = createInterface({ input: process.stdin })
            rl.on('line', (l) => {
              if (mode === 'line' || l === '.') {
                done = true
                if (mode === 'line') lines.push(l)
                rl.close()
              } else lines.push(l)
            })
            rl.on('close', () => resolve(done ? lines.join('\n') : null)) // close without an answer is EOF
          }),
      }
    : {}),
})
process.exit(code)
