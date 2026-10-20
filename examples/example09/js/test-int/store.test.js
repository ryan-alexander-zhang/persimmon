import { GenericContainer } from 'testcontainers'
import { describe, expect, it } from 'vitest'

describe('store', () => {
  it('a drafted claim is written to a real container and read back', async () => {
    const c = await new GenericContainer('alpine:3.20').withCommand(['sleep', '60']).start()
    await c.exec(['sh', '-c', 'echo c-e1 > /tmp/claim'])
    const { output } = await c.exec(['cat', '/tmp/claim'])
    await c.stop()
    expect(output.trim()).toBe('c-e1')
  })
})
