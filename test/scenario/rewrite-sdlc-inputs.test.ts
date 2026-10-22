// The SDLC pack inputs the Rewrite pack needs (40-pack-rewrite.md, 26-domain-discovery.md, 31-architecture-process.md): an
// inventory handed to every storming phase, a base for the first phase and for the architect, all optional, so a product
// from an idea runs as before. The pack's admission is cli.test.ts's `validate`; here, that each input is wired through.
import { readFileSync } from 'node:fs'
import { parseAllDocuments } from 'yaml'
import { describe, expect, it } from 'vitest'
import { bind, siteOf } from '../../src/kinds/ports/ports.js'

const docs = (f: string) => parseAllDocuments(readFileSync(`packs/sdlc/global/${f}.yaml`, 'utf8')).map((d) => d.toJS())
const all = [...docs('50-tasks'), ...docs('60-validators'), ...docs('70-gates'), ...docs('80-workflows')]
const named = (kind: string, name: string) => all.find((d) => d.kind === kind && d.metadata.name === name).spec

describe('the SDLC pack takes a Rewrite pack inventory and base, optionally', () => {
  it('event-storm takes the inventory as an optional value naming no other pack\'s kind', () => {
    const storm = named('Task', 'event-storm')
    expect(storm.inputs.inventory).toMatchObject({ type: { kind: 'value', schema: { type: 'object' } }, required: false })
    expect(storm.action.instructions).toMatch(/With `inventory` bound/)
  })

  it('every storming loop hands the inventory to produce; the big-picture loop also takes a base', () => {
    for (const loop of ['storm-big-picture', 'storm-process', 'storm-design']) {
      const spec = named('ReviewLoop', loop)
      expect({ loop, input: spec.inputs.inventory.required, bound: spec.produce.inputs.inventory }).toEqual({ loop, input: false, bound: { fromInput: 'inventory' } })
    }
    const big = named('ReviewLoop', 'storm-big-picture')
    expect([big.inputs.base.required, big.produce.inputs.base]).toEqual([false, { fromInput: 'base' }])
  })

  it('domain-discovery hands the inventory to every storming phase and its base to the first', () => {
    const pipeline = named('Pipeline', 'domain-discovery')
    expect([pipeline.inputs.inventory.required, pipeline.inputs.base.required]).toEqual([false, false])
    const phase = (id: string) => pipeline.phases.find((p: { id: string }) => p.id === id).inputs
    // a Pipeline's phases are its steps verbatim (21-composition.md), so an optional input it may lack is omitted here, not by expansion
    for (const id of ['big-picture', 'process', 'design']) expect({ id, inventory: phase(id).inventory }).toEqual({ id, inventory: { fromInput: 'inventory', onMissing: 'omit' } })
    expect(phase('big-picture').base).toEqual({ fromInput: 'base', onMissing: 'omit' })
    expect(phase('process').base).toEqual({ fromStep: { stepRef: 'big-picture', output: 'model' } }) // the later phases still start from the one before
  })

  it('domain-discovery binds every phase, and derive-all its step, without rules, inventory or base', () => {
    const pipeline = named('Pipeline', 'domain-discovery')
    const ref = (kind: string) => ({ kind: 'artifact' as const, ref: { apiVersion: 'sdd.persimmon.ai/v1', kind, id: 'p', revision: 1 } })
    const model = { outputs: { model: ref('EventStorming'), contexts: { kind: 'value' as const, value: ['c1'] } } }
    const sources = { inputs: { prd: ref('Prd'), model: ref('EventStorming'), contexts: model.outputs.contexts }, state: { index: { kind: 'value' as const, value: 1 } }, steps: { 'big-picture': model, process: model, design: model } }
    const derive = named('Workflow', 'derive-all')
    const at = siteOf({ inputs: derive.inputs, state: derive.steps[0].repeat.state })
    // a Workflow's steps and a Pipeline's phases bind as written: an optional input reaches them only with onMissing: omit
    for (const p of pipeline.phases) expect({ id: p.id, rules: 'rules' in bind(p.inputs, sources, siteOf({})) }).toEqual({ id: p.id, rules: false })
    for (const s of derive.steps) expect({ id: s.id, rules: 'rules' in bind(s.inputs, sources, at) }).toEqual({ id: s.id, rules: false })
  })

  it('write-architecture and architect take the product\'s last Architecture and Adrs as an optional base', () => {
    const task = named('Task', 'write-architecture')
    expect([task.inputs.base.required, task.inputs.baseAdrs.required]).toEqual([false, false])
    expect(task.action.context).toEqual(expect.arrayContaining([{ kind: 'artifact', input: 'base' }, { kind: 'artifact', input: 'baseAdrs' }]))
    const loop = named('ReviewLoop', 'architect')
    expect([loop.produce.inputs.base, loop.produce.inputs.baseAdrs]).toEqual([{ fromInput: 'base' }, { fromInput: 'baseAdrs' }])
    expect([task.inputs.changes.required, loop.inputs.changes.required, loop.produce.inputs.changes]).toEqual([false, false, { fromInput: 'changes' }]) // a downstream answer is applied to base, as a Spec's is
    expect(task.action.instructions).toMatch(/With `base` and `changes` bound/)
  })

  it('the Architecture\'s auditor takes the same base, through the gate, so round one judges what changed', () => {
    const task = named('Task', 'audit-architecture')
    expect([task.inputs.base.required, task.inputs.baseAdrs.required]).toEqual([false, false])
    expect(task.action.context).toEqual(expect.arrayContaining([{ kind: 'artifact', input: 'base' }, { kind: 'artifact', input: 'baseAdrs' }]))
    expect(task.action.instructions).toMatch(/With `base` bound/)
    const confirm = named('Task', 'confirm-architecture') // the owner too: a revision from answers is confirmed for what changed
    expect([confirm.inputs.base.required, confirm.inputs.baseAdrs.required]).toEqual([false, false])
    expect(named('Validator', 'architecture-confirmed').inputs.base.required).toBe(false)
    const validator = named('Validator', 'architecture-audited')
    expect([validator.inputs.base.required, validator.inputs.baseAdrs.required]).toEqual([false, false])
    const gate = named('Gate', 'architecture-gate')
    expect([gate.inputs.base.required, gate.inputs.baseAdrs.required]).toEqual([false, false])
    const loop = named('ReviewLoop', 'architect')
    expect([loop.review.inputs.base, loop.review.inputs.baseAdrs]).toEqual([{ fromInput: 'base' }, { fromInput: 'baseAdrs' }])
    // the gate's validators bind as written: the audit gets the base when bound and binds as before when not
    const audit = gate.validators.find((v: { name: string }) => v.name === 'audit').inputs
    const ref = (kind: string) => ({ kind: 'artifact' as const, ref: { apiVersion: 'sdd.persimmon.ai/v1', kind, id: 'p', revision: 1 } })
    const adrs = { kind: 'artifacts' as const, refs: [ref('Adr').ref] }
    const round = { architecture: ref('Architecture'), adrs, prd: ref('Prd'), rules: ref('BusinessRules') }
    expect(Object.keys(bind(audit, { inputs: round }, siteOf({})))).toEqual(['architecture', 'adrs', 'prd', 'rules'])
    const based = bind(audit, { inputs: { ...round, base: ref('Architecture'), baseAdrs: adrs } }, siteOf({}))
    expect([based.base, based.baseAdrs]).toEqual([ref('Architecture'), adrs])
  })

  it('an earlier round\'s decision stays decided for the owner, reopened only on evidence', () => {
    const prompts = parseAllDocuments(readFileSync('packs/sdlc/global/30-prompts.yaml', 'utf8')).map((d) => d.toJS())
    for (const name of ['owner-review', 'owner-decisions']) {
      const content: string = prompts.find((d) => d.metadata.name === name).spec.content
      expect(content).toMatch(/stays decided/)
      expect(content).toMatch(/smallest change/)
      expect(content).toMatch(/edge the Prd never asked for is no reason/)
    }
  })

  it('a Spec, Design, Plan or TestDesign draft checks itself before the owner and the Gate', () => {
    for (const [draft, check, port] of [['spec-draft', 'spec-check', 'spec'], ['design-draft', 'design-check', 'design'], ['plan-draft', 'plan-check', 'plan'], ['test-design-draft', 'test-design-check', 'testDesign']]) {
      const wf = named('Workflow', draft!)
      expect(wf.steps.map((s: { id: string }) => s.id)).toEqual(['write', 'decide', 'record', 'check', 'fix'])
      expect(wf.steps[3].uses).toEqual({ kind: 'Gate', name: check })
      expect(wf.steps[4].inputs.feedback).toEqual({ fromStep: { stepRef: 'check', output: 'result' } })
      expect(wf.steps[4].inputs.previous).toEqual({ first: [{ fromStep: { stepRef: 'record', output: port } }, { fromStep: { stepRef: 'write', output: port } }] }) // the last draft written
      expect(wf.transitions.find((t: { id: string }) => t.id === 'after-record').to).toEqual([{ stepRef: 'check' }])
      expect(wf.transitions.find((t: { id: string }) => t.id === 'after-check').to[0]).toEqual({ stepRef: 'fix', when: '!steps.check.outputs.result.passed' })
      expect(named('Gate', check!).validators.map((v: { name: string }) => v.name)).toEqual(['consistency'])
    }
  })

  it('a writer with base and changes applies upstream parts revised since base, not only downstream answers', () => {
    const prompts = parseAllDocuments(readFileSync('packs/sdlc/global/30-prompts.yaml', 'utf8')).map((d) => d.toJS())
    for (const name of ['spec-rules', 'design-rules', 'plan-rules', 'harness-rules']) {
      const content: string = prompts.find((d) => d.metadata.name === name).spec.content
      expect(content).toMatch(/<artifact id> <part id>: <what changed>/)
    }
  })
})
