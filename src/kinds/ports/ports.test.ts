import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import { ExpressionError } from '../../expression/site.js'
import { bind, checkInputs, checkOutputs, expandSchema, inlineSchema, optional, overrideFindings, PortError, requiredFindings, sameType, siteOf, unwrap } from './ports.js'
import type { Binding, InputSpec, OutputSpec, RuntimeValue } from './types.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const task = example('ports-task') as { inputs: Record<string, InputSpec>; outputs: Record<string, OutputSpec> }
const values = example('ports-runtime-values') as RuntimeValue[]
const [num, validation, report, many, repo] = values as [RuntimeValue, RuntimeValue, RuntimeValue, RuntimeValue, RuntimeValue]

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
    // a port schema's own $defs resolve against the port schema, not the design files; $defs are dropped once inlined
    const local = inlineSchema({ type: 'object', properties: { a: { $ref: '#/$defs/x' }, b: { $ref: '#/$defs/loop' } }, $defs: { x: { type: 'string' }, loop: { type: 'array', items: { $ref: '#/$defs/loop' } } } } as never) as Record<string, any>
    expect(local.properties.a).toEqual({ type: 'string' })
    expect(local.properties.b).toEqual({ type: 'array', items: {} })
    expect(local).not.toHaveProperty('$defs')
    expect(() => inlineSchema({ $ref: 'persimmon.ai/v1#/Nope' })).toThrow(PortError)
  })

  it('an override keeps the Global ports: same names, same types, no input turned optional', () => {
    const g = example('pack-task-global')
    const o = example('pack-task-override')
    const lookup = (kind: string, ns: string | undefined, name: string) => (kind === 'Task' && !ns && name === g.metadata.name ? g : undefined)
    expect(overrideFindings(lookup, o)).toEqual([])
    const bad = structuredClone(o)
    bad.spec.outputs.report.type.artifactKind.kind = 'ReviewReport'
    bad.spec.inputs.repository.required = false
    bad.spec.inputs.extra = { type: { kind: 'value', schema: { type: 'string' } } }
    expect(overrideFindings(lookup, bad).map((f) => f.message).sort()).toEqual(['override inputs.extra is not a port of the Global definition', 'override inputs.repository changes whether the input is required', 'override outputs.report has a different type'])
    const stricter = structuredClone(o)
    stricter.spec.inputs.repository.required = true
    const g2 = structuredClone(g)
    g2.spec.inputs.repository.required = false
    expect(overrideFindings(() => g2, stricter).map((f) => f.message)).toEqual(['override inputs.repository changes whether the input is required'])
    expect(overrideFindings(lookup, g)).toEqual([]) // Global itself
    const g3 = structuredClone(g)
    g3.spec.inputs.repository.required = { expression: 'inputs.maxRequirements > 3' }
    const same = structuredClone(o)
    same.spec.inputs.repository.required = { expression: 'inputs.maxRequirements > 3' }
    expect(overrideFindings(() => g3, same)).toEqual([]) // the expression compares by value
    expect(overrideFindings(() => g3, o).map((f) => f.message)).toEqual(['override inputs.repository changes whether the input is required'])
  })

  it('a required expression decides at bind from the inputs present, and type-checks as bool statically', () => {
    const inputs: Record<string, InputSpec> = { type: { type: { kind: 'value', schema: { type: 'string' } } }, research: { ...task.inputs.research!, required: { expression: "inputs.type != 'ui'" } }, repository: { ...task.inputs.repository!, required: { expression: "inputs.type == 'ui' && !has(inputs.research)" } } }
    const ui = { kind: 'value', value: 'ui' } as RuntimeValue
    const api = { kind: 'value', value: 'http-api' } as RuntimeValue
    expect(() => checkInputs(inputs, { type: api })).toThrow(/research: required input missing \(inputs.type != 'ui'\)/)
    expect(checkInputs(inputs, { type: api, research: report })).toEqual({ type: api, research: report })
    expect(() => checkInputs(inputs, { type: ui })).toThrow(/repository: required input missing/)
    expect(checkInputs(inputs, { type: ui, repository: repo })).toEqual({ type: ui, repository: repo })
    expect([optional(inputs.research!), optional(inputs.type!), optional({ ...inputs.type!, required: false })]).toEqual([true, false, true])
    expect(() => checkInputs({ ...inputs, type: { ...inputs.type!, required: { expression: 'inputs.research == null' } } }, {})).toThrow(/type: required expression: /) // a CEL error is a bind error, not a crash
    expect(() => checkInputs({ designs: { ...inputs.repository!, required: { expression: "inputs.type == 'ui'" } }, type: inputs.type! }, {})).toThrow(/type: required input missing$/) // the plain port first, whatever the order
    expect(requiredFindings(inputs)).toEqual([])
    const bad = { ...inputs, research: { ...inputs.research!, required: { expression: 'inputs.nope == 1' } }, repository: { ...inputs.repository!, required: { expression: 'inputs.type' } } }
    expect(requiredFindings(bad).map((f) => [f.path, f.message.split(':')[0], f.message.includes('not bool')])).toEqual([['/spec/inputs/research/required', 'research', false], ['/spec/inputs/repository/required', 'repository', true]])
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
    // an artifacts port: every ref of the kind, in order; CEL sees the list of refs
    const reports: Record<string, InputSpec> = { reports: { type: { kind: 'artifacts', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport' } } } }
    expect(checkInputs(reports, { reports: many })).toEqual({ reports: many })
    expect(() => checkInputs(reports, { reports: report })).toThrow(/expected artifacts, got artifact/)
    expect(() => checkInputs(reports, { reports: { kind: 'artifacts', refs: [(report as { ref: never }).ref, { ...(report as { ref: object }).ref, kind: 'ProductRequirement' } as never] } })).toThrow(/expected ResearchReport, got ProductRequirement/)
    expect(unwrap({ reports: many })).toEqual({ reports: (many as { refs: unknown }).refs })
    expect(() => siteOf({ inputs: reports }).check('inputs.reports[1].revision == 2')).not.toThrow()
  })

  it('checks outputs exactly', () => {
    const prd: RuntimeValue = { kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'checkout-v2', revision: 3 } }
    expect(() => checkOutputs(task.outputs, { prd })).not.toThrow()
    expect(() => checkOutputs(task.outputs, {})).toThrow(/prd: output missing/)
    expect(() => checkOutputs(task.outputs, { prd, extra: num })).toThrow(/not an output/)
    const validationResult = { kind: 'value' as const, schema: { $ref: 'persimmon.ai/v1#/ValidationResult' } }
    expect(() => checkOutputs({ result: { type: validationResult } }, { result: validation })).not.toThrow()
    expect(() => checkOutputs({ result: { type: validationResult } }, { result: num })).toThrow(/result:/)
    const nested = { kind: 'value' as const, schema: { allOf: [{ $ref: 'persimmon.ai/v1#/ValidationResult' }, { properties: { passed: { const: true } } }] } }
    expect(() => checkOutputs({ result: { type: nested } }, { result: validation })).not.toThrow() // a well-known $ref below the top resolves too
    expect(() => checkOutputs({ result: { type: nested } }, { result: { kind: 'value', value: { passed: true } } })).toThrow(/result:/)
  })
})

describe('bindings', () => {
  const bindings = example('ports-bindings') as Binding[]
  const gateResult = { kind: 'value' as const, schema: { $ref: 'persimmon.ai/v1#/GateResult' } }
  const site = siteOf({
    inputs: { maxRounds: { type: { kind: 'value', schema: { type: 'integer' } } }, research: task.inputs.research!, prd: task.outputs.prd! },
    steps: { review: { result: { type: gateResult } }, research: { report: task.outputs.prd! } },
    state: { draft: { type: { kind: 'value' } } },
    iterationOutputs: { prd: task.outputs.prd! },
  })
  const sources = {
    inputs: { maxRounds: { kind: 'value' as const, value: 3 }, research: report, prd: { kind: 'artifact' as const, ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'checkout-v2', revision: 1 } } },
    steps: { review: { phase: 'Succeeded', outputs: { result: { kind: 'value' as const, value: { passed: true, results: {} } } } }, research: { phase: 'Succeeded', outputs: { report } } },
    iteration: { index: 2, outputs: { prd: report } },
    event: { artifact: { id: 'checkout-v2' }, content: { targetPrd: 'x' } },
    latest: (kind: { kind: string }, id: string) => (id === 'checkout-v2' ? { apiVersion: 'engineering.persimmon.ai/v1', kind: kind.kind, namespace: 'demo', id, revision: 3 } : undefined),
  }

  it('steps.<id>.iterations is typed at the site and read from a finished repeat step', () => {
    const rounds = { ...sources, steps: { ...sources.steps, review: { ...sources.steps.review, iterations: 3 } } }
    expect(bind({ n: { expression: 'steps.review.iterations' } }, rounds, site)).toEqual({ n: { kind: 'value', value: 3 } })
    expect(bind({ ok: { expression: 'steps.review.iterations >= inputs.maxRounds' } }, rounds, site)).toEqual({ ok: { kind: 'value', value: true } })
  })

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
      p8: { kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'checkout-v2', revision: 3 } }, // the latest revision, not the input's r1
      p9: report, // first: the state is absent, the research report is the first source present
    })
    // first with no source present is absent, as one Binding is
    expect(() => bind({ x: { first: [{ fromState: 'draft' }, { fromStep: { stepRef: 'gone', output: 'report' } }] } }, sources, site)).toThrow(/x: source absent/)
    expect(bind({ x: { first: [{ fromState: 'draft' }, { fromStep: { stepRef: 'gone', output: 'report' } }], onMissing: 'omit' } }, sources, site)).toEqual({})
    // no revision of that id: absent; no lookup at the site: absent; an id that is no string: an error
    const gone = { fromArtifact: { kind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' }, id: '"nope"' } }
    expect(() => bind({ x: gone }, sources, site)).toThrow(/x: source absent/)
    expect(bind({ x: { ...gone, onMissing: 'omit' } }, sources, site)).toEqual({})
    expect(() => bind({ x: { fromArtifact: { ...gone.fromArtifact, id: '"checkout-v2"' } } }, { ...sources, latest: undefined }, site)).toThrow(/x: source absent/)
    expect(() => bind({ x: { fromArtifact: { ...gone.fromArtifact, id: 'inputs.maxRounds' } } }, sources, site)).toThrow(/fromArtifact: id 3 is not a string/)
  })

  it('fromQuery binds every latest revision its where holds for, by id; none is an empty list; a where that throws or answers no bool fails the bind', () => {
    const kind = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' }
    const rev = (id: string, revision: number, content: unknown) => ({ ref: { ...kind, namespace: 'demo', id, revision }, content })
    const found = [rev('a', 2, { owner: 'checkout-v2', flag: true, n: 1, share: 0.5 }), rev('b', 1, { owner: 'other' }), rev('c', 4, { owner: 'checkout-v2', flag: false, n: 3, share: 1.5 })]
    const s = { ...sources, query: () => found }
    const q = (where: string) => ({ x: { fromQuery: { kind, where } } })
    expect(bind(q('content.owner == inputs.prd.id'), s, site)).toEqual({ x: { kind: 'artifacts', refs: [found[0]!.ref, found[2]!.ref] } }) // `content` beside the site's own roots
    expect(bind(q('content.owner == "nobody"'), s, site)).toEqual({ x: { kind: 'artifacts', refs: [] } }) // an answer, not an absence
    expect(bind(q('has(content.flag) && content.flag'), s, site)).toEqual({ x: { kind: 'artifacts', refs: [found[0]!.ref] } }) // an optional field guarded
    expect(bind(q('has(content.n) && content.n + 1 == 2 && content.n < inputs.maxRounds && content.share < 1.0'), s, site)).toEqual({ x: { kind: 'artifacts', refs: [found[0]!.ref] } }) // a whole number is an int, as an integer port's: arithmetic with int literals and int inputs
    expect(() => bind(q('content.flag'), s, site)).toThrow(/fromQuery: ProductRequirement\/b\.r1: /) // unguarded: the revision named, never a shorter list
    expect(() => bind(q('content.owner'), s, site)).toThrow(/fromQuery: ProductRequirement\/a\.r2: where answered "checkout-v2", not a bool/)
    expect(() => bind(q('true'), sources, site)).toThrow(/x: source absent/) // no store at the site
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
