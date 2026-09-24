import { describe, expect, it } from 'vitest'
import { ConfigCredentialStore, envName } from './credentials.js'

describe('credentials', () => {
  it('maps names to env variables', () => {
    expect(envName('PERSIMMON_CRED_', 'anthropic-api-key')).toBe('PERSIMMON_CRED_ANTHROPIC_API_KEY')
    expect(envName('PERSIMMON_CRED_', 'demo/github-token')).toBe('PERSIMMON_CRED_DEMO__GITHUB_TOKEN')
  })

  it('tries sources in order, first match wins', () => {
    const env = { PERSIMMON_CRED_REVIEW_LOOP_TOKEN: 'from-env' }
    const store = new ConfigCredentialStore(
      [{ source: 'env' }, { source: 'file', path: 'docs/design/examples/store-credentials-local.yaml' }, { source: 'keychain' }],
      env,
    )
    expect(store.resolve('review-loop-token')).toBe('from-env')
    expect(store.resolve('demo/github-token')).toBe('ghp-REDACTED')
    expect(store.resolve('anthropic-api-key')).toBe('sk-ant-REDACTED')
    expect(store.resolve('missing')).toBeUndefined()
  })

  it('keychain asks security once per name and treats a failure as absent', () => {
    const calls: string[][] = []
    const run = (_cmd: string, args: string[]) => {
      calls.push(args)
      if (args.includes('demo/registry-token')) return 'reg-1\n'
      throw Object.assign(new Error('The specified item could not be found in the keychain.'), { status: 44 })
    }
    const store = new ConfigCredentialStore([{ source: 'keychain' }], {}, run)
    expect(store.resolve('demo/registry-token')).toBe('reg-1')
    expect(store.resolve('demo/registry-token')).toBe('reg-1')
    expect(store.resolve('nope')).toBeUndefined()
    expect(calls).toEqual([['find-generic-password', '-s', 'persimmon', '-a', 'demo/registry-token', '-w'], ['find-generic-password', '-s', 'persimmon', '-a', 'nope', '-w']])
    const locked = new ConfigCredentialStore([{ source: 'keychain' }], {}, () => {
      throw Object.assign(new Error('User interaction is not allowed.'), { status: 36 })
    })
    expect(() => locked.resolve('x')).toThrow(/keychain lookup of x failed \(exit 36\)/)
  })
})
