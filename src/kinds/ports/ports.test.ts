import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { ExpressionError } from '../../expression/site.js'
import { bind, checkInputs, checkOutputs, expandSchema, inlineSchema, PortError, sameType, siteOf } from './ports.js'
import type { Binding, InputSpec, OutputSpec, RuntimeValue } from './types.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const task = example('ports-task') as { inputs: Record<string, InputSpec>; outputs: Record<string, OutputSpec> }
const values = example('ports-runtime-values') as RuntimeValue[]
const [num, validation, report, repo] = values as [RuntimeValue, RuntimeValue, RuntimeValue, RuntimeValue]

describe('port types', () => {
  it('expands well-known refs and compares by expanded equality', () => {
    expect(expandSchema({ $ref: 'persimmon.ai/v1#/GateResult' })).toMatchObject({ required: ['passed', 'results'] })
    expect(() => expandSchema({ $ref: 'persimmon.ai/v1#/Nope' })).toThrow(PortError)
    const a = { kind: 'value' as const, schema: { $ref: 'persimmon.ai/v1#/RevisionRef' } }
    expect(sameType(a, { kind: 'value', schema: expandSchema(a.schema) })).toBe(true)
    expect(sameType(a, { kind: 'value', schema: { type: 'integer' } })).toBe(false)
    expect(sameType(task.inputs.research!.type, task.outputs.prd!.type)).toBe(false)
  })

  it('inlines every $ref so the schema stands alone', () => {
    const s = inlineSchema({ $ref: 'persimmon.ai/v1#/GateResult' }) as Record<string, any>
    expect(JSON.stringify(s)).not.toContain('$ref')
    expect(s.properties.results.additionalProperties.properties.findings.items.properties.severity).toEqual({ enum: ['error', 'warning', 'info'] })
    expect(s.properties.results.additionalProperties.properties.evidence.items.required).toEqual(['apiVersion', 'kind', 'namespace', 'id', 'revision'])
    expect(inlineSchema({ type: 'integer' })).toEqual({ type: 'integer' })
    expect(() => inlineSchema({ $ref: 'persimmon.ai/v1#/Nope' })).toThrow(PortError)
  })

  it('checks inputs: required, defaults, kinds, schemas, unknown ports', () => {
    const bound = checkInputs(task.inputs, { research: report })
    expect(bound).toEqual({ research: report, maxRequirements: { kind: 'value', value: 12 } })
    expect(() => checkInputs(task.inputs, {})).toThrow(/research: required input missing/)
    expect(() => checkInputs(task.inputs, { research: num })).toThrow(/expected artifact, got value/)
    expect(() => checkInputs(task.inputs, { research: report, maxRequirements: { kind: 'value', value: 0 } })).toThrow(/maxRequirements/)
    expect(() => checkInputs(task.inputs, { research: report, nope: num })).toThrow(/not an input/)
    expect(() => checkInputs(task.inputs, { research: report, repository: repo })).not.toThrow()
    expect(() => checkInputs(task.inputs, { research: { ...report, ref: { ...(report as { ref: object }).ref, kind: 'ProductRequirement' } } as RuntimeValue })).toThrow(/expected ResearchReport/)
  })

  it('checks outputs exactly', () => {
    const prd: RuntimeValue = { kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'checkout-v2', revision: 3 } }
    expect(() => checkOutputs(task.outputs, { prd })).not.toThrow()
    expect(() => checkOutputs(task.outputs, {})).toThrow(/prd: output missing/)
    expect(() => checkOutputs(task.outputs, { prd, extra: num })).toThrow(/not an output/)
    const validationResult = { kind: 'value' as const, schema: { $ref: 'persimmon.ai/v1#/ValidationResult' } }
    expect(() => checkOutputs({ result: { type: validationResult } }, { result: validation })).not.toThrow()
    expect(() => checkOutputs({ result: { type: validationResult } }, { result: num })).toThrow(/result:/)
  })
})

describe('bindings', () => {
  const bindings = example('ports-bindings') as Binding[]
  const gateResult = { kind: 'value' as const, schema: { $ref: 'persimmon.ai/v1#/GateResult' } }
  const site = siteOf({
    inputs: { maxRounds: { type: { kind: 'value', schema: { type: 'integer' } } }, research: task.inputs.research! },
    steps: { review: { result: { type: gateResult } }, research: { report: task.outputs.prd! } },
    state: { draft: { type: { kind: 'value' } } },
    iterationOutputs: { prd: task.outputs.prd! },
  })
  const sources = {
    inputs: { maxRounds: { kind: 'value' as const, value: 3 }, research: report },
    steps: { review: { phase: 'Succeeded', outputs: { result: { kind: 'value' as const, value: { passed: true, results: {} } } } }, research: { phase: 'Succeeded', outputs: { report } } },
    iteration: { index: 2, outputs: { prd: report } },
    event: { artifact: { id: 'checkout-v2' }, content: { targetPrd: 'x' } },
  }

  it('evaluates every design Binding shape', () => {
    const out = bind(Object.fromEntries(bindings.map((b, i) => [`p${i}`, b])), sources, site)
    expect(out).toEqual({
      p0: { kind: 'value', value: 12 },
      p1: report,
      p2: report,
      // p3 fromState draft: state absent, onMissing omit
      p4: report,
      p5: { kind: 'value', value: true },
      p6: { kind: 'value', value: { id: 'checkout-v2' } },
      p7: { kind: 'value', value: 'x' },
    })
  })

  it('an absent source without onMissing is an error; an unfinished step is absent', () => {
    expect(() => bind({ x: { fromState: 'draft' } }, sources, site)).toThrow(/x: source absent/)
    expect(bind({ x: { fromStep: { stepRef: 'review', output: 'result' }, onMissing: 'omit' } }, { steps: {} }, site)).toEqual({})
  })

  it('type-checks expressions against the site', () => {
    expect(site.check('steps.review.outputs.result.passed && inputs.maxRounds > 1')).toBe('bool')
    expect(site.check('inputs.research.revision + 1')).toBe('int')
    expect(() => site.check('steps.review.outputs.result.nope')).toThrow(ExpressionError)
    expect(() => site.check('inputs.maxRounds + "x"')).toThrow(ExpressionError)
    expect(site.check('iteration.index >= inputs.maxRounds')).toBe('bool')
  })
})
