// Context resolution (12-task.md Context): an artifacts input injects one artifact entry per ref, in order.
import { describe, expect, it } from 'vitest'
import { ContextError, resolveContext } from './context.js'
import type { InputSpec } from '../ports/types.js'

const kind = { apiVersion: 'sdd.persimmon.ai/v1', kind: 'Design' }
const ref = (id: string) => ({ ...kind, namespace: 'default', id, revision: 1 })
const inputs: Record<string, InputSpec> = { designs: { type: { kind: 'artifacts', artifactKind: kind } }, spec: { type: { kind: 'artifact', artifactKind: { ...kind, kind: 'Spec' } }, required: false } }
const closure = { resources: [] } as never

describe('resolveContext', () => {
  it('expands an artifacts input to one entry per ref, in order', () => {
    const entries = [{ kind: 'artifact' as const, input: 'designs' }, { kind: 'artifact' as const, input: 'spec' }]
    const out = resolveContext(entries, inputs, { designs: { kind: 'artifacts', refs: [ref('claims-api'), ref('claims-schema')] } }, closure, undefined)
    expect(out).toEqual([{ kind: 'artifact', ref: ref('claims-api') }, { kind: 'artifact', ref: ref('claims-schema') }]) // spec is optional and unbound: dropped
    expect(resolveContext(entries, inputs, { designs: { kind: 'artifacts', refs: [] } }, closure, undefined)).toEqual([])
    expect(() => resolveContext(entries, inputs, { designs: { kind: 'value', value: 1 } }, closure, undefined)).toThrow(ContextError)
  })
})
