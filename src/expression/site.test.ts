import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { ajv } from '../resource/ajv.js'
import type { JsonSchema } from '../kind-definition/types.js'
import { bindValue, celTypeOf, toJson } from './schema-type.js'
import { ExpressionError, Site } from './site.js'

const example = (name: string) => parse(readFileSync(`docs/design/examples/${name}.yaml`, 'utf8'))
const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({ type: 'object', properties })

describe('celTypeOf', () => {
  it('maps scalar and container types', () => {
    expect(celTypeOf({ type: 'integer' })).toBe('int')
    expect(celTypeOf({ type: 'number' })).toBe('double')
    expect(celTypeOf({ type: 'array', items: { type: 'string' } })).toBe('list<string>')
    expect(celTypeOf({ type: 'object' })).toBe('map')
    expect(celTypeOf(obj({ a: { type: 'boolean' } }))).toEqual({ a: 'bool' })
    expect(celTypeOf({ $ref: 'x' })).toBe('dyn')
  })
})

describe('bindValue / toJson', () => {
  it('turns schema integers into int and back', () => {
    const schema = obj({ n: { type: 'integer' }, xs: { type: 'array', items: { type: 'integer' } }, d: { type: 'number' } })
    const bound = bindValue({ n: 2, xs: [1, 2], d: 2 }, schema) as Record<string, unknown>
    expect(bound.n).toBe(2n)
    expect(bound.xs).toEqual([1n, 2n])
    expect(bound.d).toBe(2)
    expect(toJson(bound)).toEqual({ n: 2, xs: [1, 2], d: 2 })
  })
})

describe('Site', () => {
  const workflowSite = new Site({
    inputs: obj({ maxRounds: { type: 'integer' } }),
    steps: undefined,
    iteration: obj({ index: { type: 'integer' }, outputs: { type: 'object' } }),
  })

  it('evaluates the Workflow binding examples', () => {
    const ctx = {
      inputs: { maxRounds: 3 },
      steps: { review: { outputs: { result: { passed: true } } }, approval: { outputs: { result: { passed: false } } } },
      iteration: { index: 3, outputs: { accepted: false } },
    }
    expect(workflowSite.evaluate('steps.review.outputs.result.passed && inputs.maxRounds > 1', ctx)).toBe(true)
    expect(workflowSite.evaluate('steps.approval.outputs.result.passed', ctx)).toBe(false)
    expect(workflowSite.evaluate('iteration.outputs.accepted || iteration.index >= inputs.maxRounds', ctx)).toBe(true)
  })

  it('does integer arithmetic on integer ports', () => {
    expect(workflowSite.evaluate('inputs.maxRounds + 1', { inputs: { maxRounds: 3 } })).toBe(4)
  })

  it('checks statically', () => {
    expect(workflowSite.check('inputs.maxRounds > 1')).toBe('bool')
    expect(() => workflowSite.check('inputz.maxRounds')).toThrow(ExpressionError)
    expect(() => workflowSite.check('inputs.nope')).toThrow(ExpressionError)
    expect(() => workflowSite.check('inputs.maxRounds + "x"')).toThrow(ExpressionError)
    expect(() => workflowSite.check('inputs.maxRounds >')).toThrow(ExpressionError)
  })

  it('evaluates the cel Validator example to a ValidationResult', () => {
    const v = example('validator-cel')
    const prdSchema = example('kind-definition-productrequirement').spec.versions[0].schema
    const site = new Site({
      inputs: obj({ prd: { type: 'object' }, minRequirements: { type: 'integer' } }),
      artifacts: obj({ prd: obj({ content: prdSchema, provenance: { type: 'object' } }) }),
    })
    const prdRef = example('resource-refs').revisionRef
    const content = example('revisioned-instance').spec.content
    const ctx = { inputs: { prd: prdRef, minRequirements: 2 }, artifacts: { prd: { content, provenance: {} } } }
    expect(site.check(v.spec.evaluator.expression)).toMatch(/^map/)
    expect(site.evaluate(v.spec.evaluator.expression, ctx)).toEqual({ passed: true, findings: [], evidence: [prdRef] })
    ctx.inputs.minRequirements = 5
    expect(site.evaluate(v.spec.evaluator.expression, ctx)).toMatchObject({ passed: false, findings: [{ code: 'too_few' }] })
  })

  it('evaluates a subscription filter over an Outbox event', () => {
    const eventSchema = ajv.getSchema('outbox.yaml#/$defs/OutboxEvent')?.schema as JsonSchema
    const site = new Site({ event: eventSchema })
    const event = example('outbox-events')[1] ?? example('outbox-events')
    const filter = example('kind-definition-trigger').spec.subscriptions[1].filter
    expect(site.check(filter)).toBe('bool')
    expect(site.evaluate(filter, { event })).toBe(event.subject.kind === 'WorkflowRun')
  })
})
