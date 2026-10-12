// The conformance suite over every shipped Adapter (22-conformance.md), and once over a non-conforming one.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import type { AdapterSpec } from '../../src/adapter/types.js'
import { conformance, rules } from '../../src/conformance/suite.js'

const root = join(import.meta.dirname, '..', '..')
const shipped = ['claude-code', 'codex', 'subprocess', 'cli-human'] // eventstorming/v1 has its own test below
const spec = (id: string): AdapterSpec => {
  const s = (parse(readFileSync(join(root, 'adapters', id, 'adapter.yaml'), 'utf8')) as { spec: AdapterSpec }).spec
  return { ...s, command: [process.execPath, join(root, s.command![1]!)] }
}
const failures = (v: Awaited<ReturnType<typeof conformance>>) => v.filter((x) => x.status === 'FAIL').map((x) => `${x.id} ${x.reason}`)

describe('conformance suite', () => {
  it('lists the rules the design lists, in order', () => {
    const doc = readFileSync(join(root, 'docs/design/22-conformance.md'), 'utf8')
    expect(Object.keys(rules)).toEqual([...doc.matchAll(/^\| ([EV]\d+) \|/gm)].map((m) => m[1]))
  })

  it.each(shipped)('%s passes', async (id) => {
    const v = await conformance(spec(id))
    expect(failures(v)).toEqual([])
    expect(v.map((x) => x.id)).toEqual(Object.keys(rules))
  }, 60_000)

  it('eventstorming/v1 is an evaluator: V1-V5 pass, the executor rules skip', async () => {
    const v = await conformance(spec('eventstorming'))
    expect(v.filter((x) => x.id.startsWith('V'))).toEqual(Object.keys(rules).filter((id) => id.startsWith('V')).map((id) => ({ id, rule: rules[id as keyof typeof rules], status: 'pass' })))
    expect(v.filter((x) => x.id.startsWith('E')).every((x) => x.status === 'skip' && x.reason === 'not an executor')).toBe(true)
  }, 60_000)

  it('a non-conforming Adapter fails E3 and skips what depends on it', async () => {
    const fake = (env: Record<string, string>) => ({ id: 'fake/v1', roles: ['executor'], transport: 'stdio' as const, command: [process.execPath, join(root, 'test/fixtures/fake-adapter.mjs')], env })
    const v = await conformance(fake({ FAKE_TYPES: 'agent' }))
    expect(v.find((x) => x.id === 'E3')).toMatchObject({ status: 'FAIL', reason: expect.stringContaining('result:') })
    expect(v.find((x) => x.id === 'E4')).toMatchObject({ status: 'skip', reason: 'E3 did not publish' })
    // publishes the right thing but ignores the stub contract: no record, so the credential rules cannot pass
    const w = await conformance(fake({ FAKE_TYPES: 'agent', FAKE_MODE: 'publish', FAKE_TITLE: 'Fixture note', FAKE_VALUES: '{"count":1}' }))
    expect(w.find((x) => x.id === 'E3')).toMatchObject({ status: 'FAIL', reason: expect.stringContaining('wrote no record') })
    expect(w.filter((x) => ['E5', 'E6', 'E11'].includes(x.id)).map((x) => x.reason)).toEqual(['E3 left no record', 'E3 left no record', 'E3 left no record'])
  }, 60_000)
})
