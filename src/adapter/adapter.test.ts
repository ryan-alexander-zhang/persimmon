import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe as suite, expect, it } from 'vitest'
import { validator } from '../resource/ajv.js'
import type { CredentialStore } from '../store/store.js'
import { AdapterError, AdapterRegistry, describe, isReady, validateAdapter } from './registry.js'
import type { Adapter, StreamLine } from './types.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const creds: CredentialStore = { resolve: (n) => ({ 'anthropic-api-key': 'sk-test' })[n] }
const now = () => new Date('2026-09-24T00:00:00Z')
const fake = (id = 'fake/v1', roles = ['executor']): Adapter => ({
  apiVersion: 'persimmon.ai/v1',
  kind: 'Adapter',
  metadata: { name: id.replace('/', '-') },
  spec: { id, roles, transport: 'stdio', command: ['node', 'test/fixtures/fake-adapter.mjs'], env: { FAKE_ID: id, FAKE_ROLES: roles.join(',') }, credentialBindings: ['anthropic-api-key'] },
})

suite('Adapter resource', () => {
  it('accepts the design examples and rejects a stdio Adapter with a url', () => {
    for (const n of ['adapter-claude-code', 'adapter-http-handler', 'adapter-subprocess']) expect(validateAdapter(example(n)).kind).toBe('Adapter')
    const a = example('adapter-claude-code')
    a.spec.url = 'https://x'
    expect(() => validateAdapter(a)).toThrow(AdapterError)
    const b = example('adapter-claude-code')
    b.spec.env = { PERSIMMON_ADAPTER_CONFORMANCE: '1' } // the engine's names are not a manifest's to set (22-conformance.md)
    expect(() => validateAdapter(b)).toThrow(/PERSIMMON_/)
  })

  it('the design message examples match the protocol schemas', () => {
    const exchange = validator('adapter.yaml', '/$defs/Exchange')
    for (const x of example('adapter-messages')) expect(exchange(x)).toBe(true)
    const cb = validator('adapter.yaml', '/$defs/Callback')
    for (const c of example('adapter-callbacks')) expect(cb(c)).toBe(true)
  })
})

suite('describe', () => {
  it('marks Ready with describe and its digest', async () => {
    const a = await describe(fake(), creds, now)
    expect(isReady(a)).toBe(true)
    expect(a.status?.describe?.roles).toEqual(['executor'])
    expect(a.status?.describeDigest).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect((await describe(fake(), creds, now)).status?.describeDigest).toBe(a.status?.describeDigest)
  })

  it('is not Ready when the id or a role does not match', async () => {
    const wrongId = await describe({ ...fake(), spec: { ...fake().spec, id: 'other/v1' } }, creds, now)
    expect(wrongId.status?.conditions?.[0]).toMatchObject({ type: 'Ready', status: 'False', reason: expect.stringMatching(/adapterId/) })
    const wantsHandler = fake()
    wantsHandler.spec.roles = ['executor', 'handler'] // the fake reports executor only
    const wrongRole = await describe(wantsHandler, creds, now)
    expect(isReady(wrongRole)).toBe(false)
    expect(wrongRole.status?.conditions?.[0]?.reason).toBe('roles not reported: handler')
    const missing = await describe({ ...fake(), spec: { ...fake().spec, command: ['nope-no-such-binary'] } }, creds, now)
    expect(missing.status?.conditions?.[0]?.reason).toMatch(/spawn/)
  })
})

suite('stdio calls', () => {
  const ready = async () => {
    const reg = new AdapterRegistry(creds)
    reg.register(await describe(fake(), creds, now))
    return reg
  }

  it('streams log lines, then succeeds with credentials and token in the environment', async () => {
    process.env.PERSIMMON_CRED_LEAK_TEST = 'must-not-reach-the-adapter'
    const reg = await ready()
    const lines: StreamLine[] = []
    const out = await reg.call('fake/v1', 'execute', { attempt: 1 }, { adapterToken: 'at-1', onStream: (l) => lines.push(l) })
    expect(lines.map((l) => l.event)).toEqual(['log', 'waiting'])
    expect(out).toEqual({ state: 'succeeded', result: { echo: { attempt: 1 }, env: { token: 'at-1', cred: 'sk-test', leaked: null } } })
  })

  it('maps ok:false to failed, a deadline to unknown, and bad output to unknown', async () => {
    const reg = await ready()
    expect(await reg.call('fake/v1', 'fail', {})).toEqual({ state: 'failed', error: { code: 'rate_limit', message: '429', retryable: true } })
    expect(await reg.call('fake/v1', 'hang', {}, { timeoutMs: 200 })).toEqual({ state: 'unknown', reason: 'deadline' })
    expect((await reg.call('fake/v1', 'garbage', {})).state).toBe('unknown')
    expect((await reg.call('fake/v1', 'nope', {})).state).toBe('unknown')
  })

  it('requires a Ready Adapter with the Role', async () => {
    const reg = await ready()
    expect(() => reg.require('fake/v1', 'executor')).not.toThrow()
    expect(() => reg.require('fake/v1', 'handler')).toThrow(/lacks role/)
    expect(() => reg.require('gone/v1')).toThrow(/not registered/)
    reg.register(fake('cold/v1'))
    expect(() => reg.require('cold/v1')).toThrow(/not Ready/)
  })
})
