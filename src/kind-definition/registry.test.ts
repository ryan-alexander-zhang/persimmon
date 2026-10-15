import { readdirSync, readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import { KindError, KindRegistry, validateKindDefinition } from './registry.js'

const dir = 'docs/design/examples'
const example = (name: string) => parse(readFileSync(`${dir}/${name}.yaml`, 'utf8'))
const kindExamples = readdirSync(dir).filter((f) => f.startsWith('kind-definition-')).map((f) => f.slice(0, -5))

describe('validateKindDefinition', () => {
  it.each(kindExamples)('accepts %s', (n) => {
    expect(validateKindDefinition(example(n)).kind).toBe('KindDefinition')
  })

  it('rejects a name that is not plural.group', () => {
    const kd = example('kind-definition-workflow')
    kd.metadata.name = 'workflow.persimmon.ai'
    expect(() => validateKindDefinition(kd)).toThrow(/metadata.name must be workflows.persimmon.ai/)
  })

  it('rejects duplicate version names', () => {
    const kd = example('kind-definition-workflow')
    kd.spec.versions.push(kd.spec.versions[0])
    expect(() => validateKindDefinition(kd)).toThrow(/not unique/)
  })

  it('rejects a namespace on a KindDefinition', () => {
    const kd = example('kind-definition-workflow')
    kd.metadata.namespace = 'demo'
    expect(() => validateKindDefinition(kd)).toThrow(KindError)
  })

  it('rejects revisioned with SpecMutable', () => {
    const kd = example('kind-definition-productrequirement')
    kd.spec.mutability = 'SpecMutable'
    expect(() => validateKindDefinition(kd)).toThrow(KindError)
  })
})

describe('KindRegistry', () => {
  let reg: KindRegistry
  beforeEach(() => {
    reg = new KindRegistry()
    for (const n of kindExamples) reg.register(example(n))
  })

  it('looks up a kind by apiVersion and kind', () => {
    expect(reg.get('persimmon.ai/v1', 'WorkflowRun').definition.metadata.name).toBe('workflowruns.persimmon.ai')
    expect(reg.lookup('persimmon.ai/v1', 'Nope')).toBeUndefined()
  })

  it('rejects a second registration of the same kind', () => {
    expect(() => reg.register(example('kind-definition-workflow'))).toThrow(/already registered/)
  })

  it('a revisioned kind changes in versions[].schema only, and only where every committed revision still validates', () => {
    const kd = () => example('kind-definition-productrequirement')
    const stored = example('revisioned-instance')
    const widened = kd()
    widened.spec.versions[0].schema.properties.tagline = { type: 'string' }
    expect(() => reg.register(widened, { replace: true })).toThrow(/changes in versions\[\].schema only/) // no committed revisions to check: never
    expect(() => reg.register(widened, { replace: true, committed: () => [stored] })).not.toThrow()
    const narrowed = kd()
    narrowed.spec.versions[0].schema.required = [...narrowed.spec.versions[0].schema.required, 'tagline']
    expect(() => reg.register(narrowed, { replace: true, committed: () => [stored] })).toThrow(/ProductRequirement\/.* fails the new schema: .*tagline/)
    expect(() => reg.register(narrowed, { replace: true, committed: () => [] })).not.toThrow() // a fresh project
    const renamed = kd()
    renamed.spec.snapshotOnCreate = true
    expect(() => reg.register(renamed, { replace: true, committed: () => [] })).toThrow(/changes in versions\[\].schema only/)
  })

  it('validates a WorkflowRun spec and status', () => {
    expect(() => reg.validateResource(example('resource-namespaced'))).not.toThrow()
  })

  it('validates spec.content of a revisioned kind', () => {
    const r = example('revisioned-instance')
    expect(() => reg.validateResource(r)).not.toThrow()
    delete r.spec.content.title
    expect(() => reg.validateResource(r)).toThrow(/spec: .*title/)
  })

  it('rejects a bad status phase', () => {
    const r = example('resource-namespaced')
    r.status.phase = 'Done'
    expect(() => reg.validateResource(r)).toThrow(/status: /)
  })

  it('rejects a Namespaced Resource without a namespace', () => {
    const r = example('resource-namespaced')
    delete r.metadata.namespace
    expect(() => reg.validateResource(r)).toThrow(/namespace required/)
  })

  it('rejects an unregistered kind', () => {
    expect(() => reg.validateResource({ ...example('resource-namespaced'), kind: 'Nope' })).toThrow(/unregistered/)
  })

  it('freezes spec on an Immutable kind', () => {
    const a = example('resource-namespaced')
    const b = structuredClone(a)
    b.spec.timeout = '1h'
    expect(() => reg.checkMutability(a, b)).toThrow(/Immutable/)
    expect(() => reg.checkMutability(a, structuredClone(a))).not.toThrow()
  })

  it('allows spec change on a SpecMutable kind', () => {
    const a = { apiVersion: 'persimmon.ai/v1', kind: 'Trigger', metadata: { name: 't', namespace: 'demo' }, spec: { event: {}, run: {} } }
    const b = { ...a, spec: { ...a.spec, enabled: false } }
    expect(() => reg.checkMutability(a, b)).not.toThrow()
  })
})
