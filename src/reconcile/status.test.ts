import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { KindRegistry } from '../kind-definition/registry.js'
import type { Resource } from '../resource/types.js'
import { mergePatch, readPath } from './merge-patch.js'
import { applyStatusPatch, CommitError, terminalValue } from './status.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))

describe('mergePatch', () => {
  it('follows RFC 7386', () => {
    expect(mergePatch({ a: 1, b: { c: 1, d: 2 }, e: [1] }, { a: null, b: { c: 9 }, e: [2, 3], f: 'x' })).toEqual({ b: { c: 9, d: 2 }, e: [2, 3], f: 'x' })
    expect(mergePatch(undefined, { a: 1 })).toEqual({ a: 1 })
    expect(mergePatch({ a: 1 }, 5)).toBe(5)
    expect(readPath({ status: { phase: 'Running' } }, 'status.phase')).toBe('Running')
    expect(readPath({}, 'status.phase')).toBeUndefined()
  })
})

describe('applyStatusPatch', () => {
  const kinds = new KindRegistry()
  kinds.register(example('kind-definition-workflowrun'))
  const run = example('resource-namespaced') as Resource
  const t = { path: 'status.phase', values: ['Succeeded', 'Failed', 'Cancelled'] }

  it('applies the RunLog example patches in order', () => {
    const log = example('reconcile-runlog')
    kinds.register(example('kind-definition-task'))
    let r: Resource = { ...example('resource-child'), status: {} }
    const taskRunKd = structuredClone(example('kind-definition-workflowrun'))
    taskRunKd.metadata.name = 'taskruns.persimmon.ai'
    taskRunKd.spec.names = { kind: 'TaskRun', plural: 'taskruns' }
    taskRunKd.spec.versions[0].schema = { type: 'object' }
    taskRunKd.spec.versions[0].statusSchema = { type: 'object', properties: { phase: { enum: ['Pending', 'Running', 'Waiting', 'Succeeded', 'Failed', 'Cancelled'] } } }
    kinds.register(taskRunKd)
    for (const e of log.entries) r = applyStatusPatch(r, e.result.statusPatch, kinds)
    expect(r.status?.phase).toBe('Succeeded')
    expect((r.status?.attempts as unknown[]).length).toBe(2)
    expect(terminalValue(r, t)).toBe('Succeeded')
  })

  it('validates against statusSchema and freezes the terminal value', () => {
    expect(() => applyStatusPatch(run, { phase: 'Done' }, kinds)).toThrow(CommitError)
    const done = applyStatusPatch(run, { phase: 'Failed', error: { code: 'timeout', message: 't', retryable: true } }, kinds)
    expect(terminalValue(done, t)).toBe('Failed')
    expect(() => applyStatusPatch(done, { phase: 'Running' }, kinds)).toThrow(/terminal/)
    expect(applyStatusPatch(done, { outputs: {} }, kinds).status?.phase).toBe('Failed')
    expect(applyStatusPatch(run, undefined, kinds)).toBe(run)
  })
})
