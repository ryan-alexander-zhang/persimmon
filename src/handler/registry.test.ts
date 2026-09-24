import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { validator } from '../resource/ajv.js'
import { HandlerError, HandlerRegistry } from './registry.js'
import type { HandlerImpl } from './types.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const noop: HandlerImpl = { validate: () => ({ findings: [] }), reconcile: () => ({ actions: [] }) }

describe('HandlerRegistry', () => {
  it('binds a builtin to every (kind, version) it lists', () => {
    const reg = new HandlerRegistry(new Map([['workflow', noop]]))
    reg.register(example('handler-workflow'))
    expect(reg.get('persimmon.ai/v1', 'WorkflowRun').impl).toBe(noop)
    expect(reg.get('persimmon.ai/v1', 'Workflow').handler.metadata.name).toBe('workflow')
    expect(reg.lookup('persimmon.ai/v2', 'Workflow')).toBeUndefined()
    expect(() => reg.get('persimmon.ai/v1', 'Task')).toThrow(HandlerError)
  })

  it('rejects an unknown builtin and a second Handler for a kind version', () => {
    const reg = new HandlerRegistry(new Map([['workflow', noop]]))
    expect(() => reg.register(example('handler-trigger'))).toThrow(/no builtin named trigger/)
    reg.register(example('handler-workflow'))
    expect(() => reg.register(example('handler-workflow'))).toThrow(/already handled/)
  })

  it('registers an Adapter implementation without an impl', () => {
    const reg = new HandlerRegistry(new Map())
    reg.register(example('handler-adapter'))
    expect(reg.get('engineering.persimmon.ai/v1', 'ReviewLoop').impl).toBeUndefined()
  })

  it('rejects a Handler with both implementations', () => {
    const reg = new HandlerRegistry(new Map([['workflow', noop]]))
    const h = example('handler-workflow')
    h.spec.implementation.adapter = { id: 'x/v1' }
    expect(() => reg.register(h)).toThrow(HandlerError)
  })

  it('the design reconcile io example matches the contract schemas', () => {
    const io = example('handler-reconcile-io')
    expect(validator('handler.yaml', '/$defs/ReconcileInput')(io.input)).toBe(true)
    expect(validator('handler.yaml', '/$defs/ReconcileResult')(io.output)).toBe(true)
  })
})
