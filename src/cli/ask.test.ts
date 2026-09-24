import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { asker } from './ask.js'

describe('asker', () => {
  it('serves typed-ahead lines in order across questions, blocks end at a lone dot, EOF is null', async () => {
    const input = new PassThrough()
    const prompts: string[] = []
    const ask = asker(input, (s) => prompts.push(s))
    input.write('y\nfirst\nsecond\n.\n') // everything pasted at once
    expect(await ask('approve? ', 'line')).toBe('y')
    expect(await ask('notes:\n', 'block')).toBe('first\nsecond')
    const pending = ask('more? ', 'line')
    input.end() // Ctrl-D
    expect(await pending).toBeNull()
    expect(await ask('again? ', 'block')).toBeNull()
    expect(prompts).toEqual(['approve? ', 'notes:\n', 'more? ', 'again? '])
  })
})
