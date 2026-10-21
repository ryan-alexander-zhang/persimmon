// End to end on SQLite: spec-one with the writer and the auditor both human by Namespace overrides (23-pack-sdlc.md).
// spec-gate runs spec-consistency, then spec-audited once it passed: an answer whose passed disagrees with its findings is
// refused, an error refuses the round and reaches the writer, a warning passes.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, parseAllDocuments, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'

const domain = parseAllDocuments(readFileSync('docs/design/examples/sdlc-domain.yaml', 'utf8')).map((d) => d.toJS())
const one = (kind: string) => domain.find((d) => d.kind === kind)

describe('scenario: a draft audited before it passes', () => {
  let dir: string
  let out: string[]
  const cli = () => ({ cwd: dir, out: (l: string) => out.push(l), err: (l: string) => out.push(`ERR ${l}`) })
  const run = (...argv: string[]) => runCli(argv, cli())
  const file = (name: string, docs: unknown[]) => {
    const p = join(dir, name)
    writeFileSync(p, docs.map((d) => stringify(d)).join('---\n'))
    return p
  }
  const ref = (kind: string, id: string) => `{kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: ${kind}, id: ${id}, revision: 1}}`
  const inbox = () => readdirSync(join(dir, '.persimmon', 'inbox')).map((f) => f.replace(/\.yaml$/, ''))
  const form = (t: string) => parse(readFileSync(join(dir, '.persimmon', 'inbox', `${t}.yaml`), 'utf8'))
  const human = (name: string) => ({ apiVersion: 'persimmon.ai/v1', kind: 'Executor', metadata: { name, namespace: 'default' }, spec: { type: 'human', adapter: 'cli-human/v1', configuration: {} } })
  const answer = (t: string, name: string, outputs: unknown) => run('complete', t, '--file', file(name, [{ outputs }]))
  const audit = (findings: unknown[], passed = !findings.some((f) => (f as { severity: string }).severity === 'error')) => ({ audit: { kind: 'value', value: { passed, findings, evidence: [] } } })
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-audit-'))
    out = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('spec-gate: the auditor after the check; an error goes back to the writer, a warning passes', { timeout: 60_000 }, async () => {
    expect(await run('init')).toBe(0)
    for (const [i, doc] of ['Prd', 'BusinessRules', 'DomainModel', 'Architecture', 'Glossary', 'BoundedContext'].map(one).entries()) expect(await run('create', file(`up-${i}.yaml`, [doc]))).toBe(0)
    expect(await run('apply', file('humans.yaml', [human('spec-agent'), human('auditor')]), '-n', 'default')).toBe(0)
    out = []
    expect(await run('run', 'spec-one', '--input', `prd=${ref('Prd', 'expense-claims')}`, '--input', 'capabilityId=CAP-1', '--input', `architecture=${ref('Architecture', 'expense-claims-architecture')}`, '--input', `domainModel=${ref('DomainModel', 'expenses-model')}`,
      '--input', `glossary=${ref('Glossary', 'expenses-glossary')}`, '--input', `rules=${ref('BusinessRules', 'expenses-rules')}`, '--input', `context=${ref('BoundedContext', 'expenses')}`, '--follow')).toBe(0)
    const spec = one('Spec').spec.content
    expect(await answer(inbox()[0]!, 's1.yaml', { spec, open: { kind: 'value', value: [] } })).toBe(0)
    const [auditor] = inbox()
    expect(form(auditor!).reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'Spec', 'Prd', 'BusinessRules', 'DomainModel', 'Architecture', 'Glossary']) // asked only once the check passed
    const unfit = [{ severity: 'error', code: 'ac-undecidable', message: 'AC-1: given names no amount' }]
    out = []
    expect(await answer(auditor!, 'lie.yaml', audit(unfit, true))).not.toBe(0) // passed beside an error is refused, never a pass
    expect(inbox()).toEqual([auditor])
    out = []
    expect(await answer(auditor!, 'a1.yaml', audit(unfit))).toBe(0)
    const [writer] = inbox()
    expect(form(writer!).inputs.feedback.value.results.audit).toMatchObject({ passed: false, findings: [{ code: 'ac-undecidable' }] }) // the writer reads it
    expect(await answer(writer!, 's2.yaml', { spec, open: { kind: 'value', value: [] } })).toBe(0)
    const round2 = form(inbox()[0]!)
    expect(round2.reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'Spec', 'Prd', 'BusinessRules', 'DomainModel', 'Architecture', 'Glossary', 'Spec']) // the last round's Spec beside the draft
    expect(round2.inputs.feedback.value.results.audit.findings).toMatchObject([{ code: 'ac-undecidable' }]) // and what the last audit named: only that, or a change, may block
    out = []
    expect(await answer(inbox()[0]!, 'a2.yaml', audit([{ severity: 'warning', code: 'scope-doubt', message: 'AC-2: beyond CAP-1' }]))).toBe(0)
    expect(out.find((l) => l.startsWith('WorkflowRun   spec-one-'))).toMatch(/Succeeded/)
  })

  it('prd-gate: the human confirms only a Prd the check and the auditor passed', { timeout: 60_000 }, async () => {
    expect(await run('init')).toBe(0)
    expect(await run('apply', file('humans.yaml', [human('prd-agent'), human('auditor')]), '-n', 'default')).toBe(0)
    out = []
    expect(await run('run', 'author-prd', '--input', 'brief=Employees claim expenses.', '--input', 'productId=expense-claims', '--follow')).toBe(0)
    const draft = { prd: { ...one('Prd').spec.content, businessRules: 'expense-claims-rules' }, rules: one('BusinessRules').spec.content }
    expect(await answer(inbox()[0]!, 'p1.yaml', draft)).toBe(0)
    const [auditor] = inbox()
    expect(form(auditor!).reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'Prd', 'BusinessRules'])
    expect(await answer(auditor!, 'a1.yaml', audit([{ severity: 'error', code: 'rule-misplaced', message: 'BR-1: constrains nothing CAP-2 does' }]))).toBe(0)
    const [writer] = inbox() // refused before the human: no confirm-prd form
    expect(form(writer!).inputs.feedback.value.results).toMatchObject({ audit: { findings: [{ code: 'rule-misplaced' }] }, confirmed: { findings: [{ code: 'skipped' }] } })
    expect(await answer(writer!, 'p2.yaml', draft)).toBe(0)
    expect(await answer(inbox()[0]!, 'a2.yaml', audit([{ severity: 'warning', code: 'vague-term', message: 'SC-1: "quickly"' }]))).toBe(0)
    const [human2] = inbox()
    expect(form(human2!).reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'Prd', 'BusinessRules']) // confirm-prd with the owner's rules, after both
    expect(form(human2!).inputs.audit.value).toMatchObject({ passed: true, findings: [{ code: 'vague-term' }] }) // the auditor's warning, in the human's form (fromValidator)
    out = []
    expect(await answer(human2!, 'c.yaml', { result: { kind: 'value', value: { passed: true, findings: [], evidence: [] } } })).toBe(0)
    expect(out.find((l) => l.startsWith('WorkflowRun   author-prd-'))).toMatch(/Succeeded/)
  })

  it('architecture-gate: a refusing auditor skips the human', { timeout: 60_000 }, async () => {
    expect(await run('init')).toBe(0)
    for (const [i, doc] of ['Prd', 'BusinessRules', 'DomainModel', 'Architecture', 'Glossary', 'BoundedContext'].map(one).concat(domain.filter((d) => d.kind === 'Adr')).entries()) expect(await run('create', file(`up-${i}.yaml`, [doc]))).toBe(0)
    const kinds = { architecture: 'Architecture', adrs: 'Adr*', prd: 'Prd', rules: 'BusinessRules', contexts: 'BoundedContext*', domainModels: 'DomainModel*', glossaries: 'Glossary*' }
    const type = (k: string) => ({ kind: k.endsWith('*') ? 'artifacts' : 'artifact', artifactKind: { apiVersion: 'sdd.persimmon.ai/v1', kind: k.replace('*', '') } })
    const judge = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'judge' }, spec: {
      inputs: Object.fromEntries(Object.entries(kinds).map(([n, k]) => [n, { type: type(k) }])), outputs: { passed: { type: { kind: 'value', schema: { type: 'boolean' } } } }, outputBindings: { passed: { expression: 'steps.gate.outputs.result.passed' } },
      entry: ['gate'], steps: [{ id: 'gate', uses: { kind: 'Gate', name: 'architecture-gate' }, inputs: Object.fromEntries(Object.keys(kinds).map((n) => [n, { fromInput: n }])), timeout: '72h' }],
      transitions: [{ id: 'done', from: [{ stepRef: 'gate', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '73h' } }
    expect(await run('apply', file('judge.yaml', [judge, human('auditor')]), '-n', 'default')).toBe(0)
    const many = (k: string, ids: string[]) => `{kind: artifacts, refs: [${ids.map((id) => `{apiVersion: sdd.persimmon.ai/v1, kind: ${k}, id: ${id}, revision: 1}`).join(', ')}]}`
    out = []
    expect(await run('run', 'judge', '--input', `architecture=${ref('Architecture', 'expense-claims-architecture')}`, '--input', `adrs=${many('Adr', ['adr-receipts-as-blobs', 'adr-routing-in-core'])}`, '--input', `prd=${ref('Prd', 'expense-claims')}`, '--input', `rules=${ref('BusinessRules', 'expenses-rules')}`,
      '--input', `contexts=${many('BoundedContext', ['expenses'])}`, '--input', 'domainModels={kind: artifacts, refs: []}', '--input', `glossaries=${many('Glossary', ['expenses-glossary'])}`, '--follow')).toBe(0)
    const [auditor] = inbox()
    expect(form(auditor!).reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'Architecture', 'Adr', 'Adr', 'Prd', 'BusinessRules'])
    out = []
    expect(await answer(auditor!, 'a1.yaml', audit([{ severity: 'error', code: 'scenario-undecidable', message: 'QS-1: no threshold' }]))).toBe(0)
    expect(inbox()).toEqual([]) // the human is never asked
    expect(out.find((l) => l.startsWith('WorkflowRun   judge-'))).toMatch(/Succeeded/)
  })

  it('design-gate: the auditor reads a Design beside its DomainModel; a warning passes', { timeout: 60_000 }, async () => {
    expect(await run('init')).toBe(0)
    for (const [i, doc] of ['Design', 'Architecture', 'BusinessRules', 'DomainModel', 'Glossary'].map(one).entries()) expect(await run('create', file(`up-${i}.yaml`, [doc]))).toBe(0)
    expect(await run('apply', file('humans.yaml', [human('auditor')]), '-n', 'default')).toBe(0)
    out = []
    expect(await run('run', 'design-check', '--input', `design=${ref('Design', 'claims-api')}`, '--input', `architecture=${ref('Architecture', 'expense-claims-architecture')}`, '--input', `rules=${ref('BusinessRules', 'expenses-rules')}`,
      '--input', `domainModel=${ref('DomainModel', 'expenses-model')}`, '--input', `glossary=${ref('Glossary', 'expenses-glossary')}`, '--follow')).toBe(0)
    const [auditor] = inbox()
    expect(form(auditor!).reading.map((r: { kind: string }) => r.kind)).toEqual(['Prompt', 'Design', 'Architecture', 'BusinessRules', 'DomainModel']) // no API Designs bound: none read
    out = []
    expect(await answer(auditor!, 'a1.yaml', audit([{ severity: 'warning', code: 'contract-gap', message: 'EL-1: no 409 defined' }]))).toBe(0)
    expect(out.find((l) => l.startsWith('WorkflowRun   design-check-'))).toMatch(/Succeeded/)
    expect(out.join('\n')).toContain('contract-gap')
  })
})
