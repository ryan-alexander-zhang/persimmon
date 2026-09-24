// Terminal questions for interactive verbs: one readline over stdin for the whole process, answers served in order,
// so a pasted block or typed-ahead lines are never lost between questions.
import type { Interface } from 'node:readline'
import { createInterface } from 'node:readline'
import type { Readable } from 'node:stream'

export type Ask = (prompt: string, mode: 'line' | 'block') => Promise<string | null>

/** `line`: the next line. `block`: lines up to a lone `.`. `null` once the input closed before an answer completed. */
export function asker(input: Readable, write: (s: string) => void): Ask {
  let rl: Interface | undefined
  const lines: string[] = []
  let closed = false
  let wake: (() => void) | undefined
  const open = () => {
    rl ??= createInterface({ input })
      .on('line', (l) => {
        lines.push(l)
        wake?.()
      })
      .on('close', () => {
        closed = true
        wake?.()
      })
  }
  const next = async (): Promise<string | null> => {
    while (lines.length === 0) {
      if (closed) return null
      await new Promise<void>((r) => (wake = r))
      wake = undefined
    }
    return lines.shift()!
  }
  return async (prompt, mode) => {
    open()
    write(prompt)
    if (mode === 'line') return next()
    const out: string[] = []
    for (;;) {
      const l = await next()
      if (l === null) return null
      if (l === '.') return out.join('\n')
      out.push(l)
    }
  }
}
