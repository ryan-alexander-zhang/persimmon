import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { ConfigError, durationMs, loadConfig, parseConfig } from './config.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))

describe('config', () => {
  it('fills every default so {} equals the explicit local example minus its extra sources', () => {
    const c = parseConfig({})
    const explicit = example('store-config-local')
    expect(c).toEqual({ ...explicit, credentials: [{ source: 'env', prefix: 'PERSIMMON_CRED_' }] })
  })

  it('accepts the server example and its defaults', () => {
    const c = parseConfig(example('store-config-server'))
    expect(c.server?.grants[1]).toEqual({ actor: { kind: 'user', id: 'payments-team' }, namespaces: ['payments', 'demo'], admin: false })
  })

  it('rejects server mode without server block, and keychain in server mode', () => {
    expect(() => parseConfig({ mode: 'server' })).toThrow(ConfigError)
    const s = example('store-config-server')
    s.credentials = [{ source: 'keychain' }]
    expect(() => parseConfig(s)).toThrow(ConfigError)
  })

  it('a missing file means defaults', () => {
    expect(loadConfig('nope/persimmon.yaml').mode).toBe('local')
  })

  it('parses durations', () => {
    expect(durationMs('30s')).toBe(30_000)
    expect(durationMs('1h')).toBe(3_600_000)
    expect(durationMs('250ms')).toBe(250)
    expect(() => durationMs('1w')).toThrow(ConfigError)
  })
})
