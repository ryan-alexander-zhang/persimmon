// The event storming grammar against the two example models ported from the old tool, and
// one hand-built model per error code. The fixtures are in the old file format, which still
// carried `meta.createdAt`; the DSL here dropped it, so the tests strip it.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'
import { check, checkDerived } from '../../tools/eventstorming/grammar/index.mjs'

const fixture = (name: string): Record<string, unknown> => {
  const model = JSON.parse(readFileSync(join(import.meta.dirname, name), 'utf8'))
  delete model.meta.createdAt
  return model
}

const model = (over: Record<string, unknown>): Record<string, unknown> => ({
  version: '4.0',
  meta: { name: 'Test', level: 'design' },
  contexts: [],
  contextRelationships: [],
  nodes: [],
  edges: [],
  ...over,
})
const node = (id: string, type: string, extra: Record<string, unknown> = {}) => ({ id, type, label: id, properties: {}, ...extra })
const edge = (id: string, source: string, target: string, relation: string) => ({ id, source, target, relation })

const codes = (content: unknown): string[] => check(content).map((f) => f.code)
const errorCodes = (content: unknown): string[] =>
  check(content).filter((f) => f.severity === 'error').map((f) => f.code)

describe('the ported example models', () => {
  it('cargo shipping has no errors and one open-hotspots note', () => {
    const findings = check(fixture('cargo-shipping-event-storming.json'))
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(findings.map((f) => f.code)).toEqual(['open-hotspots'])
  })

  it('ride hailing has no errors, three reaction cycles and one open-hotspots note', () => {
    const findings = check(fixture('ride-hailing-event-storming.json'))
    expect(findings.filter((f) => f.severity === 'error')).toEqual([])
    expect(findings.map((f) => f.code)).toEqual(['reaction-cycle', 'reaction-cycle', 'reaction-cycle', 'open-hotspots'])
  })
})

describe('every error code fires', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['duplicate-id', model({ nodes: [node('a', 'actor'), node('a', 'actor')] })],
    ['undeclared-context', model({ nodes: [node('a', 'actor', { context: 'nope' })] })],
    [
      'self-relationship',
      model({
        contexts: [{ id: 'c', name: 'C', order: 0 }],
        contextRelationships: [{ id: 'cr-1', source: 'c', target: 'c', type: 'partnership' }],
      }),
    ],
    ['not-at-level', model({ meta: { name: 'Test', level: 'big-picture' }, nodes: [node('c1', 'command')] })],
    ['order-not-on-event', model({ nodes: [node('c1', 'command', { order: 0 })] })],
    ['property-not-on-type', model({ nodes: [node('c1', 'command', { properties: { pivotal: true } })] })],
    ['edge-endpoint-missing', model({ nodes: [node('a', 'actor')], edges: [edge('e1', 'a', 'gone', 'issues')] })],
    [
      'illegal-connection',
      model({
        nodes: [node('a', 'actor'), node('ev', 'domainEvent', { order: 0 })],
        edges: [edge('e1', 'a', 'ev', 'produces')],
      }),
    ],
    [
      'wrong-relation',
      model({
        nodes: [node('c1', 'command'), node('ev', 'domainEvent', { order: 0 })],
        edges: [edge('e1', 'c1', 'ev', 'handledBy')],
      }),
    ],
    ['bad-parameters', model({ nodes: [node('p', 'policy', { properties: { parameters: [{ name: 'n', value: 3 }] } })] })],
    ['bad-enum', model({ nodes: [node('h', 'hotspot', { properties: { priority: 'urgent' } })] })],
  ]

  it.each(cases)('%s', (code, content) => {
    expect(errorCodes(content)).toContain(code)
  })

  it('not-a-model', () => {
    expect(check(null)).toEqual([{ severity: 'error', code: 'not-a-model', message: 'content is not a DSL 4.0 model' }])
    expect(codes({ version: '3.0' })).toEqual(['not-a-model'])
    expect(codes(model({ nodes: 'nope' }))).toEqual(['not-a-model'])
    expect(codes(model({ nodes: ['nope'] }))).toEqual(['not-a-model'])
  })
})

describe('the model smells', () => {
  it('reports a reaction cycle', () => {
    const content = model({
      nodes: [
        node('ev', 'domainEvent', { order: 0, properties: { pivotal: true } }),
        node('p', 'policy', { properties: { execution: 'automatic' } }),
        node('c1', 'command'),
      ],
      edges: [edge('e1', 'ev', 'p', 'triggers'), edge('e2', 'p', 'c1', 'invokes'), edge('e3', 'c1', 'ev', 'produces')],
    })
    expect(codes(content)).toContain('reaction-cycle')
  })

  it('reports an alternative set with one member', () => {
    const content = model({
      nodes: [node('ev', 'domainEvent', { order: 0, properties: { pivotal: true, alternativeSet: 'charge-outcome' } })],
    })
    expect(codes(content)).toContain('lone-alternative')
  })

  it('reports an aggregate handling more than five commands', () => {
    const commands = [1, 2, 3, 4, 5, 6].map((i) => node(`c${i}`, 'command'))
    const content = model({
      nodes: [node('ag', 'aggregate'), ...commands],
      edges: commands.map((c, i) => edge(`e${i}`, c.id, 'ag', 'handledBy')),
    })
    expect(codes(content)).toContain('overloaded-aggregate')
  })

  it.each([
    ['design', 'error'],
    ['process', 'warning'],
  ])('a policy without execution at level %s is an %s', (level, severity) => {
    const content = model({
      meta: { name: 'Test', level },
      nodes: [node('ev', 'domainEvent', { order: 0, properties: { pivotal: true } }), node('p', 'policy'), node('c1', 'command')],
      edges: [edge('e1', 'ev', 'p', 'triggers'), edge('e2', 'p', 'c1', 'invokes')],
    })
    expect(check(content)).toContainEqual(expect.objectContaining({ severity, code: 'policy-without-execution' }))
  })

  it('exempts a temporal event from orphan-event', () => {
    const content = model({
      nodes: [
        node('ev-time', 'domainEvent', { order: 0, properties: { temporal: true, pivotal: true } }),
        node('ev-plain', 'domainEvent', { order: 1 }),
      ],
    })
    const orphans = check(content).filter((f) => f.code === 'orphan-event')
    expect(orphans).toHaveLength(1)
    expect(orphans[0]?.message).toContain('ev-plain')
  })
})

// Every warning code the ported example models never hit, pinned against the old validator's output on the same model.
describe('a smelly model', () => {
  const smelly = {"version": "4.0", "meta": {"name": "Smelly", "level": "design"}, "contexts": [{"id": "c", "name": "C", "order": 0, "classification": "core"}, {"id": "empty", "name": "Empty", "order": 1, "classification": "supporting"}], "contextRelationships": [], "nodes": [{"id": "c-e-noorder", "type": "domainEvent", "label": "No Order Happened", "context": "c", "properties": {}}, {"id": "c-e-orphan", "type": "domainEvent", "label": "Orphan Happened", "context": "c", "order": 0, "properties": {}}, {"id": "c-c-dangling", "type": "command", "label": "Dangle", "context": "c", "properties": {}}, {"id": "c-c-unissued", "type": "command", "label": "Unissued", "context": "c", "properties": {}}, {"id": "c-e-made", "type": "domainEvent", "label": "Made", "context": "c", "order": 1, "properties": {}}, {"id": "c-p-idle", "type": "policy", "label": "Idle Policy", "context": "c", "properties": {"execution": "automatic"}}, {"id": "c-p-noexec", "type": "policy", "label": "No Exec Policy", "context": "c", "properties": {}}, {"id": "c-c-invoked", "type": "command", "label": "Invoked", "context": "c", "properties": {}}, {"id": "c-e-done", "type": "domainEvent", "label": "Done", "context": "c", "order": 2, "properties": {}}, {"id": "c-actor", "type": "actor", "label": "Someone", "context": "c", "properties": {}}, {"id": "c-h-closed", "type": "hotspot", "label": "Closed without why?", "context": "c", "properties": {"state": "resolved"}}], "edges": [{"id": "e-1", "source": "c-c-unissued", "target": "c-e-made", "relation": "produces"}, {"id": "e-2", "source": "c-actor", "target": "c-c-dangling", "relation": "issues"}, {"id": "e-3", "source": "c-e-made", "target": "c-p-noexec", "relation": "triggers"}, {"id": "e-4", "source": "c-p-noexec", "target": "c-c-invoked", "relation": "invokes"}, {"id": "e-5", "source": "c-c-invoked", "target": "c-e-done", "relation": "produces"}, {"id": "e-6", "source": "c-c-invoked", "target": "c-e-done", "relation": "produces"}, {"id": "e-7", "source": "c-h-closed", "target": "c-e-done", "relation": "annotates"}]}
  it('reports the twelve findings validate.py reports, and nothing else', () => {
    expect(check(smelly).map((f) => [f.severity, f.code])).toEqual([
      ['error', 'policy-without-execution'], // the model is at design: see 'the model smells'
      ['warning', 'dangling-command'],
      ['warning', 'duplicate-edge'],
      ['warning', 'empty-context'],
      ['warning', 'event-without-order'],
      ['warning', 'idle-policy'],
      ['warning', 'no-pivotal-event'],
      ['warning', 'orphan-event'],
      ['warning', 'orphan-event'],
      ['warning', 'unissued-command'],
      ['warning', 'unrecorded-resolution'],
      ['warning', 'untriggered-policy'],
    ])
  })
  it.each([
    ['meta.level', model({ meta: { name: 'Test', level: 'sketch' } })],
    ['classification', model({ contexts: [{ id: 'c', name: 'C', order: 0, classification: 'vital' }] })],
    ['contextRelationship type', model({ contexts: [{ id: 'c', name: 'C', order: 0 }, { id: 'd', name: 'D', order: 1 }], contextRelationships: [{ id: 'cr-1', source: 'c', target: 'd', type: 'friends' }] })],
  ])('bad-enum on %s', (_what, content) => {
    expect(errorCodes(content)).toContain('bad-enum')
  })
})

// A DomainModel against the storming it claims: the matching pair is silent, and every code fires on one mutation.
describe('checkDerived', () => {
  const storming = model({
    meta: { name: 'Claims', level: 'design' },
    contexts: [{ id: 'c', name: 'C', order: 0 }],
    nodes: [
      node('ag', 'aggregate', { label: 'Claim', context: 'c' }),
      node('c1', 'command', { label: 'Submit Claim', context: 'c' }),
      node('c2', 'command', { label: 'Approve Claim', context: 'c' }),
      node('e1', 'domainEvent', { label: 'Claim Submitted', context: 'c', order: 0, properties: { pivotal: true } }),
      node('e2', 'domainEvent', { label: 'Claim Approved', context: 'c', order: 1 }),
      node('k', 'constraint', { label: 'One line', context: 'c', properties: { rule: 'A claim has at least one line' } }),
      node('p', 'policy', { label: 'Approve On Submit', context: 'c', properties: { execution: 'automatic', condition: 'amount > 0' } }),
      node('rm', 'readModel', { label: 'Claim List', context: 'c' }),
      node('ac', 'actor', { label: 'Adjuster', context: 'c' }),
      node('ex', 'externalSystem', { label: 'Payments', context: 'c' }),
    ],
    edges: [
      edge('x1', 'c1', 'ag', 'handledBy'),
      edge('x2', 'c2', 'ag', 'handledBy'),
      edge('x3', 'ag', 'e1', 'emits'),
      edge('x4', 'ag', 'e2', 'emits'),
      edge('x5', 'c1', 'k', 'constrainedBy'),
      edge('x6', 'e1', 'p', 'triggers'),
      edge('x7', 'p', 'c2', 'invokes'),
      edge('x8', 'e1', 'rm', 'updates'),
      edge('x9', 'rm', 'ac', 'informs'),
      edge('x10', 'ex', 'c1', 'issues'),
    ],
  })
  const derived = {
    context: 'bc-claims',
    source: 'es-claims',
    aggregates: [
      {
        id: 'AG-1',
        name: 'Claim',
        root: 'Claim',
        entities: [{ name: 'Claim', attributes: ['claim id'] }],
        valueObjects: [],
        commands: ['Submit Claim', 'Approve Claim'],
        events: ['Claim Submitted', 'Claim Approved'],
        invariants: [{ statement: 'A claim has at least one line' }],
      },
    ],
    events: [{ name: 'Claim Submitted', pivotal: true }, { name: 'Claim Approved' }],
    policies: [{ id: 'POL-1', name: 'Approve On Submit', when: ['Claim Submitted'], then: ['Approve Claim'], condition: 'amount > 0', execution: 'automatic' }],
    readModels: [{ name: 'Claim List', informs: ['Adjuster'], updatedBy: ['Claim Submitted'], fields: ['claim id'] }],
    externalSystems: [{ name: 'Payments', issues: ['Submit Claim'] }],
  }
  type Derived = typeof derived
  const mutate = (change: (d: any) => void): Derived => {
    const copy = structuredClone(derived)
    change(copy)
    return copy
  }

  it('is silent on the model the storming describes', () => {
    expect(checkDerived(storming, derived, 'c')).toEqual([])
  })

  it('refuses a call with no context: the domain model own context is a BoundedContext id, not a storming one', () => {
    // the signature says required; a JS caller can still leave it out
    expect(checkDerived(storming, derived, undefined as unknown as string)).toEqual([
      { severity: 'error', code: 'derived-unknown-context', message: 'no context given - name the storming context this domain model projects' },
    ])
  })

  it('leaves out an external system no edge of which reaches into the context, whatever context it carries', () => {
    const idle = { ...storming, nodes: [...(storming.nodes as Record<string, unknown>[]), node('ex2', 'externalSystem', { label: 'Archive', context: 'c' })] }
    expect(checkDerived(idle, derived, 'c')).toEqual([])
  })

  const cases: [string, Record<string, unknown>, Derived, string | undefined][] = [
    ['derived-source-level', model({ ...storming, meta: { name: 'Claims', level: 'process' } }), derived, 'c'],
    ['derived-unknown-context', storming, derived, 'nope'],
    ['derived-missing-aggregate', storming, mutate((d) => (d.aggregates = [])), 'c'],
    ['derived-extra-aggregate', storming, mutate((d) => d.aggregates.push({ ...d.aggregates[0], id: 'AG-2', name: 'Ghost' })), 'c'],
    ['derived-command-mismatch', storming, mutate((d) => (d.aggregates[0].commands = ['Submit Claim'])), 'c'],
    ['derived-event-mismatch', storming, mutate((d) => d.aggregates[0].events.push('Claim Paid')), 'c'],
    ['derived-missing-event', storming, mutate((d) => (d.events = d.events.slice(0, 1))), 'c'],
    ['derived-extra-event', storming, mutate((d) => d.events.push({ name: 'Claim Paid' })), 'c'],
    ['derived-event-flag', storming, mutate((d) => (d.events[0].pivotal = false)), 'c'],
    ['derived-policy-mismatch', storming, mutate((d) => (d.policies[0].execution = 'manual')), 'c'],
    ['derived-readmodel-mismatch', storming, mutate((d) => (d.readModels[0].informs = ['Nobody'])), 'c'],
    ['derived-external-mismatch', storming, mutate((d) => (d.externalSystems[0].issues = [])), 'c'],
    ['derived-invariant-unsourced', storming, mutate((d) => (d.aggregates[0].invariants = [{ statement: 'Something else' }])), 'c'],
    ['derived-unused-constraint', storming, mutate((d) => (d.aggregates[0].invariants = [])), 'c'],
  ]

  it.each(cases)('%s', (code, source, domainModel, context) => {
    expect(checkDerived(source, domainModel, context).map((f) => f.code)).toContain(code)
  })

  // The branches the codes above share: each compared field gets its own failing mutation.
  const reachingIn = {
    ...storming,
    contexts: [...(storming.contexts as Record<string, unknown>[]), { id: 'other', name: 'Other', order: 1 }],
    nodes: [...(storming.nodes as Record<string, unknown>[]), node('ex2', 'externalSystem', { label: 'Bank', context: 'other' })],
    edges: [...(storming.edges as Record<string, unknown>[]), edge('x11', 'ex2', 'c1', 'issues')],
  }
  const fields: [string, Record<string, unknown>, Derived][] = [
    ['policy when', storming, mutate((d) => (d.policies[0].when = ['Claim Approved']))],
    ['policy then', storming, mutate((d) => (d.policies[0].then = []))],
    ['policy parameters', storming, mutate((d) => (d.policies[0].parameters = [{ name: 'limit', value: '10' }]))],
    ['read model updatedBy', storming, mutate((d) => (d.readModels[0].updatedBy = ['Claim Approved']))],
    ['external system handles', storming, mutate((d) => (d.externalSystems[0].handles = ['Submit Claim']))],
    ['external system emits', storming, mutate((d) => (d.externalSystems[0].emits = ['Claim Submitted']))],
    ['an external system of another context reaching into this one', reachingIn, derived],
  ]

  it.each(fields)('fails on %s', (_what, source, domainModel) => {
    expect(checkDerived(source, domainModel, 'c').filter((f) => f.severity === 'error')).not.toEqual([])
  })
})

// The design example's pair is the derivation's worked case (26-domain-discovery.md): the model is clean and the
// DomainModel agrees with it, so a schema or rule change that breaks either shows here.
describe('the design example', () => {
  const docs = parseAllDocuments(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'design', 'examples', 'ai-native-domain.yaml'), 'utf8')).map((d) => d.toJS() as { kind: string; spec: { identity: { revision: number }; content: unknown } })
  const model = docs.find((d) => d.kind === 'EventStorming' && d.spec.identity.revision === 2)!.spec.content
  const domainModel = docs.find((d) => d.kind === 'DomainModel')!.spec.content
  it('expense-claims-storming r2 has no error and expenses-model agrees with it', () => {
    expect(check(model).filter((f) => f.severity === 'error')).toEqual([])
    expect(checkDerived(model, domainModel, 'exp')).toEqual([])
  })
})
