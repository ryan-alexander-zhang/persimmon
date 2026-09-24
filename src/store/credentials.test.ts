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
})
