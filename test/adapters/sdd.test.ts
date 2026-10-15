// The evaluator Adapter over stdio (19-adapter-roles.md): the Spec of the worked example against the artifacts it
// cites (23-pack-sdlc.md), and one mutation per finding code.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'
import { checkDesign } from '../../adapters/sdd/check.mjs'

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

  it('fails a capability in another context than the BusinessRules', async () => {
    expect(await prdCodes((a) => { a.prd.capabilities[1].context = 'payments' })).toEqual(['context-mismatch'])
    // one BusinessRules per product (33-multi-context-product.md): with two contexts every rule is tagged, and a capability cites its own context's rules
    expect(await prdCodes((a) => { a.rules.contexts = ['expenses', 'payments'] })).toEqual(Array(content('BusinessRules').rules.length).fill('context-mismatch')) // every rule untagged
    const two = structuredClone(prdExample())
    two.rules.contexts = ['expenses', 'payments']
    for (const r of two.rules.rules) r.context = 'expenses'
    expect((await adapter({ id: ++id, op: 'evaluate', payload: payload(two) })).result).toEqual({ passed: true, findings: [], evidence: [] })
    // a rule of the other context: one finding per capability citing it; a tag outside contexts: the rule and every citation
    expect(new Set(await prdCodes((a) => { a.rules.contexts = ['expenses', 'payments']; for (const r of a.rules.rules) r.context = 'expenses'; a.rules.rules[0].context = 'payments' }))).toEqual(new Set(['context-mismatch']))
    expect(new Set(await prdCodes((a) => { a.rules.rules[0].context = 'ghost' }))).toEqual(new Set(['context-mismatch']))
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

  it('fails a DomainModel of another context than the capability', async () => {
    expect(await codes((a) => { a.domainModel.context = 'payments' })).toEqual(['context-mismatch'])
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
        const all = checkDesign({ design: c, architecture, domainModel, rules, designs, designSystem, ids: { designSystem: c.designSystem } })
        const found = all.filter((x: { code: string }) => /^(document-|element-unbacked|dialect|action-)/.test(x.code))
        expect({ file: f, id: d.spec.identity.id, found }).toEqual({ file: f, id: d.spec.identity.id, found: [] })
        const layout = all.filter((x: { code: string }) => x.code === 'layout-unknown').length
        if (c.type === 'ui') expect({ file: f, id: d.spec.identity.id, layoutWarnings: layout > 0 }).toEqual({ file: f, id: d.spec.identity.id, layoutWarnings: f.includes('example08') }) // example07's Layouts name the DesignSystem only; example08's name fields too (32-ui-design-process.md)
      }
      const rulesId = byKind('BusinessRules')[0]?.spec.identity.id
      for (const d of all.filter((x) => ['Prd', 'Spec', 'Design', 'Architecture'].includes(x.kind))) expect({ file: f, id: d.spec.identity.id, businessRules: d.spec.content.businessRules }).toEqual({ file: f, id: d.spec.identity.id, businessRules: rulesId })
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
    expect(await archCodes((a) => (a.prd.capabilities[0].context = 'payroll'))).toEqual(['prd-context-unread'])
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
