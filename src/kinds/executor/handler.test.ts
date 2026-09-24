import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { AdapterRegistry } from '../../adapter/registry.js'
import { KindRegistry } from '../../kind-definition/registry.js'
import type { HandlerDeps } from '../deps.js'
import { executorHandler } from './handler.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const adapters = new AdapterRegistry({ resolve: () => undefined })
for (const a of ['adapter-claude-code', 'adapter-review-ui', 'adapter-subprocess']) adapters.register(example(a))
const deps: HandlerDeps = { kinds: new KindRegistry(), adapters, now: () => new Date(), closure: () => ({ version: 1, resources: [], adapters: [] }), callback: () => undefined, getResource: () => undefined, getByUid: () => undefined, random: () => 0 }
const handler = executorHandler(deps)

describe('executor validate', () => {
  it.each(['executor-claude-agent', 'executor-product-reviewers', 'executor-lint-script'])('%s is clean', (n) => {
    expect(handler.validate(example(n)).findings).toEqual([])
  })

  it('checks type, configuration, human completion and credential Namespaces', () => {
    const e = example('executor-claude-agent')
    e.spec.type = 'human'
    e.spec.configuration = { sandbox: 'full' }
    e.spec.security.credentialBindings = ['ops/token']
    expect(handler.validate(e).findings.map((f) => f.message)).toEqual([
      'claude-code/v1 does not execute type human',
      'configuration does not match describe.configurationSchema',
      'claude-code/v1 does not support human completion',
      'ops/token belongs to another Namespace',
    ])
  })

  it('warns when the Adapter is unavailable', () => {
    const e = example('executor-claude-agent')
    e.spec.adapter = 'gone/v1'
    expect(handler.validate(e).findings).toEqual([{ severity: 'warning', code: 'adapter_unavailable', path: '/spec/adapter', message: 'adapter gone/v1 not registered' }])
  })
})
