// The evaluator Adapter over stdio (19-adapter-roles.md): the Spec of the worked example against the artifacts it
// cites (23-pack-sdlc.md), and one mutation per finding code.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'
import { checkArchitecture, checkDesign } from '../../adapters/sdd/check.mjs'

const root = join(import.meta.dirname, '..', '..')
const docs = parseAllDocuments(readFileSync(join(root, 'docs/design/examples/sdlc-domain.yaml'), 'utf8')).map((d) => d.toJS())
const content = (kind: string) => docs.find((d) => d.kind === kind).spec.content
const example = () => ({ spec: content('Spec'), prd: content('Prd'), domainModel: content('DomainModel'), architecture: content('Architecture'), rules: content('BusinessRules') })

const provenance = { producerRef: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', name: 'sdd-001' }, inputs: [], actor: { kind: 'handler', id: 'test' } }
const payload = (artifacts: Record<string, unknown>) => ({
  validationRun: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'ValidationRun', name: 'sdd-001' }, logicalExecutionId: 'sdd-001//spec', idempotencyKey: 'sdd-001//spec/1' },
  validator: { configuration: {} },
  inputs: { rules: { kind: 'artifact', ref: { apiVersion: 'sdd.persimmon.ai/v1', kind: 'BusinessRules', namespace: 'demo', id: 'expenses-rules', revision: 1 } } }, // what every citing document names in businessRules
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

  it('holds the capability to the BoundedContext bound, and the DomainModel to that context (34-subdomains.md)', async () => {
    const withContext = (mutate: (bc: any, a: ReturnType<typeof example>) => void = () => {}) => {
      const a = structuredClone(example())
      const bc = structuredClone(content('BoundedContext'))
      mutate(bc, a)
      const p = payload({ ...a, context: bc })
      ;(p.inputs as Record<string, unknown>).context = { kind: 'artifact', ref: { apiVersion: 'sdd.persimmon.ai/v1', kind: 'BoundedContext', namespace: 'demo', id: 'expenses', revision: 1 } }
      return p
    }
    expect((await adapter({ id: ++id, op: 'evaluate', payload: withContext() })).result).toEqual({ passed: true, findings: [], evidence: [] })
    const listed = await adapter({ id: ++id, op: 'evaluate', payload: withContext((bc) => (bc.capabilities = bc.capabilities.filter((c: string) => c !== 'CAP-1'))) })
    expect(listed.result.findings.map((f: { code: string }) => f.code)).toEqual(['context-mismatch'])
    const model = await adapter({ id: ++id, op: 'evaluate', payload: withContext((_, a) => (a.domainModel.context = 'payments')) })
    expect(model.result.findings.map((f: { code: string }) => f.code)).toEqual(['context-mismatch'])
 
    // off the engine, a context with no ref: the capability is still held to it, the DomainModel's context is not
    const unref = withContext((_, a) => (a.domainModel.context = 'payments'))
    delete (unref.inputs as Record<string, unknown>).context
    expect((await adapter({ id: ++id, op: 'evaluate', payload: unref })).result).toEqual({ passed: true, findings: [], evidence: [] })
    // the capability written for: a Spec that switched capability is refused
    const switched = withContext()
    ;(switched.inputs as Record<string, unknown>).capabilityId = { kind: 'value', value: 'CAP-4' }
    expect((await adapter({ id: ++id, op: 'evaluate', payload: switched })).result.findings.map((f: { code: string }) => f.code)).toEqual(['capability-mismatch'])
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
    expect(noSpec).toEqual({ id: 1005, ok: false, error: { code: 'invalid_input', message: 'artifacts.spec, artifacts.prd, artifacts.design, artifacts.architecture or artifacts.plan is required', retryable: false } })
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

  it('fails a capability or a rule outside the Prd\'s subdomains', async () => {
    expect(await prdCodes((a) => { a.prd.capabilities[1].subdomain = 'payments' })).toEqual(['subdomain-mismatch'])
    // the Prd names the subdomains (34-subdomains.md): with two every rule is tagged, and a capability cites its own subdomain's rules
    const pay = { id: 'payments', name: 'Payments', description: 'Finance pays the claims.', type: 'supporting' }
    expect(await prdCodes((a) => { a.prd.subdomains.push(pay) })).toEqual(Array(content('BusinessRules').rules.length).fill('subdomain-mismatch')) // every rule untagged
    const two = structuredClone(prdExample())
    two.prd.subdomains.push(pay)
    for (const r of two.rules.rules) r.subdomain = 'expenses'
    expect((await adapter({ id: ++id, op: 'evaluate', payload: payload(two) })).result).toEqual({ passed: true, findings: [], evidence: [] })
    // a rule of the other subdomain: one finding per capability citing it; a tag outside the Prd's: the rule and every citation
    const citing = (r: string) => content('Prd').capabilities.filter((c: { rules?: string[] }) => (c.rules ?? []).includes(r)).length
    expect(await prdCodes((a) => { a.prd.subdomains.push(pay); for (const r of a.rules.rules) r.subdomain = 'expenses'; a.rules.rules[0].subdomain = 'payments' })).toEqual(Array(citing('BR-1')).fill('subdomain-mismatch'))
    expect(await prdCodes((a) => { a.rules.rules[0].subdomain = 'ghost' })).toEqual(Array(1 + citing('BR-1')).fill('subdomain-mismatch'))
    // a duplicate is one finding: it does not make the product one over two subdomains
    expect(await prdCodes((a) => { a.prd.subdomains.push(structuredClone(a.prd.subdomains[0])) })).toEqual(['subdomain-mismatch'])
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
    expect(await prdCodes((a) => { a.rules.rules[10].id = 'BR-2' })).toEqual(['id-sequence']) // the rules artifact is written here too; BR-11 is active and cited by nothing
    expect(await prdCodes((a) => { a.prd.successCriteria[0].id = 'SC-0' })).toEqual(['id-sequence'])
    expect(await prdCodes((a) => { a.prd.openQuestions[1].id = 'Q-1' })).toEqual(['id-sequence'])
  })


  it('refuses a rule changed or dropped since the last round that no finding named', async () => {
    const withPrevious = (mutate: (rules: any) => void, feedback?: unknown) => {
      const a = structuredClone(prdExample()) as any
      a.previousRules = structuredClone(a.rules)
      mutate(a.rules)
      const p = payload(a) as any
      if (feedback) p.inputs = { feedback: { kind: 'value', value: feedback } }
      return adapter({ id: ++id, op: 'evaluate', payload: p }).then((r) => r.result.findings.map((f: { code: string }) => f.code))
    }
    expect(await withPrevious(() => {})).toEqual([]) // unchanged rules
    expect(await withPrevious((r) => { r.rules[0].statement = 'reworded' })).toEqual(['rule-drift'])
    expect(await withPrevious((r) => { r.rules.at(-1).status = 'deprecated' })).toEqual(['rule-drift']) // the last rule is cited by nothing, so only the drift shows
    expect(await withPrevious((r) => { r.rules.push({ ...r.rules[0], id: `BR-${r.rules.length + 1}` }) })).toEqual([]) // a new rule takes the next number
    const named = (id: string) => ({ passed: false, results: { human: { passed: false, findings: [{ severity: 'error', message: `${id}: tighten the wording` }] } } })
    expect(await withPrevious((r) => { r.rules[0].statement = 'reworded' }, named(content('BusinessRules').rules[0].id))).toEqual([]) // the finding asked for it
    expect(await withPrevious((r) => { r.rules[0].statement = 'reworded' }, named('BR-99'))).toEqual(['rule-drift']) // a finding on another rule
    expect(await withPrevious((r) => { r.rules.splice(r.rules.length - 1, 1) })).toEqual(['rule-drift']) // dropped; the last rule is cited by nothing, so only the drift shows
    const refused = (id: string) => ({ passed: false, results: { consistency: { passed: false, findings: [{ severity: 'error', code: 'rule-drift', message: `${id} changed unasked: no finding of the last round names it` }] } } })
    expect(await withPrevious((r) => { r.rules[0].statement = 'reworded' }, refused(content('BusinessRules').rules[0].id))).toEqual(['rule-drift']) // the gate's own refusal does not license the drift next round
  })

  it('is invalid_input without the BusinessRules beside a Prd', async () => {
    const r = await adapter({ id: 2003, op: 'evaluate', payload: payload({ prd: content('Prd') }) })
    expect(r).toEqual({ id: 2003, ok: false, error: { code: 'invalid_input', message: 'artifacts.rules is required', retryable: false } })
  })
})

describe('sdd/v1 over a Design', () => {
  const designExample = () => ({ design: content('Design'), architecture: content('Architecture'), domainModel: content('DomainModel'), rules: content('BusinessRules') })
  const designCodes = async (mutate: (a: ReturnType<typeof designExample>) => void, passed: boolean | null = false) => { // null: passing allowed
    const artifacts = structuredClone(designExample())
    mutate(artifacts)
    const r = await adapter({ id: ++id, op: 'evaluate', payload: payload(artifacts) })
    if (passed !== null) expect(r.result.passed).toBe(passed)
    return r.result.findings.map((f: { code: string }) => f.code)
  }

  it('passes the worked example: the claims API against the artifacts it cites', async () => {
    const r = await adapter({ id: 3001, op: 'evaluate', payload: payload(designExample()) })
    expect(r).toEqual({ id: 3001, ok: true, result: { passed: true, findings: [], evidence: [] } })
  })

  it('fails content that is not a Design, and reports nothing else', async () => {
    const r = await adapter({ id: 3002, op: 'evaluate', payload: payload({ design: { title: 'not a Design' } }) })
    expect(r.result).toEqual({ passed: false, findings: [{ severity: 'error', code: 'not-a-design', message: 'content is not a Design: it has no elements array or no type' }], evidence: [] })
    expect(await designCodes((a) => { delete (a.design as any).type })).toEqual(['not-a-design'])
  })

  it('fails a block the Architecture does not have', async () => {
    expect(await designCodes((a) => { a.design.block = 'BB-9' })).toEqual(['unknown-block'])
  })

  it('fails an interface the block does not provide', async () => {
    expect(await designCodes((a) => { a.design.interface = 'ghost API' })).toEqual(['unknown-interface'])
    expect(await designCodes((a) => { a.design.interface = 'directory' })).toEqual(['unknown-interface']) // BB-1 requires it, does not provide it
    const none = structuredClone(designExample())
    delete (none.design as any).interface
    const r = await adapter({ id: 3003, op: 'evaluate', payload: payload(none) })
    expect(r.result).toEqual({ passed: true, findings: [], evidence: [] })
  })

  it('fails a command, a read model and an aggregate the DomainModel does not name', async () => {
    expect(await designCodes((a) => {
      a.design.elements[0].realises.name = 'Ghost Claim'
      a.design.elements[3].realises.name = 'Ghost View'
      a.design.elements[1].realises = { kind: 'aggregate', name: 'AG-9' }
    })).toEqual(['unknown-realised', 'unknown-realised', 'unknown-realised'])
    // names are looked up per kind: a read model's name is not a command
    expect(await designCodes((a) => { a.design.elements[0].realises = { kind: 'command', name: 'My Claims View' } })).toEqual(['unknown-realised'])
    const ok = structuredClone(designExample())
    ok.design.elements[1].realises = { kind: 'aggregate', name: 'AG-1' }
    ok.design.elements[3].realises = { kind: 'event', name: 'Claim Paid' } // another context's event that updates a read model
    const r = await adapter({ id: 3004, op: 'evaluate', payload: payload(ok) })
    expect(r.result).toEqual({ passed: true, findings: [], evidence: [] })
  })

  it('fails a rule that does not resolve, and one that is not active', async () => {
    // a rule in the root only is also unplaced
    expect(await designCodes((a) => { a.design.rules.push('BR-99') })).toEqual(['unknown-rule', 'rules-unplaced'])
    expect(await designCodes((a) => { a.design.rules.push('BR-6') })).toEqual(['inactive-rule', 'rules-unplaced'])
    expect(await designCodes((a) => { a.design.elements[2].rules = ['BR-2', 'BR-3', 'BR-99']; a.design.rules.push('BR-99') })).toEqual(['unknown-rule', 'unknown-rule'])
    // the element reports it, then the root does: elements are checked before the Design's rules
    expect(await designCodes((a) => { a.design.elements[2].rules.push('BR-6'); a.design.rules.push('BR-6') })).toEqual(['inactive-rule', 'inactive-rule'])
  })

  it('fails a rule in the Design rules that no element lists', async () => {
    expect(await designCodes((a) => { a.design.rules.push('BR-1') })).toEqual(['rules-unplaced'])
  })

  it('fails a type whose document is not of its mediaType', async () => {
    expect(await designCodes((a) => { a.design.type = 'data-schema' })).toEqual(['type-mediatype'])
  })

  it('fails a rule an element lists but the Design rules lack', async () => {
    expect(await designCodes((a) => { a.design.elements[0].rules = ['BR-11'] })).toEqual(['rules-incomplete']) // BR-11 is active and in no list
  })

  // a ui Design of the web client (32-ui-design-process.md): screens realise read models, actions realise commands
  // a ui Design: no domainModel, elements realise operations of the API Design bound on `designs` (32-ui-design-process.md)
  const uiDesign = () => ({
    title: 'web client screens', type: 'ui', architecture: 'expense-claims-architecture', businessRules: 'expenses-rules', block: 'BB-5', designSystem: 'expense-claims-design-system',
    document: { mediaType: 'text/markdown', content: '## My Claims\n\nPurpose: the employee sees their claims.\n\n### Layout\n\nA list of `card`s at `spacing.md`, titles in `typography.title-md`.\n\n## Submit a Claim\n\n### Actions\n\n- Submit: submits `POST /claims/{claimId}/submission`.\n\n**Layout.** One `button-primary`.\n' },
    elements: [
      { id: 'EL-1', name: 'My Claims', realises: { kind: 'operation', name: 'GET /claims/mine' } },
      { id: 'EL-2', name: 'Submit a Claim', realises: { kind: 'operation', name: 'POST /claims/{claimId}/submission' } }, // a form screen: the operation its action submits
      { id: 'EL-3', name: 'Submit a Claim: Submit', realises: { kind: 'operation', name: 'POST /claims/{claimId}/submission' }, rules: ['BR-1'] },
    ],
    rules: ['BR-1'], decisions: [], openQuestions: [],
  })
  const designMd = '---\nname: Expenses\ncolors: {primary: "#1D4ED8"}\ntypography: {title-md: {fontSize: 16px}}\nspacing: {md: 16px}\nrounded: {sm: 4px}\ncomponents: {card: {}, button-primary: {}}\n---\n# Expenses\n'
  const uiPayload = (design: any, designSystem = 'expense-claims-design-system', designs: unknown[] = [content('Design')], designSystemContent: unknown = { title: 'Expenses', prd: 'expense-claims', document: { mediaType: 'text/markdown', content: designMd } }) => {
    const { domainModel, ...rest } = designExample()
    const base = payload({ ...rest, design, ...(designSystemContent ? { designSystem: designSystemContent } : {}) })
    const ref = (kind: string, id: string) => ({ apiVersion: 'sdd.persimmon.ai/v1', kind, namespace: 'demo', id, revision: 1 })
    return {
      ...base,
      inputs: { ...base.inputs, designSystem: { kind: 'artifact', ref: ref('DesignSystem', designSystem) }, designs: { kind: 'artifacts', refs: designs.map(() => ref('Design', 'claims-api')) } },
      artifacts: { ...base.artifacts, designs: designs.map((c) => ({ content: c, provenance })) },
    }
  }
  const uiCodes = async (mutate: (d: any) => void, designSystem?: string, designs?: unknown[], designSystemContent?: unknown) => {
    const design = uiDesign()
    mutate(design)
    const r = await adapter({ id: ++id, op: 'evaluate', payload: uiPayload(design, designSystem, designs, designSystemContent) })
    return r.result.findings.map((f: { code: string }) => f.code)
  }

  it('passes a ui Design of a client block against the DesignSystem bound', async () => {
    expect(await uiCodes(() => {})).toEqual([])
    const r = await adapter({ id: ++id, op: 'evaluate', payload: payload({ ...designExample(), design: uiDesign() }) }) // no DesignSystem bound: the citation cannot be checked
    expect(r.result).toMatchObject({ passed: false, findings: [{ code: 'designsystem-mismatch', message: expect.stringContaining('no DesignSystem is bound') }, { code: 'designs-unbound' }] })
  })

  it('fails a ui Design whose document is not markdown, that names no DesignSystem or another, or sits on a block with a context', async () => {
    expect(await uiCodes((d) => { d.document.mediaType = 'application/openapi+yaml' })).toEqual(['type-mediatype'])
    expect(await uiCodes((d) => { delete d.designSystem })).toEqual(['designsystem-mismatch'])
    expect(await uiCodes(() => {}, 'other-design-system')).toEqual(['designsystem-mismatch'])
    expect(await uiCodes((d) => { d.block = 'BB-1' })).toEqual(['client-block'])
  })

  it('reads a ui screen past its index: Actions name operations of the API Designs bound and back the action elements; Layout names the DesignSystem', async () => {
    const r = await adapter({ id: ++id, op: 'evaluate', payload: uiPayload({ ...uiDesign(), document: { mediaType: 'text/markdown', content: uiDesign().document.content.replace('`card`', '`button-tertiary`').replace('`spacing.md`', '`spacing.hero`').replace('`typography.title-md`', '`title-md`') } }) })
    expect(r.result).toMatchObject({ passed: true, findings: [{ severity: 'warning', code: 'layout-unknown', message: 'My Claims: `button-tertiary` is not a component or token of the DesignSystem' }, { severity: 'warning', code: 'layout-unknown', message: expect.stringContaining('spacing.hero') }] }) // a bare token key passes; advice, not failure
    expect(await uiCodes((d) => { d.document.content = d.document.content.replace('`POST /claims/{claimId}/submission`', '`POST /claims/{claimId}/submit`') })).toEqual(['action-unknown', 'action-unbacked']) // the prose names a ghost operation, and the action element's is no longer there
    expect(await uiCodes((d) => { d.document.content = d.document.content.replace('### Actions\n\n- Submit: submits `POST /claims/{claimId}/submission`.\n\n', '') })).toEqual(['action-unbacked']) // no Actions part at all
    expect(await uiCodes((d) => { d.document.content += '\n```\n### Layout\n`ghost`\n### Actions\n`POST /ghost`\n```\n' })).toEqual([]) // fenced code is not prose
    expect(await uiCodes((d) => { d.document.content = d.document.content.replace('`POST /claims/{claimId}/submission`', '`POST /claims/{claimId}/submission` after `GET /claims/mine`') })).toEqual([]) // a second, real operation in the prose is fine
    expect(await uiCodes((d) => { d.document.content = d.document.content.replace('`card`', '`ghost`') }, undefined, undefined, { title: 'x', prd: 'p', document: { mediaType: 'text/markdown', content: '# no front matter\n' } })).toEqual([]) // nothing to read Layout against: the lint owns that
    expect(await uiCodes((d) => { d.document.content = d.document.content.replace('`card`', '`ghost`') }, undefined, undefined, { title: 'x', prd: 'p', document: { mediaType: 'text/markdown', content: designMd.replace(/\n/g, '\r\n') } })).toEqual(['layout-unknown']) // CRLF front matter reads the same
    expect(await uiCodes((d) => { d.document.content = d.document.content.replace('`card`', '`ghost`').replace('`spacing.md`', '`ghost`') })).toEqual(['layout-unknown']) // one warning per name, not per mention
    expect(await uiCodes((d) => { d.document.content = d.document.content.replace('- Submit:', '**Note.** reads twice\n- Submit:') })).toEqual([]) // a bold label that is not a part does not end Actions
    expect(await uiCodes((d) => { d.document.content = d.document.content.replace('### Actions', '**Empty state.**\n### Actions') })).toEqual([]) // nor open one
    expect(await uiCodes((d) => { d.document.content = '### Layout\n`ghost`\n' + d.document.content })).toEqual([]) // a part before any screen is skipped
    expect(await uiCodes((d) => { d.document.content += '\n## Submit\n\n### Actions\n\n- Go: `GET /claims/mine`\n'; d.elements.push({ id: 'EL-4', name: 'Submit', realises: { kind: 'operation', name: 'GET /claims/mine' } }) })).toEqual([]) // a screen element whose name prefixes another screen's action is not an action; `Submit a Claim: Submit` still backs on the longest screen
    expect(await uiCodes(() => {}, undefined, [])).toEqual(['designs-unbound']) // operations unresolvable: one finding; action-unknown is skipped, action-unbacked still reads the prose
  })

  it('a ui Design realises operations of the API Designs bound, names no DomainModel, and indexes every screen', async () => {
    expect(await uiCodes((d) => { d.elements[0].realises.name = 'GET /ghost' })).toEqual(['unknown-realised'])
    expect(await uiCodes((d) => { d.elements[0].realises = { kind: 'readModel', name: 'My Claims View' } })).toEqual(['unknown-realised']) // a model label is not an operation
    expect(await uiCodes((d) => { d.domainModel = 'expenses-model' })).toEqual(['ui-domainmodel'])
    expect(await uiCodes(() => {}, undefined, [])).toEqual(['designs-unbound']) // one finding, not one per element
    expect(await uiCodes((d) => { d.elements.splice(1, 1); d.elements[1].id = 'EL-2' })).toEqual(['document-unindexed'])
    expect(await uiCodes((d) => { d.document.content += '\n```md\n## Not a screen\n```\n## Submit a Claim ##\n' })).toEqual([]) // fenced code skipped, closing hashes dropped
    expect(await uiCodes((d) => { d.document.content += '\n~~~\n```\n## Not a screen\n~~~\n  ## Indented\n' })).toEqual(['document-unindexed']) // a ``` line does not close a ~~~ fence; an indented heading counts
  })

  // the document is the truth, the index its view, both ways (29-design-process.md)
  it('checks the index against the document both ways, per mediaType', async () => {
    expect(await designCodes((a) => { a.design.elements[0].name = 'POST /ghosts' })).toEqual(['element-unbacked', 'document-unindexed']) // the renamed element is unbacked, its path unindexed
    expect(await designCodes((a) => { a.design.document.content += '\n  /extra:\n    get: {responses: {"200": {description: ok}}}\n' })).toEqual(['document-unindexed'])
    expect(await designCodes((a) => { a.design.document.content = 'openapi: [unclosed' })).toEqual(['document-unparsed'])
    expect(await designCodes((a) => { a.design.document.content = a.design.document.content.replace(/\n  \/claims:\n    post:/, '\n  /claims:\n    $ref: "#/components/pathItems/claims"\n') + '\n  pathItems:\n    claims:\n      post: {responses: {"200": {description: ok}}}\n' }, null)).not.toContain('element-unbacked') // a $ref path item resolves
    const findings = (mutate: (a: ReturnType<typeof designExample>) => void) => designCodes(mutate, null)
    const schema = (content: string, names: string[], mediaType = 'application/sql') => findings((a) => {
      a.design.type = 'data-schema'
      a.design.document = { mediaType, content }
      a.design.elements = names.map((name, i) => ({ id: `EL-${i + 1}`, name, realises: { kind: 'aggregate', name: 'AG-1' } }))
      a.design.rules = []
    })
    expect(await schema('-- create table in_a_comment (x int);\nCREATE SCHEMA s;\nCREATE TABLE IF NOT EXISTS s."claim" (id TEXT PRIMARY KEY);\ncreate temp table claim_line(id int);\n/* create table nope (x) */', ['claim', 'claim_line'])).toEqual([])
    expect(await schema('CREATE TABLE claim (id TEXT);', ['claim', 'claim_line'])).toEqual(['element-unbacked'])
    expect(await schema('CREATE TABLE claim (id TEXT); CREATE TABLE receipt (id TEXT);', ['claim'])).toEqual(['document-unindexed'])
    expect(await schema("CREATE TABLE claim (note TEXT DEFAULT '--'); CREATE TABLE claim_line (x INT); -- a line that isn't a literal\nCREATE TABLE receipt (x INT); INSERT INTO claim VALUES ('create table fake (x)');", ['claim', 'claim_line', 'receipt'])).toEqual([]) // literals and comments in one pass
    expect(await schema('CREATE VIRTUAL TABLE docs USING fts5(body); CREATE OR REPLACE TABLE "my.tbl" (x INT); CREATE GLOBAL TEMPORARY TABLE tmp (x INT); CREATE VIEW v AS SELECT 1;', ['docs', 'my.tbl', 'tmp'])).toEqual([]) // a view is not a table
    expect(await schema('{"$defs": {"Claim": {"type": "object"}, "ClaimLine": {"type": "object"}}}', ['Claim', 'ClaimLine'], 'application/schema+json')).toEqual([])
    expect(await schema('{"title": "Claim", "type": "object"}', ['Claim'], 'application/schema+json')).toEqual([])
    expect(await schema('{"title": "Claim"', ['Claim'], 'application/schema+json')).toEqual(['document-unparsed'])
    const events = (content: string, names: string[]) => findings((a) => {
      a.design.type = 'async-api'
      a.design.document = { mediaType: 'application/asyncapi+yaml', content }
      a.design.elements = names.map((name, i) => ({ id: `EL-${i + 1}`, name, realises: { kind: 'event', name: 'Claim Submitted' } }))
      a.design.rules = []
    })
    expect(await events('asyncapi: 3.0.0\nchannels:\n  claim.events:\n    address: claims\n    messages:\n      claim.submitted: {payload: {type: object}}\n', ['claim.events', 'claim.submitted'])).toEqual([])
    expect(await events('asyncapi: 3.0.0\nchannels:\n  claim.events:\n    messages:\n      claim.submitted: {}\n', ['claim.events'])).toEqual(['document-unindexed'])
    expect(await events('asyncapi: 3.0.0\nchannels:\n  claim.events: {$ref: "#/components/channels/events"}\ncomponents:\n  channels:\n    events:\n      messages:\n        claim.submitted: {}\n', ['claim.events', 'claim.submitted'])).toEqual([]) // a $ref channel resolves
    expect(await events('asyncapi: 2.6.0\nchannels:\n  claim.events:\n    publish: {}\n', ['claim.events'])).toEqual(['document-unparsed']) // AsyncAPI 3 only
    expect(await schema('{"title": "Claim", "$defs": {}}', ['Claim'], 'application/schema+json')).toEqual([]) // empty defs: the title
    // a ui action is prose: only its screen must be a heading
    expect(await uiCodes((d) => { d.elements[2].name = 'Ghost: Submit' })).toEqual(['element-unbacked'])
    expect(await uiCodes((d) => { d.document.content += '\n## Claims: Detail\n\n### Actions\n\n- Submit: `GET /claims/mine`\n'; d.elements.push({ id: 'EL-4', name: 'Claims: Detail', realises: { kind: 'operation', name: 'GET /claims/mine' } }, { id: 'EL-5', name: 'Claims: Detail: Submit', realises: { kind: 'operation', name: 'GET /claims/mine' } }) })).toEqual([]) // a screen name with a colon backs its action
    expect(await uiCodes((d) => { delete d.elements[2].name })).toEqual(['element-unbacked']) // no name: a finding, not a throw
  })

  it('warns on a DDL word the block\'s store lacks, and a warning fails nothing', async () => {
    const ddl = async (technology: string | undefined, content: string) => {
      const a = structuredClone(designExample()) as any
      a.architecture.buildingBlocks[0].technology = technology
      a.design.type = 'data-schema'
      a.design.document = { mediaType: 'application/sql', content }
      a.design.elements = [{ id: 'EL-1', name: 'claim', realises: { kind: 'aggregate', name: 'AG-1' } }]
      a.design.rules = []
      return (await adapter({ id: ++id, op: 'evaluate', payload: payload(a) })).result
    }
    expect(await ddl('Node service, SQLite', 'CREATE TABLE claim (id TEXT, due TEXT);')).toEqual({ passed: true, findings: [], evidence: [] })
    expect(await ddl('Node service, SQLite', "CREATE TABLE claim (id TEXT, due TEXT CHECK (due > now() - INTERVAL '1 day'));")).toEqual({ passed: true, findings: [{ severity: 'warning', code: 'dialect', message: expect.stringContaining('INTERVAL is not SQLite') }], evidence: [] })
    expect((await ddl('SQLite', "CREATE TABLE claim (id TEXT, d DATE DEFAULT '2020-01-01'::date);")).findings.map((f: { code: string }) => f.code)).toEqual(['dialect']) // a bare cast
    expect((await ddl('SQLite', 'CREATE\n  SCHEMA s; CREATE TABLE claim (id TEXT);')).findings.map((f: { code: string }) => f.code)).toEqual(['dialect']) // any whitespace inside a word
    expect(await ddl('SQLite', "CREATE TABLE claim (kind TEXT CHECK (kind IN ('interval', 'serial')), extract TEXT, d TEXT CHECK (EXTRACT (year FROM d) > 2000));")).toMatchObject({ passed: true, findings: [{ code: 'dialect', message: expect.stringContaining('EXTRACT(') }] }) // literals stripped; `extract` the column is not the function
    expect(await ddl('PostgreSQL in prod, SQLite in tests', 'CREATE TABLE claim (id SERIAL);')).toEqual({ passed: true, findings: [], evidence: [] }) // two stores named: nothing to hold the DDL to
    expect(await ddl('Node service, SQLite', '-- INTERVAL in a comment\nCREATE TABLE claim (id TEXT, interval_days INTEGER);')).toEqual({ passed: true, findings: [], evidence: [] }) // a comment, and a word inside an identifier
    expect(await ddl('PostgreSQL 16', 'CREATE TABLE claim (id INTEGER PRIMARY KEY AUTOINCREMENT);')).toMatchObject({ passed: true, findings: [{ severity: 'warning', code: 'dialect' }] })
    expect(await ddl(undefined, "CREATE TABLE claim (due TEXT CHECK (due > now() - INTERVAL '1 day'));")).toEqual({ passed: true, findings: [], evidence: [] }) // no store named: no check
    expect((await ddl('SQLite', "CREATE TABLE claim (due INTERVAL); CREATE TABLE ghost (id TEXT);")).findings.map((f: { code: string; severity: string }) => `${f.severity}:${f.code}`)).toEqual(['error:document-unindexed', 'warning:dialect'])
  })

  it('holds the document\'s fields to the Glossary: an alias or a deprecated name is an error, a word the Glossary lacks a warning, each once', async () => {
    const withGlossary = async (edit: (content: string) => string = (c) => c) => {
      const a = structuredClone(designExample()) as any
      a.glossary = content('Glossary')
      a.design.document.content = edit(a.design.document.content)
      return (await adapter({ id: ++id, op: 'evaluate', payload: payload(a) })).result
    }
    const label = (r: any) => r.findings.map((f: { severity: string; code: string; message: string }) => `${f.severity}:${f.code}:${f.message.split(':')[0]}`)
    // the worked example: `rule`, `route` and `reason` are no term or fact type (Q-2 says so of reason); `amount`, `submissionDate`, `riskFlag`, `destinationCountry` are
    const worked = await withGlossary()
    expect(worked.passed).toBe(true)
    expect(label(worked)).toEqual(['warning:term-unknown:rule', 'warning:term-unknown:route', 'warning:term-unknown:reason'])
    expect(worked.findings[0].message).toBe('rule: no term or fact type of the Glossary names it')
    // an alias of claim line, and the deprecated expense report: the Glossary says what to write instead
    const alias = await withGlossary((c) => c.replace('properties: {amount:', 'properties: {expense:').replace('reason: {type: string}', 'reason: {type: string}, expenseReport: {type: string}'))
    expect(alias.passed).toBe(false)
    expect(alias.findings.filter((f: { code: string }) => f.code === 'alias-used').map((f: { message: string }) => f.message)).toEqual(['expense: expense is an alias; the Glossary names claim line', 'expenseReport: expense report is deprecated; the Glossary names claim'])
    // a plural of a term, an id in any case, an array and a field named `properties` are not findings; a name is reported once per document
    const fine = await withGlossary((c) => c.replace('properties: {reason: {type: string}}', 'properties: {receipts: {type: boolean}, tripId: {type: string}, LINE_ID: {type: string}, legs: {type: array, items: {type: string}}, properties: {type: string, format: date}, rule: {type: string}}'))
    expect(label(fine)).toEqual(['warning:term-unknown:rule', 'warning:term-unknown:route', 'warning:term-unknown:properties'])
    // the name as written is looked up before its singular: `caps` is the alias `cap`, not a plural of nothing
    const caps = await withGlossary((c) => c.replace('properties: {reason: {type: string}}', 'properties: {caps: {type: number}}'))
    expect(label(caps)).toContain('error:alias-used:caps')
    // DDL columns, snake_case, quoted, a constraint item skipped
    const a = structuredClone(designExample()) as any
    a.glossary = content('Glossary')
    a.design.type = 'data-schema'
    a.design.document = { mediaType: 'application/sql', content: 'CREATE TABLE claim (id TEXT, CLAIM_ID TEXT, "reimbursement request" TEXT, submission_date DATE, cap NUMERIC, due DATE, period DATE, PRIMARY KEY (id), CONSTRAINT c CHECK (cap > 0), KEY k (due), FULLTEXT INDEX f (cap));' } // `period` the column, not `PERIOD FOR`; KEY and FULLTEXT INDEX items are constraints
    a.design.elements = [{ id: 'EL-1', name: 'claim', realises: { kind: 'aggregate', name: 'AG-1' } }]
    a.design.rules = []
    const ddl = (await adapter({ id: ++id, op: 'evaluate', payload: payload(a) })).result
    expect(ddl.passed).toBe(false)
    expect(label(ddl)).toEqual(['error:alias-used:reimbursement request', 'error:alias-used:cap', 'warning:term-unknown:due', 'warning:term-unknown:period'])
  })

  it('every example Design passes the document checks of checkDesign', () => {
    const files = ['docs/design/examples/sdlc-domain.yaml', 'examples/example07/room-booking-domain.yaml', 'examples/example08/car-pool-domain.yaml']
    for (const f of files) {
      const all = parseAllDocuments(readFileSync(join(root, f), 'utf8')).map((x) => x.toJS()).filter(Boolean)
      const byKind = (kind: string) => all.filter((d) => d.kind === kind)
      const designs = Object.fromEntries(byKind('Design').map((d) => [d.spec.identity.id, d.spec.content]))
      for (const d of byKind('Design')) {
        const c = d.spec.content
        const architecture = byKind('Architecture').find((a) => a.spec.identity.id === c.architecture)?.spec.content
        const domainModel = byKind('DomainModel').find((m) => m.spec.identity.id === c.domainModel)?.spec.content
        const rules = byKind('BusinessRules')[0]?.spec.content
        const designSystem = byKind('DesignSystem').find((s) => s.spec.identity.id === c.designSystem)?.spec.content
        const glossary = byKind('Glossary').find((g) => g.spec.content.context === domainModel?.context)?.spec.content
        const all = checkDesign({ design: c, architecture, domainModel, rules, designs, designSystem, glossary, ids: { designSystem: c.designSystem } })
        const found = all.filter((x: { code: string }) => /^(document-|element-unbacked|dialect|action-|alias-)/.test(x.code))
        expect({ file: f, id: d.spec.identity.id, found }).toEqual({ file: f, id: d.spec.identity.id, found: [] })
        const layout = all.filter((x: { code: string }) => x.code === 'layout-unknown').length
        if (c.type === 'ui') expect({ file: f, id: d.spec.identity.id, layoutWarnings: layout > 0 }).toEqual({ file: f, id: d.spec.identity.id, layoutWarnings: false }) // every recorded ui Design's Layouts name the DesignSystem only (32-ui-design-process.md)
      }
      const rulesId = byKind('BusinessRules')[0]?.spec.identity.id
      for (const d of all.filter((x) => ['Prd', 'Spec', 'Design', 'Architecture'].includes(x.kind))) expect({ file: f, id: d.spec.identity.id, businessRules: d.spec.content.businessRules }).toEqual({ file: f, id: d.spec.identity.id, businessRules: rulesId })
    }
  })

  it('every example places each Prd capability in exactly one BoundedContext (checkArchitecture)', () => {
    for (const f of ['docs/design/examples/sdlc-domain.yaml', 'examples/example07/room-booking-domain.yaml', 'examples/example08/car-pool-domain.yaml']) {
      const all = parseAllDocuments(readFileSync(join(root, f), 'utf8')).map((x) => x.toJS()).filter(Boolean)
      const one = (kind: string) => all.find((d) => d.kind === kind).spec.content
      const contexts = Object.fromEntries(all.filter((d) => d.kind === 'BoundedContext').map((d) => [d.spec.identity.id, d.spec.content]))
      const found = checkArchitecture({ architecture: one('Architecture'), prd: one('Prd'), rules: one('BusinessRules'), contexts }).filter((x) => x.code.startsWith('capability-'))
      expect({ file: f, found }).toEqual({ file: f, found: [] })
    }
  })

  // a BR-n is a pair with the artifact the document names (33-multi-context-product.md)
  it('refuses a document that names no BusinessRules artifact, or another than the one bound', async () => {
    expect(await designCodes((a) => { delete (a.design as any).businessRules })).toEqual(['rules-mismatch'])
    expect(await designCodes((a) => { (a.design as any).businessRules = 'other-rules' })).toEqual(['rules-mismatch'])
    expect(await codes((a) => { (a.spec as any).businessRules = 'other-rules' })).toEqual(['rules-mismatch'])
    expect(await codes((a) => { delete (a.spec as any).businessRules })).toEqual(['rules-mismatch'])
    const prdCase = async (mutate: (a: any) => void) => {
      const a = structuredClone({ prd: content('Prd'), rules: content('BusinessRules') }) as any
      mutate(a)
      return (await adapter({ id: ++id, op: 'evaluate', payload: payload(a) })).result.findings.map((f: { code: string }) => f.code)
    }
    expect(await prdCase((a) => { delete a.prd.businessRules })).toEqual(['rules-mismatch'])
    expect(await prdCase((a) => { a.prd.businessRules = 'other-rules' })).toEqual(['rules-mismatch'])
    const archCase = async (mutate: (a: any) => void) => {
      const a = structuredClone({ architecture: content('Architecture'), prd: content('Prd'), rules: content('BusinessRules') }) as any
      mutate(a)
      return (await adapter({ id: ++id, op: 'evaluate', payload: payload(a) })).result.findings.map((f: { code: string }) => f.code).filter((c: string) => c === 'rules-mismatch') // the bare payload binds no contexts or Adrs; those findings are another test's
    }
    expect(await archCase((a) => { a.architecture.businessRules = 'other-rules' })).toEqual(['rules-mismatch'])
    expect(await archCase((a) => { delete a.architecture.businessRules })).toEqual(['rules-mismatch'])
    // the upstream document must name the rules bound too: a document bound to another product's rules does not pass by copying the id
    const foreign = (p: any) => { p.inputs.rules.ref.id = 'other-rules'; return p }
    expect((await adapter({ id: ++id, op: 'evaluate', payload: foreign(payload(structuredClone({ ...example(), spec: { ...content('Spec'), businessRules: 'other-rules' } }))) })).result.findings.map((f: { code: string }) => f.code)).toEqual(['rules-mismatch']) // the Prd names expenses-rules
    expect((await adapter({ id: ++id, op: 'evaluate', payload: foreign(payload(structuredClone({ ...designExample(), design: { ...content('Design'), businessRules: 'other-rules' } }))) })).result.findings.map((f: { code: string }) => f.code)).toEqual(['rules-mismatch']) // the Architecture names expenses-rules
    expect(await archCase((a) => { a.architecture.businessRules = 'other-rules'; a.prd.businessRules = 'other-rules' })).toEqual(['rules-mismatch', 'rules-mismatch']) // both foreign to the bound: the document's own, then the Prd's
    const unbound = payload(structuredClone(example())) as any
    delete unbound.inputs.rules // no rules input bound: the name stands unchecked
    expect((await adapter({ id: ++id, op: 'evaluate', payload: unbound })).result.passed).toBe(true)
  })

  it('fails ids that are not unique and increasing', async () => {
    expect(await designCodes((a) => { a.design.elements[2].id = 'EL-2' })).toEqual(['id-sequence'])
    expect(await designCodes((a) => { a.design.openQuestions[0].id = 'Q-0' })).toEqual(['id-sequence'])
  })

  it('a Design of any type but ui with no DomainModel bound is one finding, not an Adapter error', async () => {
    expect(await designCodes((a) => { delete (a as { domainModel?: unknown }).domainModel })).toEqual(['domainmodel-unbound'])
  })

  it('is invalid_input without the BusinessRules beside a Design', async () => {
    const { rules, ...rest } = designExample()
    const r = await adapter({ id: 3005, op: 'evaluate', payload: payload(rest) })
    expect(r).toEqual({ id: 3005, ok: false, error: { code: 'invalid_input', message: 'artifacts.rules is required', retryable: false } })
  })

  it('is invalid_input without the Architecture beside a Design', async () => {
    const { architecture, ...noArchitecture } = designExample()
    expect(await adapter({ id: 3006, op: 'evaluate', payload: payload(noArchitecture) })).toEqual({ id: 3006, ok: false, error: { code: 'invalid_input', message: 'artifacts.architecture is required', retryable: false } })
  })
})

describe('sdd/v1 over a Plan', () => {
  const designRef = { apiVersion: 'sdd.persimmon.ai/v1', kind: 'Design', namespace: 'default', id: 'claims-api', revision: 1 }
  const planExample = () => ({ plan: content('Plan'), spec: content('Spec'), architecture: content('Architecture'), designs: [content('Design')] })
  // the Designs are an artifacts port: a list in artifacts, their refs in inputs, paired by position
  const planPayload = (a: ReturnType<typeof planExample>, refs = [designRef]) => {
    const { designs, ...rest } = a
    const ref = (kind: string, id: string) => ({ kind: 'artifact', ref: { ...designRef, kind, id } })
    return { ...payload(rest), inputs: { spec: ref('Spec', 'submit-a-claim'), architecture: ref('Architecture', 'expense-claims-architecture'), designs: { kind: 'artifacts', refs } }, artifacts: { ...payload(rest).artifacts, designs: designs.map((c) => ({ content: c, provenance })) } }
  }
  const planCodes = async (mutate: (a: ReturnType<typeof planExample>) => void, refs?: typeof designRef[]) => {
    const artifacts = structuredClone(planExample())
    mutate(artifacts)
    const r = await adapter({ id: ++id, op: 'evaluate', payload: planPayload(artifacts, refs) })
    expect(r.result.passed).toBe(false)
    return r.result.findings.map((f: { code: string }) => f.code)
  }

  it('passes the worked example: the Plan of CAP-1 against its Spec, Architecture and Design', async () => {
    const r = await adapter({ id: 4001, op: 'evaluate', payload: planPayload(planExample()) })
    expect(r).toEqual({ id: 4001, ok: true, result: { passed: true, findings: [], evidence: [] } })
  })

  it('fails content that is not a Plan, and reports nothing else', async () => {
    const r = await adapter({ id: 4002, op: 'evaluate', payload: planPayload({ ...planExample(), plan: { title: 'x' } as never }) })
    expect(r.result).toEqual({ passed: false, findings: [{ severity: 'error', code: 'not-a-plan', message: 'content is not a Plan: it has no tasks array or no spec' }], evidence: [] })
  })

  it('fails a requirement or scenario the Spec lacks, and one no task covers or verifies', async () => {
    expect(await planCodes((a) => { a.plan.tasks[3].covers = ['FR-9'] })).toEqual(['unknown-requirement', 'requirement-unplanned'])
    expect(await planCodes((a) => { a.plan.tasks[3].verifiedBy = ['AC-9'] })).toEqual(['unknown-scenario', 'scenario-unverified'])
  })

  it('a build-stage quality scenario the Spec cites verifies a task; one not cited or not at build is refused (35-build-process.md)', async () => {
    const qs = (a: ReturnType<typeof planExample>) => a.architecture.qualityScenarios.find((q: { id: string }) => q.id === 'QS-3')
    expect(await planCodes((a) => { a.plan.tasks[0].verifiedBy = ['AC-1', 'AC-3'] })).toEqual(['scenario-unverified'])
    expect(await planCodes((a) => { a.plan.tasks[0].verifiedBy.push('QS-2') })).toEqual(['unknown-scenario']) // build, but not cited
    expect(await planCodes((a) => { a.plan.tasks[0].verifiedBy.push('QS-1') })).toEqual(['scenario-not-build']) // cited, at release
    const released = structuredClone(planExample())
    Object.assign(qs(released), { method: 'load', stage: 'release' })
    released.plan.tasks[0].verifiedBy = ['AC-1', 'AC-3']
    expect((await adapter({ id: 4009, op: 'evaluate', payload: planPayload(released) })).result.passed).toBe(true) // a release scenario is not the build's
  })

  it('fails a block the Architecture lacks and a dependency that is unknown or not earlier', async () => {
    expect(await planCodes((a) => { a.plan.tasks[1].block = 'BB-9' })).toEqual(['unknown-block'])
    expect(await planCodes((a) => { a.plan.tasks[0].dependsOn = ['T-3'] })).toEqual(['dependency-forward'])
    expect(await planCodes((a) => { a.plan.tasks[0].dependsOn = ['T-9'] })).toEqual(['unknown-task'])
  })

  it('fails an element of a design not listed, not evaluated, of another block, or missing', async () => {
    expect(await planCodes((a) => { a.plan.tasks[0].elements![0].design = 'ghost' })).toEqual(['unknown-design'])
    expect(await planCodes((a) => { a.plan.designs.push('ghost'); a.plan.tasks[0].elements![0].design = 'ghost' })).toEqual(['design-unread'])
    expect(await planCodes(() => {}, [{ ...designRef, id: 'other' }])).toEqual(['design-unread', 'design-unread', 'design-unread', 'design-unread'])
    expect(await planCodes((a) => { a.plan.tasks[0].block = 'BB-2' })).toEqual(['design-block', 'design-block'])
    expect(await planCodes((a) => { a.plan.tasks[0].elements![0].element = 'EL-99' })).toEqual(['unknown-element'])
    expect(await planCodes((a) => { a.plan.designs.push('spare') })).toEqual(['design-unused'])
  })

  it('fails a spec or architecture that is not the one evaluated, and a design listed twice', async () => {
    expect(await planCodes((a) => { a.plan.spec = 'other' })).toEqual(['spec-mismatch'])
    expect(await planCodes((a) => { a.plan.architecture = 'other' })).toEqual(['architecture-mismatch'])
    expect(await planCodes((a) => { a.plan.designs.push('claims-api') })).toEqual(['design-duplicate'])
  })

  it('fails ids that are not unique and increasing', async () => {
    expect(await planCodes((a) => { a.plan.tasks[3].id = 'T-3' })).toEqual(['dependency-forward', 'id-sequence']) // T-4 renamed T-3 also depends on itself
    expect(await planCodes((a) => { a.plan.openQuestions[0].id = 'Q-0' })).toEqual(['id-sequence'])
  })

  it('is invalid_input without the Spec or the Architecture beside a Plan', async () => {
    const { spec, ...noSpec } = planExample()
    expect(await adapter({ id: 4003, op: 'evaluate', payload: planPayload(noSpec as never) })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'artifacts.spec is required' } })
    const { architecture, ...noArchitecture } = planExample()
    expect(await adapter({ id: 4004, op: 'evaluate', payload: planPayload(noArchitecture as never) })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'artifacts.architecture is required' } })
  })
})

describe('sdd/v1 over an AcceptanceRecord', () => {
  const ref = (kind: string, id: string) => ({ kind: 'artifact', ref: { apiVersion: 'sdd.persimmon.ai/v1', kind, namespace: 'default', id, revision: 1 } })
  const recordExample = () => ({ record: content('AcceptanceRecord'), testOutcome: content('TestOutcome'), plan: content('Plan'), spec: content('Spec') } as Record<string, any>)
  const recordPayload = (a: Record<string, unknown>) => ({ ...payload(a), inputs: { plan: ref('Plan', 'submit-a-claim-plan'), spec: ref('Spec', 'submit-a-claim'), taskId: { kind: 'value', value: 'T-1' } } })
  const recordCodes = async (mutate: (a: Record<string, any>) => void) => {
    const artifacts = structuredClone(recordExample())
    mutate(artifacts)
    const r = await adapter({ id: ++id, op: 'evaluate', payload: recordPayload(artifacts) })
    expect(r.result.passed).toBe(false)
    return r.result.findings.map((f: { code: string }) => f.code)
  }
  const tests = (a: Record<string, any>) => a.testOutcome.tests as { classname: string; name: string; status: string }[]

  it('passes the worked example: T-1 built, AC-1, AC-3 and QS-3 proven by passing tests', async () => {
    const r = await adapter({ id: 5001, op: 'evaluate', payload: recordPayload(recordExample()) })
    expect(r).toEqual({ id: 5001, ok: true, result: { passed: true, findings: [], evidence: [] } })
  })

  it('fails content that is not a record, and an outcome with no test case, each as the only finding', async () => {
    expect(await recordCodes((a) => { a.record = { title: 'x' } })).toEqual(['not-a-record'])
    const r = await adapter({ id: 5002, op: 'evaluate', payload: recordPayload({ ...recordExample(), testOutcome: { command: ['npm', 'test'], exitCode: 2, tests: [], outputTail: 'error TS2304' } }) })
    expect(r.result.findings).toEqual([{ severity: 'error', code: 'suite-empty', message: 'no test case ran (exit 2): error TS2304' }])
  })

  it('fails a record for another task, Plan or Spec, and a task the Plan lacks', async () => {
    expect(await recordCodes((a) => { a.record.task = 'T-3'; a.record.verifies = [{ scenario: 'AC-4', tests: [tests(a)[0]!.name] }, { scenario: 'AC-5', tests: [tests(a)[1]!.name] }, { scenario: 'AC-6', tests: [tests(a)[2]!.name] }] })).toEqual(['task-mismatch'])
    expect(await recordCodes((a) => { a.record.plan = 'other' })).toEqual(['plan-mismatch'])
    expect(await recordCodes((a) => { a.record.spec = 'other' })).toEqual(['spec-mismatch'])
    expect(await recordCodes((a) => { a.plan.spec = 'other' })).toEqual(['spec-mismatch'])
    expect(await recordCodes((a) => { a.record.task = 'T-9' })).toEqual(['task-mismatch', 'unknown-task'])
  })

  it('fails a scenario with no row, two rows, or a row for a scenario the task is not verified by', async () => {
    expect(await recordCodes((a) => { a.record.verifies.pop() })).toEqual(['scenario-unrecorded'])
    expect(await recordCodes((a) => { a.record.verifies.push({ ...a.record.verifies[0] }) })).toEqual(['scenario-duplicate'])
    expect(await recordCodes((a) => { a.record.verifies.push({ scenario: 'AC-4', tests: [tests(a)[2]!.name] }) })).toEqual(['unknown-scenario'])
    expect(await recordCodes((a) => { a.record.verifies.push({ scenario: 'AC-99', tests: [tests(a)[2]!.name] }) })).toEqual(['unknown-scenario']) // a typo: not this task's
    const stale = structuredClone(recordExample())
    stale.spec.stories[0].acceptance = stale.spec.stories[0].acceptance.filter((s: { id: string }) => s.id !== 'AC-3') // the Spec dropped AC-3 after the Plan
    const r = await adapter({ id: 5003, op: 'evaluate', payload: recordPayload(stale) })
    expect(r.result.findings.map((f: { code: string; message: string }) => [f.code, /revised after the Plan/.test(f.message)])).toEqual([['unknown-scenario', true]])
    expect(await recordCodes((a) => { a.spec.qualities = a.spec.qualities.filter((q: { scenario: string }) => q.scenario !== 'QS-3') })).toEqual(['unknown-scenario']) // the Spec stopped citing QS-3
    expect(await recordCodes((a) => { a.record.verifies = a.record.verifies.filter((r: { scenario: string }) => r.scenario !== 'QS-3') })).toEqual(['scenario-unrecorded'])
    const misnamed = structuredClone(recordExample())
    misnamed.record.verifies.at(-1).tests = [misnamed.testOutcome.tests[2].name]
    expect((await adapter({ id: 5010, op: 'evaluate', payload: recordPayload(misnamed) })).result.passed).toBe(true) // which test proves QS-3 is a reader's judgement, not the check's
  })

  it('fails a named test that is missing, ambiguous, failed, errored or skipped', async () => {
    expect(await recordCodes((a) => { a.record.verifies[0].tests = ['nope'] })).toEqual(['test-missing'])
    expect(await recordCodes((a) => { tests(a).push({ ...tests(a)[0]!, classname: 'test/other.test.ts', status: 'failed' }); a.testOutcome.exitCode = 1 })).toEqual(['test-ambiguous']) // its red twin is not also suite-failed
    expect(await recordCodes((a) => { tests(a).push({ ...tests(a)[0]!, status: 'failed' }); a.testOutcome.exitCode = 1 })).toEqual(['test-failed']) // written twice, one test: red if any run is
    const retried = structuredClone(recordExample())
    retried.testOutcome.tests.push({ ...retried.testOutcome.tests[0] })
    expect((await adapter({ id: 5006, op: 'evaluate', payload: recordPayload(retried) })).result.passed).toBe(true)
    const twin = structuredClone(recordExample())
    twin.testOutcome.tests.push({ ...twin.testOutcome.tests[0], classname: 'test/other.test.ts' })
    twin.record.verifies[0].tests = [`test/claim.test.ts > ${twin.testOutcome.tests[0].name}`]
    expect((await adapter({ id: 5005, op: 'evaluate', payload: recordPayload(twin) })).result.passed).toBe(true) // classname > name tells them apart
    expect(await recordCodes((a) => { tests(a)[0]!.status = 'failed'; a.testOutcome.exitCode = 1 })).toEqual(['test-failed'])
    expect(await recordCodes((a) => { tests(a)[0]!.status = 'errored'; a.testOutcome.exitCode = 1 })).toEqual(['test-failed'])
    expect(await recordCodes((a) => { tests(a)[0]!.status = 'skipped' })).toEqual(['test-skipped'])
  })

  it('fails a red test no row names, a non-zero exit with nothing red, a test the last round named that no longer runs, an open question', async () => {
    expect(await recordCodes((a) => { tests(a)[2]!.status = 'failed'; a.testOutcome.exitCode = 1 })).toEqual(['suite-failed'])
    expect(await recordCodes((a) => { a.testOutcome.exitCode = 137 })).toEqual(['suite-exit'])
    const older = (a: Record<string, any>) => ({ ...a.testOutcome, tests: [...tests(a), { classname: 'test/claim.test.ts', name: 'claim > an older test', status: 'passed' }] })
    expect(await recordCodes((a) => { a.previous = { ...a.record, verifies: [{ scenario: 'AC-1', tests: ['claim > an older test'] }] }; a.previousOutcome = older(a) })).toEqual(['test-dropped'])
    const neverRan = structuredClone(recordExample())
    neverRan.previous = { ...neverRan.record, verifies: [{ scenario: 'AC-1', tests: ['claim > a wrong name'] }] } // last round named a test that never ran
    neverRan.previousOutcome = neverRan.testOutcome
    expect((await adapter({ id: 5008, op: 'evaluate', payload: recordPayload(neverRan) })).result.passed).toBe(true) // fixing the name is not dropping a test
    const half = structuredClone(recordExample())
    half.previous = half.record // without its outcome, test-dropped could check nothing
    expect(await adapter({ id: 5009, op: 'evaluate', payload: recordPayload(half) })).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'artifacts.previous and artifacts.previousOutcome come together' } })
    expect(await recordCodes((a) => { a.record.verifies[0].tests = ['gone']; a.previous = structuredClone(a.record); a.previousOutcome = a.testOutcome })).toEqual(['test-missing']) // still named now: missing, not dropped
    const same = structuredClone(recordExample())
    same.previous = structuredClone(same.record)
    same.previousOutcome = same.testOutcome
    expect((await adapter({ id: 5007, op: 'evaluate', payload: recordPayload(same) })).result.passed).toBe(true) // last round's tests still run
    expect(await recordCodes((a) => { a.record.openQuestions = [{ id: 'Q-1', question: 'which currency?' }] })).toEqual(['question-open'])
    const r = await adapter({ id: 5004, op: 'evaluate', payload: recordPayload((() => { const a = structuredClone(recordExample()); a.record.openQuestions = [{ id: 'Q-1', question: 'which currency?', resolution: 'EUR' }]; return a })()) })
    expect(r.result.passed).toBe(true) // a resolved question passes
  })
})

describe('sdd/v1 over an Architecture', () => {
  const adrIds = ['adr-receipts-as-blobs', 'adr-routing-in-core']
  const adrs = () => docs.filter((d) => d.kind === 'Adr').map((d) => d.spec.content)
  const archExample = () => ({ architecture: content('Architecture'), prd: content('Prd'), rules: content('BusinessRules'), contexts: [content('BoundedContext')], domainModels: [], glossaries: [content('Glossary')], adrs: adrs() })
  const ref = (kind: string, id: string) => ({ apiVersion: 'sdd.persimmon.ai/v1', kind, namespace: 'demo', id, revision: 1 })
  const inputs = () => ({
    prd: { kind: 'artifact', ref: ref('Prd', 'expense-claims') },
    contexts: { kind: 'artifacts', refs: [ref('BoundedContext', 'expenses')] },
    domainModels: { kind: 'artifacts', refs: [] },
    glossaries: { kind: 'artifacts', refs: [ref('Glossary', 'expenses-glossary')] },
    adrs: { kind: 'artifacts', refs: adrIds.map((id) => ref('Adr', id)) },
  })
  const archPayload = (a: ReturnType<typeof archExample>, over: Record<string, unknown> = {}) => ({
    ...payload({ architecture: a.architecture, prd: a.prd, rules: a.rules }),
    inputs: { ...inputs(), ...over },
    artifacts: {
      architecture: { content: a.architecture, provenance },
      prd: { content: a.prd, provenance },
      rules: { content: a.rules, provenance },
      contexts: a.contexts.map((c) => ({ content: c, provenance })),
      domainModels: a.domainModels.map((c) => ({ content: c, provenance })),
      glossaries: a.glossaries.map((c) => ({ content: c, provenance })),
      adrs: a.adrs.map((c) => ({ content: c, provenance })),
    },
  })
  const archCodes = async (mutate: (a: ReturnType<typeof archExample>) => void, over: Record<string, unknown> = {}) => {
    const a = structuredClone(archExample())
    mutate(a)
    const r = await adapter({ id: ++id, op: 'evaluate', payload: archPayload(a, over) })
    expect(r.result.passed).toBe(false)
    return r.result.findings.map((f: { code: string }) => f.code)
  }

  it('passes the worked example: the Architecture against its Prd, context, glossary, rules and Adrs', async () => {
    const r = await adapter({ id: ++id, op: 'evaluate', payload: archPayload(archExample()) })
    expect(r.result).toEqual({ passed: true, findings: [], evidence: [] })
  })
  it('fails content that is not an Architecture, and reports nothing else', async () => {
    const r = await adapter({ id: ++id, op: 'evaluate', payload: archPayload({ ...archExample(), architecture: { title: 'x' } as never }) })
    expect(r.result).toEqual({ passed: false, findings: [{ severity: 'error', code: 'not-an-architecture', message: 'content is not an Architecture: it has no buildingBlocks array or no introduction' }], evidence: [] })
  })
  it('fails a Prd id other than the one evaluated', async () => {
    expect(await archCodes((a) => (a.architecture.introduction.prd = 'other'))).toEqual(['prd-mismatch'])
  })
  it('fails a block context not evaluated, a context no level 1 block realises, a Prd capability context not evaluated', async () => {
    expect(await archCodes((a) => (a.architecture.buildingBlocks[0].contexts = ['payroll']))).toEqual(['unknown-context']) // BB-3 and BB-4 still realise expenses
    expect(await archCodes((a) => a.architecture.buildingBlocks.forEach((b: { contexts: string[] }) => (b.contexts = [])))).toEqual(['context-unrealised'])
    // every capability in exactly one BoundedContext (34-subdomains.md)
    expect(await archCodes((a) => (a.contexts[0].capabilities = a.contexts[0].capabilities.slice(1)))).toEqual(['capability-unplaced'])
    // a second context listing the same four, realised by no block
    expect(await archCodes((a) => a.contexts.push(structuredClone(a.contexts[0])), { contexts: { kind: 'artifacts', refs: [ref('BoundedContext', 'expenses'), ref('BoundedContext', 'expenses-two')] } })).toEqual(['context-unrealised', ...Array(4).fill('capability-twice')])
    expect(await archCodes((a) => (a.architecture.buildingBlocks[0].parent = 'BB-9'))).toEqual(['unknown-parent'])
  })
  it('fails a listed model, glossary or Adr that was not evaluated, and one evaluated but not listed', async () => {
    expect(await archCodes((a) => (a.architecture.domainModels = ['expenses-model']))).toEqual(['model-mismatch'])
    expect(await archCodes((a) => (a.architecture.glossaries = []))).toEqual(['glossary-mismatch'])
    expect(await archCodes((a) => (a.architecture.decisions = [adrIds[0]]))).toEqual(['adr-mismatch'])
  })
  it('fails a strategy driver, a scenario goal and a goal without a scenario', async () => {
    expect(await archCodes((a) => (a.architecture.strategy[0].addresses = ['QG-9']))).toEqual(['unknown-driver'])
    expect(await archCodes((a) => (a.architecture.qualityScenarios[0].qualityGoal = 'QG-9'))).toEqual(['unknown-quality-goal'])
    expect(await archCodes((a) => (a.architecture.qualityScenarios = a.architecture.qualityScenarios.filter((q: { qualityGoal: string }) => q.qualityGoal !== 'QG-3')))).toEqual(['goal-unscenarioed'])
  })
  it('fails a relation end that resolves nowhere, one between two partners, a wrong interface, an unrelated block or partner', async () => {
    expect(await archCodes((a) => (a.architecture.relations[0].from = 'nobody'))).toEqual(['unknown-relation-end', 'partner-unrelated']) // the employee lost its only relation
    expect(await archCodes((a) => (a.architecture.relations[3].to = 'nobody'))).toEqual(['unknown-relation-end']) // no interface finding on top
    expect(await archCodes((a) => (a.architecture.relations[0].to = 'approver'))).toEqual(['relation-no-block'])
    expect(await archCodes((a) => (a.architecture.relations[3].interface = 'blob API'))).toEqual(['unknown-interface'])
    expect(await archCodes((a) => a.architecture.relations.splice(8, 1))).toEqual(['partner-unrelated'])
    expect(await archCodes((a) => a.architecture.buildingBlocks.push({ id: 'BB-6', name: 'spare', responsibility: 'nothing yet', interfaces: [], contexts: [] }))).toEqual(['block-unrelated'])
  })
  it('fails an Adr that is not accepted, and a driver that resolves nowhere; a superseded slot is skipped', async () => {
    expect(await archCodes((a) => (a.adrs[0].status = 'proposed'))).toEqual(['adr-status'])
    expect(await archCodes((a) => (a.adrs[0].drivers = ['BR-99']))).toEqual(['unknown-adr-driver'])
  })

  // the slot rule (31-architecture-process.md): the n-th Adr backs S-n and says so; the worked example's Adrs are taken
  // outside the loop and name no strategy, so the tests set it
  it('holds an Adr naming its strategy to its slot, and a superseded one to a dropped strategy', async () => {
    const named = (a: ReturnType<typeof archExample>) => { a.adrs[0].strategy = 'S-1'; a.adrs[1].strategy = 'S-2' }
    const ok = structuredClone(archExample())
    named(ok)
    expect((await adapter({ id: ++id, op: 'evaluate', payload: archPayload(ok) })).result).toEqual({ passed: true, findings: [], evidence: [] })
    expect(await archCodes((a) => { named(a); a.adrs[1].strategy = 'S-3' })).toEqual(['adr-strategy']) // slot 2 names S-3
    expect(await archCodes((a) => { named(a); a.adrs[1].strategy = 'S-1' })).toEqual(['adr-strategy']) // two Adrs on one S-n: the second is off its slot
    expect(await archCodes((a) => { named(a); a.architecture.strategy = a.architecture.strategy.filter((x: any) => x.id !== 'S-2') })).toEqual(['adr-strategy']) // accepted on a dropped S-n
    // a superseded Adr on a dropped S-n is the slot rule working; one on a live S-n leaves that strategy unbacked
    const dropped = structuredClone(archExample())
    named(dropped)
    dropped.architecture = { ...dropped.architecture, strategy: dropped.architecture.strategy.filter((x: any) => x.id !== 'S-2'), decisions: [adrIds[0]] }
    dropped.adrs[1] = { ...dropped.adrs[1], status: 'superseded' }
    expect((await adapter({ id: ++id, op: 'evaluate', payload: archPayload(dropped) })).result.passed).toBe(true)
    expect(await archCodes((a) => { named(a); a.architecture.decisions = [adrIds[0]]; a.adrs[1] = { ...a.adrs[1], status: 'superseded' } })).toEqual(['adr-strategy'])
    const unnamed = structuredClone(archExample()) // no strategy named: nothing to hold to a slot
    expect((await adapter({ id: ++id, op: 'evaluate', payload: archPayload(unnamed) })).result.passed).toBe(true)
    // a dropped strategy's slot: superseded, evaluated, not listed, not refused
    const r = await adapter({ id: ++id, op: 'evaluate', payload: archPayload({ ...archExample(), architecture: { ...content('Architecture'), decisions: [adrIds[0]] }, adrs: [adrs()[0], { ...adrs()[1], status: 'superseded' }] }) })
    expect(r.result).toEqual({ passed: true, findings: [], evidence: [] })
  })
  it('fails ids out of sequence', async () => {
    expect(await archCodes((a) => (a.architecture.strategy[1].id = 'S-1'))).toEqual(['id-sequence'])
  })
})

describe('sdd/v1 over a DomainModel: coverage', () => {
  // domain-coverage (29-design-process.md): every name the model owns has a Design element realising it, or is unrealised, a warning
  const ref = (kind: string, id: string) => ({ apiVersion: 'sdd.persimmon.ai/v1', kind, namespace: 'default', id, revision: 1 })
  const coveragePayload = (domainModel: unknown, designs: { id: string; content: unknown }[], modelId = 'expenses-model') => ({
    ...payload({ domainModel }),
    inputs: { domainModel: { kind: 'artifact', ref: ref('DomainModel', modelId) }, designs: { kind: 'artifacts', refs: designs.map((d) => ref('Design', d.id)) } },
    artifacts: { domainModel: { content: domainModel, provenance }, designs: designs.map((d) => ({ content: d.content, provenance })) },
  })
  const findings = async (domainModel: unknown, designs: { id: string; content: unknown }[], modelId?: string) => {
    const r = await adapter({ id: ++id, op: 'evaluate', payload: coveragePayload(domainModel, designs, modelId) })
    return r.result as { passed: boolean; findings: { severity: string; code: string; message: string }[] }
  }

  it('reports every own name of the model no Design realises, as warnings on a pass', async () => {
    const r = await findings(content('DomainModel'), [{ id: 'claims-api', content: content('Design') }])
    expect(r.passed).toBe(true)
    expect(r.findings.every((f) => (f.severity === 'warning' && f.code === 'unrealised') || (f.severity === 'info' && f.code === 'unrealised-internal'))).toBe(true)
    const names = r.findings.map((f) => f.message.split(': ')[0])
    expect(names.filter((n) => n.startsWith('command '))).toEqual(['command Set Risk Flag', 'command Export Claim']) // the API forgot one, another block owns one
    // Export Claim is what the Export Policy invokes: the system's own reaction, noted as internal, not a gap
    expect(r.findings.filter((f) => f.code === 'unrealised-internal').map((f) => f.message)).toEqual(['command Export Claim: invoked by Export Policy; no Design of expenses-model realises it, a handler does'])
    // an event an external system emits reaches the model from outside: noted the same way
    const outside = structuredClone(content('DomainModel'))
    outside.externalSystems = [{ name: 'Ledger', emits: [outside.events[0].name] }]
    expect((await findings(outside, [])).findings.find((f) => f.message.startsWith(`event ${outside.events[0].name}:`))).toEqual({ severity: 'info', code: 'unrealised-internal', message: `event ${outside.events[0].name}: emitted by Ledger, outside the model; no Design of expenses-model publishes it` })
    expect(names.filter((n) => n.startsWith('readModel '))).toEqual(['readModel Export Status View'])
    expect(names.filter((n) => n.startsWith('aggregate '))).toEqual(['aggregate AG-1', 'aggregate AG-2', 'aggregate AG-3']) // no data-schema Design yet
    expect(names.filter((n) => n.startsWith('event ')).length).toBe(content('DomainModel').events.length) // no async-api Design yet
    expect(r.findings[0].message).toBe('command Set Risk Flag: no Design of expenses-model realises it')
  })

  it('reads only the Designs that name the model: a ui Design and a Design of another model add nothing', async () => {
    const other = { ...content('Design'), domainModel: 'other-model' }
    const ui = { title: 'screens', type: 'ui', elements: [{ id: 'EL-1', name: 'My Claims', realises: { kind: 'command', name: 'Set Risk Flag' } }] } // no domainModel: not read, whatever it realises
    const all = await findings(content('DomainModel'), [])
    const same = await findings(content('DomainModel'), [{ id: 'other', content: other }, { id: 'ui', content: ui }])
    expect(same.findings).toEqual(all.findings)
    const full = { ...content('Design'), elements: [...content('Design').elements, { id: 'EL-10', name: 'POST /x', realises: { kind: 'command', name: 'Set Risk Flag' } }] }
    expect((await findings(content('DomainModel'), [{ id: 'claims-api', content: full }])).findings.map((f) => f.message)).not.toContain('command Set Risk Flag: no Design of expenses-model realises it')
    const twice = structuredClone(content('DomainModel'))
    twice.aggregates[1].commands.push('Export Claim') // one label on two aggregates: one warning
    expect((await findings(twice, [])).findings.filter((f) => f.message.startsWith('command Export Claim')).length).toBe(1)
  })

  it('fails content that is not a DomainModel', async () => {
    const r = await findings({ title: 'x' }, [])
    expect(r).toMatchObject({ passed: false, findings: [{ code: 'not-a-domainmodel' }] })
  })
})
