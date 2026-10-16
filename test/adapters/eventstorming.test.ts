// The evaluator Adapter over stdio (19-adapter-roles.md): describe, the grammar's findings, the level gate.
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')

const model = {
  version: '4.0',
  meta: { name: 'x', level: 'big-picture' },
  contexts: [{ id: 'a', name: 'A', order: 0 }],
  contextRelationships: [],
  nodes: [{ id: 'a-e-1', type: 'domainEvent', label: 'Thing Happened', context: 'a', order: 0, properties: { pivotal: true } }],
  edges: [],
}
const provenance = { producerRef: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', name: 'es-001' }, inputs: [], actor: { kind: 'handler', id: 'test' } }
const payload = (content: unknown, configuration: Record<string, unknown> = {}) => ({
  validationRun: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'ValidationRun', name: 'es-001' }, logicalExecutionId: 'es-001//model', idempotencyKey: 'es-001//model/1' },
  validator: { configuration },
  inputs: {},
  artifacts: { model: { content, provenance } },
  deadline: new Date(Date.now() + 60_000).toISOString(),
  engine: { endpoint: 'unix:///nowhere.sock', token: 'ct-1' },
})

function adapter(req: unknown) {
  return new Promise<{ ok: boolean; result?: any; error?: any }>((resolve) => {
    const child = spawn(process.execPath, [join(root, 'adapters', 'eventstorming', 'index.mjs')])
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => process.stderr.write(c))
    child.on('close', () => resolve(JSON.parse(out.trim().split('\n').at(-1)!)))
    child.stdin.end(JSON.stringify(req) + '\n')
  })
}

describe('eventstorming/v1', () => {
  it('describes the evaluator Role', async () => {
    const d = await adapter({ id: 1, op: 'describe', payload: {} })
    expect(d).toEqual({ id: 1, ok: true, result: { adapterId: 'eventstorming/v1', protocol: 'persimmon.adapter/v1', roles: ['evaluator'], configurationSchema: { type: 'object', additionalProperties: false, properties: { level: { enum: ['big-picture', 'process', 'design'] }, failOnWarning: { type: 'boolean' } } } } })
  })

  it('passes a valid big-picture model', async () => {
    const r = await adapter({ id: 2, op: 'evaluate', payload: payload(model) })
    expect(r).toEqual({ id: 2, ok: true, result: { passed: true, findings: [], evidence: [] } })
  })

  it('fails content that is not a model', async () => {
    const r = await adapter({ id: 3, op: 'evaluate', payload: payload({ title: 'not a model' }) })
    expect(r.result.passed).toBe(false)
    expect(r.result.findings.map((f: { code: string }) => f.code)).toEqual(['not-a-model'])
  })

  it('fails a model below the configured level', async () => {
    const r = await adapter({ id: 4, op: 'evaluate', payload: payload(model, { level: 'design' }) })
    expect(r.result.passed).toBe(false)
    expect(r.result.findings).toContainEqual({ severity: 'error', code: 'below-level', message: 'level big-picture is below the required design' })
  })

  it('fails on a warning under failOnWarning, and takes the level from inputs.level first', async () => {
    const smelly = { ...model, nodes: [...model.nodes, { id: 'a-e-2', type: 'domainEvent', label: 'Later Happened', context: 'a', properties: {} }] } // event without order: a warning
    const ok = await adapter({ id: 6, op: 'evaluate', payload: payload(smelly) })
    expect([ok.result.passed, ok.result.findings.map((f: { code: string }) => f.code)]).toEqual([true, ['event-without-order']])
    const strict = await adapter({ id: 7, op: 'evaluate', payload: payload(smelly, { failOnWarning: true }) })
    expect(strict.result.passed).toBe(false)
    const byInput = await adapter({ id: 8, op: 'evaluate', payload: { ...payload(model, { level: 'big-picture' }), inputs: { level: { kind: 'value', value: 'process' } } } })
    expect(byInput.result.findings.map((f: { code: string }) => f.code)).toEqual(['below-level'])
  })

  it('is invalid_input without artifacts.model and on an unknown op', async () => {
    const missing = await adapter({ id: 5, op: 'evaluate', payload: { ...payload(model), artifacts: {} } })
    expect(missing).toEqual({ id: 5, ok: false, error: { code: 'invalid_input', message: 'artifacts.model is required', retryable: false } })
    const unknown = await adapter({ id: 6, op: 'nonsense', payload: {} })
    expect(unknown).toMatchObject({ id: 6, ok: false, error: { code: 'invalid_input', retryable: false } })
  })
})

// The second mode: a DomainModel beside the model is compared against it (26-domain-discovery.md).
describe('eventstorming/v1 beside the Prd', () => {
  it('checks the contexts against the Prd subdomains', async () => {
    const tagged = { ...model, version: '4.1', contexts: [{ id: 'a', name: 'A', order: 0, subdomain: 'payroll' }] }
    const p = payload(tagged)
    ;(p.artifacts as Record<string, unknown>).prd = { content: { subdomains: [{ id: 'expenses', type: 'core' }] }, provenance }
    const r = await adapter({ id: 9, op: 'evaluate', payload: p })
    expect(r.result.passed).toBe(false)
    expect(r.result.findings.map((f: { code: string }) => f.code)).toEqual(['subdomain-unknown'])
  })
})

describe('eventstorming/v1 against a derived DomainModel', () => {
  const storming = {
    version: '4.0',
    meta: { name: 'x', level: 'design' },
    contexts: [{ id: 'a', name: 'A', order: 0 }],
    contextRelationships: [],
    nodes: [
      { id: 'a-ag', type: 'aggregate', label: 'Claim', context: 'a', properties: {} },
      { id: 'a-c', type: 'command', label: 'Submit Claim', context: 'a', properties: {} },
      { id: 'a-e', type: 'domainEvent', label: 'Claim Submitted', context: 'a', order: 0, properties: { pivotal: true } },
    ],
    edges: [
      { id: 'x1', source: 'a-c', target: 'a-ag', relation: 'handledBy' },
      { id: 'x2', source: 'a-ag', target: 'a-e', relation: 'emits' },
    ],
  }
  const derived = {
    context: 'bc-a',
    source: 'es-a',
    aggregates: [{ id: 'AG-1', name: 'Claim', root: 'Claim', entities: [{ name: 'Claim', attributes: ['claim id'] }], valueObjects: [], commands: ['Submit Claim'], events: ['Claim Submitted'], invariants: [] }],
    events: [{ name: 'Claim Submitted', pivotal: true }],
    policies: [],
    readModels: [],
    externalSystems: [],
  }
  const pair = (domainModel: unknown) => ({
    ...payload(storming),
    inputs: { context: { kind: 'value', value: 'a' } },
    artifacts: { model: { content: storming, provenance }, domainModel: { content: domainModel, provenance } },
  })

  it('passes a domain model the storming describes', async () => {
    const r = await adapter({ id: 9, op: 'evaluate', payload: pair(derived) })
    expect(r.result).toEqual({ passed: true, findings: [], evidence: [] })
  })

  it('is invalid_input without inputs.context', async () => {
    const r = await adapter({ id: 11, op: 'evaluate', payload: { ...pair(derived), inputs: {} } })
    expect(r).toEqual({ id: 11, ok: false, error: { code: 'invalid_input', message: 'inputs.context is required beside artifacts.domainModel', retryable: false } })
  })

  it('fails a domain model that names an aggregate the storming does not', async () => {
    const r = await adapter({ id: 10, op: 'evaluate', payload: pair({ ...derived, aggregates: [{ ...derived.aggregates[0], name: 'Ghost' }] }) })
    expect(r.result.passed).toBe(false)
    expect(r.result.findings.map((f: { code: string }) => f.code)).toEqual(['derived-extra-aggregate', 'derived-missing-aggregate'])
  })
})
