import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdapterRegistry } from '../../adapter/registry.js'
import type { Context, ReconcileInput, ReconcileResult } from '../../handler/types.js'
import { KindRegistry } from '../../kind-definition/registry.js'
import type { Action, Event } from '../../reconcile/types.js'
import { validator as schemaOf } from '../../resource/ajv.js'
import type { Resource } from '../../resource/types.js'
import type { Closure } from '../../snapshot/walk.js'
import type { HandlerDeps } from '../deps.js'
import { gateHandler, toValidationResult, validatorHandler } from './handler.js'
import type { GateRun, ValidationRun } from './types.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const base = example('snapshot-closure') as Closure
const reviewReportKd = { ...example('kind-definition-researchreport'), metadata: { name: 'reviewreports.engineering.persimmon.ai' }, spec: { ...example('kind-definition-researchreport').spec, names: { kind: 'ReviewReport', plural: 'reviewreports' } } }
const closure: Closure = {
  ...base,
  resources: [...base.resources.map((r) => (r.metadata.name === 'productrequirements.engineering.persimmon.ai' ? example('kind-definition-productrequirement') : r)), example('gate-prd-approval'), example('validator-cel'), example('validator-task'), example('validator-evaluator'), example('task-approve-prd'), example('executor-product-reviewers'), reviewReportKd],
}
const prdInstance = example('revisioned-instance') as Resource
const prdRef = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'checkout-v2', revision: 3 }
const clean = (x: unknown) => JSON.parse(JSON.stringify(x))

const deps = (): HandlerDeps => {
  const kinds = new KindRegistry()
  const adapters = new AdapterRegistry({ resolve: () => undefined })
  adapters.register(example('adapter-threat-model'))
  adapters.register(example('adapter-review-ui'))
  return { kinds, adapters, now: () => new Date('2026-09-21T12:30:00Z'), closure: () => closure, callback: (_t, name) => (name === 'getArtifact' ? prdInstance : undefined), getResource: () => undefined, getByUid: () => undefined, random: () => 0 }
}
const input = (r: Resource, event: Omit<Event, 'sequence'>, children: Context['children'] = []): ReconcileInput => ({ resource: r, event: { sequence: 1, ...event } as Event, context: { children, timers: [] }, engine: { endpoint: 'x', token: 't' } })
const created = (res: ReconcileResult) => res.actions.filter((a): a is Extract<Action, { type: 'createResource' }> => a.type === 'createResource').map((a) => a.resource)

describe('gate Handler', () => {
  let handler: ReturnType<typeof gateHandler>
  beforeEach(() => {
    handler = gateHandler(deps())
  })
  const gateRun = (): GateRun => {
    const r = example('run-gaterun') as GateRun
    return { ...r, status: undefined } as unknown as GateRun
  }

  it('creates one ValidationRun per validator, named and addressed like the design example', () => {
    const r = gateRun()
    const res = handler.reconcile(input(r as unknown as Resource, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(res.statusPatch).validationRuns).toEqual(example('run-gaterun').status.validationRuns)
    const runs = created(res)
    expect(runs.map((x) => x.metadata.name)).toEqual(Object.values(example('run-gaterun').status.validationRuns).map((v) => (v as { name: string }).name))
    const human = runs[1]!
    const want = example('run-validationrun')
    expect(human.spec).toEqual({ ...want.spec, deadline: '2026-09-23T12:30:00Z' })
    expect(schemaOf('runs.yaml', '/$defs/ValidationRun')({ ...human, metadata: { ...human.metadata } })).toBe(true)
    expect(res.actions.at(-1)).toEqual({ type: 'setTimer', key: 'deadline', at: r.spec.deadline })
  })

  it('applies quorum after every child finished and reproduces the design GateResult', () => {
    const want = example('run-gaterun')
    let r = gateRun()
    r = { ...r, status: { phase: 'Running', validationRuns: want.status.validationRuns } }
    const results = want.status.outputs.result.value.results as Record<string, unknown>
    const children: Context['children'] = Object.entries(want.status.validationRuns as Record<string, { name: string }>).map(([name, ref]) => ({ ref: ref as never, terminal: true, status: { phase: 'Succeeded', result: results[name] } }))
    const partial = handler.reconcile(input(r as unknown as Resource, { type: 'ChildFinished', dedupeKey: 'c', payload: { ref: { ...children[0]!.ref, uid: 'u' }, value: 'Succeeded' } }, [children[0]!, { ...children[1]!, terminal: false, status: { phase: 'Running' } }, children[2]!])) as ReconcileResult
    expect(partial).toEqual({ actions: [] })
    const res = handler.reconcile(input(r as unknown as Resource, { type: 'ChildFinished', dedupeKey: 'c', payload: { ref: { ...children[1]!.ref, uid: 'u' }, value: 'Succeeded' } }, children)) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: want.status.outputs })
    const failed = handler.reconcile(input(r as unknown as Resource, { type: 'ChildFinished', dedupeKey: 'c', payload: { ref: { ...children[2]!.ref, uid: 'u' }, value: 'Failed' } }, [children[0]!, { ...children[1]!, terminal: false }, { ...children[2]!, status: { phase: 'Failed', error: { code: 'timeout', message: 't', retryable: true } } }])) as ReconcileResult
    expect(clean(failed.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'timeout' } })
    expect(failed.actions.filter((a) => a.type === 'cancelResource')).toHaveLength(1)
  })

  // after (14-gate.md): humanReview waits for structure; it starts when structure passes, is skipped when it does not
  it('starts a validator with after once its predecessors pass, and skips it when one does not', () => {
    const ordered: Closure = { ...closure, resources: closure.resources.map((x) => (x.kind === 'Gate' ? { ...x, spec: { ...x.spec, validators: (x.spec as { validators: { name: string }[] }).validators.map((v) => (v.name === 'humanReview' ? { ...v, after: ['structure'] } : v)) } } : x)) }
    const h = gateHandler({ ...deps(), closure: () => ordered })
    const want = example('run-gaterun')
    const runs = want.status.validationRuns as Record<string, { name: string }>
    const first = h.reconcile(input(gateRun() as unknown as Resource, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(Object.keys(clean(first.statusPatch).validationRuns)).toEqual(['structure', 'security']) // humanReview waits
    const misbound: Closure = { ...ordered, resources: ordered.resources.map((x) => (x.kind === 'Gate' ? { ...x, spec: { ...x.spec, validators: (x.spec as { validators: { name: string; inputs?: unknown }[] }).validators.map((v) => (v.name === 'humanReview' ? { ...v, inputs: {} } : v)) } } : x)) }
    const bad = gateHandler({ ...deps(), closure: () => misbound }).reconcile(input(gateRun() as unknown as Resource, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(bad.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'invalid_input' } }) // bound at Created though it would start later
    const r = { ...gateRun(), status: { phase: 'Running', validationRuns: { structure: runs.structure, security: runs.security } } }
    const child = (name: string, passed: boolean) => ({ ref: runs[name] as never, terminal: true, status: { phase: 'Succeeded', result: { passed, findings: [], evidence: [] } } })
    const finished = (name: string) => ({ type: 'ChildFinished', dedupeKey: 'c', payload: { ref: { ...runs[name], uid: 'u' }, value: 'Succeeded' } })
    const go = h.reconcile(input(r as unknown as Resource, finished('structure'), [child('structure', true), { ...child('security', true), terminal: false, status: { phase: 'Running' } }])) as ReconcileResult
    expect(created(go).map((x) => x.metadata.name)).toEqual([runs.humanReview!.name]) // started now
    expect(Object.keys(clean(go.statusPatch).validationRuns)).toEqual(['structure', 'security', 'humanReview'])
    const skipped = h.reconcile(input(r as unknown as Resource, finished('security'), [child('structure', false), child('security', true)])) as ReconcileResult
    expect(created(skipped)).toEqual([])
    expect(clean(skipped.statusPatch)).toMatchObject({ phase: 'Succeeded', outputs: { result: { value: { passed: false, results: { humanReview: { passed: false, findings: [{ severity: 'info', code: 'skipped', message: 'not run: structure did not pass' }] } } } } } }) // quorum 2: a skipped one never passes
  })

  it('validate checks bindings, duplicates and quorum', () => {
    const d = deps()
    const validators: Record<string, unknown> = { 'prd-structure': example('validator-cel'), 'prd-human-review': example('validator-task'), 'prd-security-scan': example('validator-evaluator') }
    d.getResource = (kind, _ns, name) => (kind === 'Validator' ? (validators[name] as Resource | undefined) : undefined)
    const h = gateHandler(d)
    expect(h.validate(example('gate-prd-approval')).findings).toEqual([])
    const g = example('gate-prd-approval')
    g.spec.validators[0].inputs = { prd: { fromInput: 'security' } }
    g.spec.policy = { strategy: 'quorum', count: 9 }
    g.spec.validators[1].name = 'structure'
    expect(h.validate(g).findings.map((f) => f.message)).toEqual(['producer type differs from consumer type', 'optional Gate input security feeds a required input without a default', 'required input minRequirements unbound', 'duplicate validator structure', 'quorum count 9 > 3 validators'])
    const later = example('gate-prd-approval')
    later.spec.validators[0].after = ['security']
    later.spec.validators[1].after = ['humanReview']
    expect(h.validate(later).findings.map((f) => f.message)).toEqual(['security is not an earlier validator of this Gate', 'humanReview is not an earlier validator of this Gate']) // later, or itself
    const any = example('gate-prd-approval')
    any.spec.policy = { strategy: 'any' }
    any.spec.validators[1].after = ['structure']
    expect(h.validate(any).findings.map((f) => f.code)).toEqual(['after_any'])
  })
})

describe('validator Handler', () => {
  let handler: ReturnType<typeof validatorHandler>
  beforeEach(() => {
    handler = validatorHandler(deps())
  })
  const vrun = (validator: string, name: string): ValidationRun => {
    const r = example('run-validationrun') as ValidationRun
    return { ...r, status: undefined, spec: { ...r.spec, validatorRef: { kind: 'Validator', name: validator }, name, inputs: { ...r.spec.inputs, ...(validator === 'prd-structure' ? { minRequirements: { kind: 'value', value: 2 } } : {}) } } } as unknown as ValidationRun
  }

  it('toValidationResult accepts booleans and full results only', () => {
    expect(toValidationResult(true)).toEqual({ passed: true, findings: [], evidence: [] })
    expect(toValidationResult({ passed: false, findings: [], evidence: [], score: 0.2 })).toBeDefined()
    expect(toValidationResult({ passed: 'yes' })).toBeUndefined()
  })

  it('cel: evaluates against the frozen content in one reconcile', () => {
    const r = vrun('prd-structure', 'structure')
    const res = handler.reconcile(input(r as unknown as Resource, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Succeeded', result: { passed: true, findings: [], evidence: [prdRef] } })
    const strict = { ...r, spec: { ...r.spec, inputs: { ...r.spec.inputs, minRequirements: { kind: 'value', value: 5 } } } }
    const fail = handler.reconcile(input(strict as unknown as Resource, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(fail.statusPatch)).toMatchObject({ phase: 'Succeeded', result: { passed: false, findings: [{ code: 'too_few' }] } })
  })

  it('cel: an artifacts port is a list of {content, provenance}, typed as such', () => {
    const many = { ...example('validator-cel'), metadata: { name: 'prd-pair', namespace: 'demo' } }
    many.spec.inputs = { prds: { type: { kind: 'artifacts', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } } }
    many.spec.evaluator.expression = 'artifacts.prds.size() == 2 && artifacts.prds.all(p, p.content.title == "Checkout v2")'
    handler = validatorHandler({ ...deps(), closure: () => ({ ...closure, resources: [...closure.resources, many] }) })
    const r = { ...vrun('prd-structure', 'structure'), spec: { ...vrun('prd-structure', 'structure').spec, validatorRef: { kind: 'Validator', name: 'prd-pair' }, inputs: { prds: { kind: 'artifacts', refs: [prdRef, { ...prdRef, revision: 2 }] } } } }
    const res = handler.reconcile(input(r as unknown as Resource, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    expect(clean(res.statusPatch)).toMatchObject({ phase: 'Succeeded', result: { passed: true } })
    const typo = { ...many, spec: { ...many.spec, evaluator: { type: 'cel', expression: 'artifacts.prds.content.title == "x"' } } }
    expect(handler.validate(typo as unknown as Resource).findings.map((f) => f.code)).toEqual(['invalid_expression']) // a list has no content field
  })

  it('task: creates the TaskRun and reads the result output', () => {
    const r = vrun('prd-human-review', 'humanReview')
    const res = handler.reconcile(input(r as unknown as Resource, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    const [task] = created(res)
    expect(task!.kind).toBe('TaskRun')
    expect(task!.metadata.name).toBe(example('run-validationrun').status.taskRunRef.name)
    expect(task!.spec).toMatchObject({ taskRef: { kind: 'Task', name: 'approve-prd' }, address: r.spec.address, deadline: r.spec.deadline, inputs: r.spec.inputs })
    expect(clean(res.statusPatch)).toEqual({ phase: 'Running', taskRunRef: example('run-validationrun').status.taskRunRef })
    const running = { ...r, status: clean(res.statusPatch) }
    const ref = example('run-validationrun').status.taskRunRef
    const fin = handler.reconcile(input(running as unknown as Resource, { type: 'ChildFinished', dedupeKey: 'c', payload: { ref: { ...ref, uid: 'u' }, value: 'Succeeded' } }, [{ ref, terminal: true, status: { phase: 'Succeeded', outputs: { result: { kind: 'value', value: { passed: true, findings: [], evidence: [] } } } } }])) as ReconcileResult
    expect(clean(fin.statusPatch)).toMatchObject({ phase: 'Succeeded', result: { passed: true } })
  })

  it('adapter: calls evaluate with the payload of 19-adapter-roles.md', () => {
    const r = vrun('prd-security-scan', 'security')
    const res = handler.reconcile(input(r as unknown as Resource, { type: 'Created', dedupeKey: 'created' })) as ReconcileResult
    const call = res.actions[0] as { op: string; adapterId: string; payload: Record<string, unknown> }
    expect(call).toMatchObject({ op: 'evaluate', adapterId: 'threat-model/v1' })
    expect(schemaOf('adapter-roles.yaml', '/$defs/EvaluatePayload')({ ...call.payload, engine: { endpoint: 'unix://x', token: 't' } })).toBe(true)
    expect((call.payload.artifacts as Record<string, { content: { title: string } }>).prd.content.title).toBe('Checkout v2')
    const fin = handler.reconcile(input({ ...r, status: { phase: 'Running' } } as unknown as Resource, { type: 'AdapterFinished', dedupeKey: 'a', payload: { idempotencyKey: 'k', state: 'succeeded', result: { passed: false, findings: [], evidence: [] } } })) as ReconcileResult
    expect(clean(fin.statusPatch)).toMatchObject({ phase: 'Succeeded', result: { passed: false } })
    const bad = handler.reconcile(input({ ...r, status: { phase: 'Running' } } as unknown as Resource, { type: 'AdapterFinished', dedupeKey: 'a', payload: { idempotencyKey: 'k', state: 'succeeded', result: { nope: 1 } } })) as ReconcileResult
    expect(clean(bad.statusPatch)).toMatchObject({ phase: 'Failed', error: { code: 'schema_violation' } })
  })
})
