import { readdirSync, readFileSync } from 'node:fs'
import { parse, parseAllDocuments } from 'yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import schemas from '../generated/schemas.json' with { type: 'json' }
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
    expect(() => reg.register(narrowed, { replace: true, committed: () => [{ ...stored, metadata: { ...stored.metadata, namespace: 'other' } }] })).toThrow(/ProductRequirement\/other\/.* fails the new schema/)
    expect(() => reg.register(narrowed, { replace: true, committed: () => [] })).not.toThrow() // a fresh project
    const reshaped = kd()
    reshaped.spec.snapshotOnCreate = true
    expect(() => reg.register(reshaped, { replace: true, committed: () => [] })).toThrow(/changes in versions\[\].schema only/)
    const rebumped = kd()
    rebumped.spec.versions[0].name = 'v2' // a renamed version: the same definition by name, so the same rule
    expect(() => reg.register(rebumped, { replace: true, committed: () => [] })).toThrow(/changes in versions\[\].schema only/)
    const replural = kd() // a new plural is a new definition name owning the same kind: the prior would be missed, so it is refused by the kind
    replural.spec.names.plural = 'prodreqs'
    replural.metadata.name = `prodreqs.${replural.spec.group}`
    replural.spec.versions[0].schema.required = [...replural.spec.versions[0].schema.required, 'tagline']
    expect(() => reg.register(replural, { replace: true, committed: () => [stored] })).toThrow(/ProductRequirement is defined by productrequirements/)
    replural.spec.versions[0].name = 'v2' // a new version name beside the new plural: no key in common, the same kind
    expect(() => reg.register(replural, { replace: true, committed: () => [stored] })).toThrow(/ProductRequirement is defined by productrequirements/)
    const takeover = example('kind-definition-researchreport') // a non-revisioned kind cannot be taken over under another name either
    takeover.spec.names.plural = 'reports'
    takeover.metadata.name = `reports.${takeover.spec.group}`
    expect(() => reg.register(takeover, { replace: true })).toThrow(/ResearchReport is defined by researchreports/)
  })

  it('a version schema with an $id is refused: one ajv holds every kind', () => {
    const live = example('kind-definition-productrequirement')
    live.spec.versions[0].schema.$id = 'https://example.test/prd'
    expect(() => new KindRegistry().register(live)).toThrow(/carries no \$id/)
    const nested = example('kind-definition-productrequirement')
    nested.spec.versions[0].schema.$defs = { t: { $id: 'https://example.test/t', type: 'string' } }
    expect(() => new KindRegistry().register(nested)).toThrow(/carries no \$id, at any depth/)
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

describe('the SDLC pack Design kind', () => {
  const packKinds = parseAllDocuments(readFileSync('packs/sdlc/global/10-artifact-kinds.yaml', 'utf8')).map((d) => d.toJS())
  const design = () => structuredClone(parseAllDocuments(readFileSync('examples/example07/room-booking-domain.yaml', 'utf8')).map((d) => d.toJS()).find((d) => d.kind === 'Design' && d.spec.content.references))

  it('references[] is the ExternalResourceRef of resource.yaml, inlined (29-design-process.md); a malformed one is refused', () => {
    const inlined = packKinds.find((k) => k.metadata.name === 'designs.sdd.persimmon.ai').spec.versions[0].schema.properties.references.items
    const strip = (s: unknown): unknown => (Array.isArray(s) ? s.map(strip) : s && typeof s === 'object' ? Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'description').map(([k, v]) => [k, strip(v)])) : s)
    expect(strip(inlined)).toEqual(schemas['resource.yaml'].$defs.ExternalResourceRef)
    const reg = new KindRegistry()
    for (const k of packKinds) reg.register(k)
    const ok = design()
    ok.metadata.namespace = 'demo' // the example file carries none; apply stamps the default Namespace
    expect(() => reg.validateResource(ok)).not.toThrow()
    const bad = structuredClone(ok)
    delete bad.spec.content.references[0].provider
    expect(() => reg.validateResource(bad)).toThrow(/\/references\/0 must have required property 'provider'/)
  })

  it('a quality scenario names its method and provenAt; a build one is a test or a fitness one (35-build-process.md)', () => {
    const reg = new KindRegistry()
    for (const k of packKinds) reg.register(k)
    const architecture = parseAllDocuments(readFileSync('examples/example07/room-booking-domain.yaml', 'utf8')).map((d) => d.toJS()).find((d) => d.kind === 'Architecture')
    architecture.metadata.namespace = 'demo'
    expect(() => reg.validateResource(architecture)).not.toThrow()
    const load = structuredClone(architecture)
    load.spec.content.qualityScenarios[0].method = 'load'
    expect(() => reg.validateResource(load)).toThrow(/qualityScenarios\/0\/method must be equal to one of the allowed values/)
    load.spec.content.qualityScenarios[0].provenAt = 'release'
    expect(() => reg.validateResource(load)).not.toThrow()
    delete load.spec.content.qualityScenarios[0].provenAt
    expect(() => reg.validateResource(load)).toThrow(/qualityScenarios\/0 must have required property 'provenAt'/)
  })

  it('a TestOutcome names its level and selection; a none one ran nothing and has no output tail (36-test-levels.md)', () => {
    const reg = new KindRegistry()
    for (const k of packKinds) reg.register(k)
    const outcome = (content: Record<string, unknown>) => ({ apiVersion: 'sdd.persimmon.ai/v1', kind: 'TestOutcome', metadata: { name: 'p-t-1-tests.r1', namespace: 'demo' }, spec: { identity: { id: 'p-t-1-tests', revision: 1 }, content: { command: ['npm', 'test'], exitCode: 0, ...content } } })
    const ran = { tests: [{ classname: 'a', name: 'b', status: 'passed' }], level: 'unit', selection: { mode: 'affected', reason: 'src/claim.ts' }, newRed: 0, coverage: { min: 90, covered: 9, total: 10, uncovered: [{ file: 'src/claim.ts', lines: '12' }] }, mutation: { min: 90, killed: 9, survived: 1, noCoverage: 0, timeout: 0, score: 90, survivors: [{ file: 'src/claim.ts', line: 12, mutator: 'EqualityOperator' }] } }
    expect(() => reg.validateResource(outcome(ran))).not.toThrow()
    expect(() => reg.validateResource(outcome({ tests: [], level: 'e2e', selection: { mode: 'none', reason: 'untouched' } }))).not.toThrow()
    expect(() => reg.validateResource(outcome({ tests: [], level: 'e2e', selection: { mode: 'none', reason: 'untouched' }, outputTail: 'x' }))).toThrow(/must NOT be valid/)
    expect(() => reg.validateResource(outcome({ tests: [], selection: { mode: 'full', reason: 'no baseline' } }))).toThrow(/must have required property 'outputTail'/)
    expect(() => reg.validateResource(outcome({ ...ran, level: 'smoke' }))).toThrow(/level must be equal to one of the allowed values/)
  })

  it('a record row names a unit test by its name and another level\'s test with the level (36-test-levels.md)', () => {
    const reg = new KindRegistry()
    for (const k of packKinds) reg.register(k)
    const record = (tests: unknown[]) => ({ apiVersion: 'sdd.persimmon.ai/v1', kind: 'AcceptanceRecord', metadata: { name: 'p-t-1.r1', namespace: 'demo' }, spec: { identity: { id: 'p-t-1', revision: 1 }, content: { plan: 'p', spec: 's', task: 'T-1', verifies: [{ scenario: 'AC-1', tests }], summary: 'x', openQuestions: [] } } })
    expect(() => reg.validateResource(record(['claim > ac 1', { name: 'submit a claim', level: 'api' }]))).not.toThrow()
    expect(() => reg.validateResource(record([{ name: 'submit a claim' }]))).toThrow(/must match a schema in anyOf/)
  })
})
