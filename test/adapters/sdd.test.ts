// The evaluator Adapter over stdio (19-adapter-roles.md): the Spec of the worked example against the artifacts it
// cites (23-pack-ai-native.md), and one mutation per finding code.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const docs = parseAllDocuments(readFileSync(join(root, 'docs/design/examples/ai-native-domain.yaml'), 'utf8')).map((d) => d.toJS())
const content = (kind: string) => docs.find((d) => d.kind === kind).spec.content
const example = () => ({ spec: content('Spec'), prd: content('Prd'), domainModel: content('DomainModel'), architecture: content('Architecture'), rules: content('BusinessRules') })

const provenance = { producerRef: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', name: 'sdd-001' }, inputs: [], actor: { kind: 'handler', id: 'test' } }
const payload = (artifacts: Record<string, unknown>) => ({
  validationRun: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'ValidationRun', name: 'sdd-001' }, logicalExecutionId: 'sdd-001//spec', idempotencyKey: 'sdd-001//spec/1' },
  validator: { configuration: {} },
  inputs: {},
  artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, c]) => [name, { content: c, provenance }])),
  deadline: new Date(Date.now() + 60_000).toISOString(),
  engine: { endpoint: 'unix:///nowhere.sock', token: 'ct-1' },
})

function adapter(req: unknown) {
  return new Promise<{ ok: boolean; result?: any; error?: any }>((resolve) => {
    const child = spawn(process.execPath, [join(root, 'adapters', 'sdd', 'index.mjs')])
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => process.stderr.write(c))
    child.on('close', () => resolve(JSON.parse(out.trim().split('\n').at(-1)!)))
    child.stdin.end(JSON.stringify(req) + '\n')
  })
}

let id = 0
const codes = async (mutate: (a: ReturnType<typeof example>) => void) => {
  const artifacts = structuredClone(example())
  mutate(artifacts)
  const r = await adapter({ id: ++id, op: 'evaluate', payload: payload(artifacts) })
  expect(r.result.passed).toBe(false)
  return r.result.findings.map((f: { code: string }) => f.code)
}

describe('sdd/v1', () => {
  it('describes the evaluator Role', async () => {
    const d = await adapter({ id: 1000, op: 'describe', payload: {} })
    expect(d).toEqual({ id: 1000, ok: true, result: { adapterId: 'sdd/v1', protocol: 'persimmon.adapter/v1', roles: ['evaluator'], configurationSchema: { type: 'object', additionalProperties: false, properties: {} } } })
  })

  it('passes the worked example: the Spec of CAP-1 against the artifacts it cites', async () => {
    const r = await adapter({ id: 1001, op: 'evaluate', payload: payload(example()) })
    expect(r).toEqual({ id: 1001, ok: true, result: { passed: true, findings: [], evidence: [] } })
  })

  it('fails content that is not a Spec, and reports nothing else', async () => {
    const r = await adapter({ id: 1002, op: 'evaluate', payload: payload({ spec: { title: 'not a Spec' } }) })
    expect(r.result).toEqual({ passed: false, findings: [{ severity: 'error', code: 'not-a-spec', message: 'content is not a Spec: it has no stories array, no requirements array or no capability' }], evidence: [] })
    const strung = await adapter({ id: 1007, op: 'evaluate', payload: payload({ ...example(), spec: { ...example().spec, requirements: 'none' } }) })
    expect(strung.result.findings.map((f: { code: string }) => f.code)).toEqual(['not-a-spec'])
  })

  it('fails a capability the Prd does not have', async () => {
    expect(await codes((a) => { a.spec.capability = 'CAP-9' })).toEqual(['unknown-capability'])
  })


  it('fails a role who is not a Prd user', async () => {
    expect(await codes((a) => { a.spec.stories[0].role = 'intern' })).toEqual(['unknown-role'])
  })

  it('fails a command, an event and a read model the DomainModel does not name', async () => {
    expect(await codes((a) => {
      a.spec.stories[0].commands[0] = 'Ghost Claim'
      a.spec.stories[0].events[0] = 'Claim Ghosted'
      a.spec.stories[2].readModels[0] = 'Ghost View'
    })).toEqual(['unknown-command', 'unknown-event', 'unknown-read-model'])
  })

  it("accepts another context's event that updates a read model", async () => {
    const artifacts = structuredClone(example())
    artifacts.spec.stories[2].events.push('Claim Paid')
    const r = await adapter({ id: ++id, op: 'evaluate', payload: payload(artifacts) })
    expect(r.result).toEqual({ passed: true, findings: [], evidence: [] })
  })

  it('fails a quality scenario the Architecture does not have', async () => {
    expect(await codes((a) => { a.spec.qualities[1].scenario = 'QS-9' })).toEqual(['unknown-scenario'])
  })

  it('fails a rule that does not resolve, and one that is not active', async () => {
    expect(await codes((a) => { a.spec.requirements[4].rules = ['BR-99'] })).toEqual(['unknown-rule'])
    expect(await codes((a) => { a.spec.requirements[4].rules = ['BR-6'] })).toEqual(['inactive-rule'])
  })

  it('fails a requirement a story cites but the Spec lacks, and one no story covers', async () => {
    expect(await codes((a) => { a.spec.stories[2].requirements = ['FR-9'] })).toEqual(['unknown-requirement', 'requirement-uncovered'])
  })

  it('fails a rule that governs the capability but no requirement enforces', async () => {
    expect(await codes((a) => { a.prd.capabilities[0].rules.push('BR-1') })).toEqual(['rule-unenforced'])
  })

  it('fails a statement that does not open with its pattern keyword', async () => {
    expect(await codes((a) => { a.spec.requirements[0].pattern = 'ubiquitous' })).toEqual(['pattern-mismatch'])
    // complex wants two of while/when/if before shall; the one-clause statement has only its own When
    expect(await codes((a) => { a.spec.requirements[0].pattern = 'complex' })).toEqual(['pattern-mismatch'])
    const ok = structuredClone(example())
    ok.spec.requirements[0].pattern = 'complex'
    ok.spec.requirements[0].statement = 'When the employee drafts a claim, if the claim line has a receipt, the system shall show it.'
    const r = await adapter({ id: 1003, op: 'evaluate', payload: payload(ok) })
    expect(r.result).toEqual({ passed: true, findings: [], evidence: [] })
  })

  it('fails ids that are not sequential from 1 in document order', async () => {
    expect(await codes((a) => { a.spec.requirements[5].id = 'FR-7' })).toEqual(['unknown-requirement', 'requirement-uncovered']) // a gap is allowed: a removed item
    expect(await codes((a) => { a.spec.requirements[5].id = 'FR-2' })).toEqual(['unknown-requirement', 'id-sequence']) // FR-2 twice: the second is not above FR-5
    expect(await codes((a) => { a.spec.stories[1].id = 'US-5' })).toEqual(['id-sequence'])
    expect(await codes((a) => { a.spec.stories[1].acceptance[0].id = 'AC-1' })).toEqual(['id-sequence']) // AC-n runs across stories: the second story's first criterion is AC-4
    expect(await codes((a) => { a.spec.openQuestions[0].id = 'Q-2' })).toEqual(['id-sequence']) // Q-2, Q-2, Q-3: the duplicate is the second
  })

  it('is invalid_input without a required artifact and on an unknown op', async () => {
    const { rules, ...rest } = example()
    const missing = await adapter({ id: 1004, op: 'evaluate', payload: payload(rest) })
    expect(missing).toEqual({ id: 1004, ok: false, error: { code: 'invalid_input', message: 'artifacts.rules is required', retryable: false } })
    const noSpec = await adapter({ id: 1005, op: 'evaluate', payload: { ...payload(example()), artifacts: {} } })
    expect(noSpec).toEqual({ id: 1005, ok: false, error: { code: 'invalid_input', message: 'artifacts.spec or artifacts.prd is required', retryable: false } })
    const unknown = await adapter({ id: 1006, op: 'nonsense', payload: {} })
    expect(unknown).toMatchObject({ id: 1006, ok: false, error: { code: 'invalid_input', retryable: false } })
  })
})

describe('sdd/v1 over a Prd', () => {
  const prdExample = () => ({ prd: content('Prd'), rules: content('BusinessRules') })
  const prdCodes = async (mutate: (a: ReturnType<typeof prdExample>) => void) => {
    const artifacts = structuredClone(prdExample())
    mutate(artifacts)
    const r = await adapter({ id: ++id, op: 'evaluate', payload: payload(artifacts) })
    expect(r.result.passed).toBe(false)
    return r.result.findings.map((f: { code: string }) => f.code)
  }

  it('passes the worked example: the Prd against the BusinessRules of its context', async () => {
    const r = await adapter({ id: 2001, op: 'evaluate', payload: payload(prdExample()) })
    expect(r).toEqual({ id: 2001, ok: true, result: { passed: true, findings: [], evidence: [] } })
  })

  it('fails content that is not a Prd, and reports nothing else', async () => {
    const r = await adapter({ id: 2002, op: 'evaluate', payload: payload({ prd: { title: 'not a Prd' } }) })
    expect(r.result).toEqual({ passed: false, findings: [{ severity: 'error', code: 'not-a-prd', message: 'content is not a Prd: it has no capabilities array or no title' }], evidence: [] })
    expect(await prdCodes((a) => { delete (a.prd as any).title })).toEqual(['not-a-prd'])
  })

  it('fails a rule that does not resolve, and one that is not active', async () => {
    expect(await prdCodes((a) => { a.prd.capabilities[0].rules = ['BR-99'] })).toEqual(['unknown-rule'])
    expect(await prdCodes((a) => { a.prd.capabilities[0].rules = ['BR-6'] })).toEqual(['inactive-rule'])
  })

  it('fails a capability in another context than the BusinessRules', async () => {
    expect(await prdCodes((a) => { a.prd.capabilities[1].context = 'payments' })).toEqual(['context-mismatch'])
  })

  it('fails a success criterion citing a capability the Prd does not have', async () => {
    expect(await prdCodes((a) => { a.prd.successCriteria[1].capabilities = ['CAP-9'] })).toEqual(['unknown-capability'])
  })

  it('fails a goal with a number', async () => {
    expect(await prdCodes((a) => { a.prd.goals[0].statement = 'An employee gets a decision on a claim within 5 days.' })).toEqual(['goal-with-number'])
  })

  it('fails ids that are not sequential from 1 in document order', async () => {
    expect(await prdCodes((a) => { a.prd.goals[1].id = 'G-3' })).toEqual(['id-sequence']) // G-1, G-3, G-3
    expect(await prdCodes((a) => { a.prd.capabilities[3].id = 'CAP-5' })).toEqual(['unknown-capability']) // SC-3 still cites CAP-4; the gap itself is allowed
    expect(await prdCodes((a) => { a.prd.capabilities[3].id = 'CAP-2' })).toEqual(['unknown-capability', 'id-sequence'])
    expect(await prdCodes((a) => { a.rules.rules[5].id = 'BR-2' })).toEqual(['id-sequence']) // the rules artifact is written here too; BR-6 is cited by nothing
    expect(await prdCodes((a) => { a.prd.successCriteria[0].id = 'SC-0' })).toEqual(['id-sequence'])
    expect(await prdCodes((a) => { a.prd.openQuestions[1].id = 'Q-1' })).toEqual(['id-sequence'])
  })

  it('is invalid_input without the BusinessRules beside a Prd', async () => {
    const r = await adapter({ id: 2003, op: 'evaluate', payload: payload({ prd: content('Prd') }) })
    expect(r).toEqual({ id: 2003, ok: false, error: { code: 'invalid_input', message: 'artifacts.rules is required', retryable: false } })
  })
})
