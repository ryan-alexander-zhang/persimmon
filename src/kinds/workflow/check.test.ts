import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'
import type { Closure } from '../../snapshot/walk.js'
import { fromClosure } from '../deps.js'
import { checkWorkflow, contractPorts, type Resolve } from './check.js'
import type { Workflow } from './types.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const closure = example('snapshot-closure') as Closure
const gateResult = { kind: 'value' as const, schema: { $ref: 'persimmon.ai/v1#/GateResult' } }
const prd = { kind: 'artifact' as const, artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } }
const report = { kind: 'artifact' as const, artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport' } }
const contract = (runKind: string) => ({ inputsPath: 'spec.inputs', outputsPath: 'spec.outputs', runKind: { group: 'persimmon.ai', kind: runKind }, phasePath: 'status.phase', outputsValuePath: 'status.outputs', errorPath: 'status.error' })

const resolve: Resolve = (ref) => {
  const def = fromClosure(closure, ref.kind, 'demo', ref.name)
  if (def) return { contract: contract('TaskRun'), inputs: contractPorts(def.spec, 'inputs'), outputs: contractPorts(def.spec, 'outputs') }
  const extra: Record<string, { inputs: Record<string, unknown>; outputs: Record<string, unknown> }> = {
    'Task/security-review': { inputs: { prd: { type: prd } }, outputs: { report: { type: report } } },
    'Task/product-review': { inputs: { prd: { type: prd } }, outputs: { report: { type: report } } },
    'Gate/prd-approval-gate': { inputs: { prd: { type: prd }, security: { type: report, required: false }, product: { type: report, required: false } }, outputs: { result: { type: gateResult } } },
    'Task/plan-them': { inputs: { research: { type: { kind: 'artifacts', artifactKind: report.artifactKind } } }, outputs: { prd: { type: prd } } },
    'Task/handle-item': { inputs: { item: { type: { kind: 'value', schema: { type: 'string' } } } }, outputs: { echo: { type: { kind: 'value', schema: { type: 'string' } } } } },
    'Workflow/prd-review-round': { inputs: { prd: { type: prd }, research: { type: report } }, outputs: { prd: { type: prd }, accepted: { type: { kind: 'value', schema: { type: 'boolean' } } } } },
  }
  const e = extra[`${ref.kind}/${ref.name}`]
  return e ? ({ contract: contract(ref.kind === 'Gate' ? 'GateRun' : 'WorkflowRun'), ...e } as never) : undefined
}

describe('checkWorkflow', () => {
  it.each(['workflow-prd-create', 'workflow-review-loop', 'workflow-fan-in'])('%s passes every static rule', (n) => {
    expect(checkWorkflow((example(n) as Workflow).spec, resolve)).toEqual([])
  })

  const linear = () => (example('workflow-prd-create') as Workflow).spec

  it('catches graph mistakes', () => {
    const s = linear()
    s.entry = ['write-prd']
    expect(checkWorkflow(s, resolve).map((f) => f.message)).toEqual(['entry must equal the zero in-degree set research'])
    const cyc = linear()
    cyc.transitions[1]!.to = [{ stepRef: 'research' }]
    cyc.entry = []
    const msgs = checkWorkflow(cyc, resolve).map((f) => f.message)
    expect(msgs.some((m) => m.startsWith('cycle'))).toBe(true)
    const twice = linear()
    twice.transitions.push({ id: 'again', from: [{ stepRef: 'research', outcomes: ['Failed'] }], to: [{ terminal: 'Failed', reason: 'x' }] })
    expect(checkWorkflow(twice, resolve).map((f) => f.message)).toContain('step research is from of 2 transitions; exactly one required')
    const mixed = linear()
    mixed.transitions[0]!.to.push({ terminal: 'Succeeded' })
    expect(checkWorkflow(mixed, resolve).map((f) => f.message)).toContain('dispatch all: steps only, or one terminal')
  })

  it('catches port mistakes', () => {
    const s = linear()
    s.steps[1]!.inputs = { research: { fromStep: { stepRef: 'write-prd', output: 'prd' } } }
    expect(checkWorkflow(s, resolve).map((f) => f.message)).toEqual(['step write-prd is not a predecessor', 'producer type differs from consumer type'])
    const t = linear()
    t.steps[1]!.inputs = { research: { fromInput: 'repository' } }
    expect(checkWorkflow(t, resolve).map((f) => f.message)).toEqual(['producer type differs from consumer type'])
    // fromArtifact: the kind is the producer type, the id expression must be a string at the site
    const byId = linear()
    byId.steps[1]!.inputs = { research: { fromArtifact: { kind: report.artifactKind, id: '"research-" + inputs.repository.id' } } }
    expect(checkWorkflow(byId, resolve).map((f) => f.message)).toEqual([])
    byId.steps[1]!.inputs = { research: { fromArtifact: { kind: prd.artifactKind, id: 'inputs.repository.id' } } }
    expect(checkWorkflow(byId, resolve).map((f) => f.message)).toEqual(['producer type differs from consumer type'])
    byId.steps[1]!.inputs = { research: { fromArtifact: { kind: report.artifactKind, id: 'inputs.nope' } } }
    expect(checkWorkflow(byId, resolve).map((f) => f.message)).toEqual([expect.stringMatching(/^fromArtifact id: /)])
    byId.steps[1]!.inputs = { research: { fromArtifact: { kind: report.artifactKind, id: '1 + 1' } } }
    expect(checkWorkflow(byId, resolve).map((f) => f.message)).toEqual(['fromArtifact id is int, not string'])
    // fromQuery: an artifacts list of its kind, `where` a bool over the site and `content`
    const byQuery = linear()
    byQuery.steps[1]!.uses = { kind: 'Task', name: 'plan-them' }
    byQuery.steps[1]!.inputs = { research: { fromQuery: { kind: report.artifactKind, where: 'content.repository == inputs.repository.id' } } }
    expect(checkWorkflow(byQuery, resolve).map((f) => f.message)).toEqual([])
    byQuery.steps[1]!.inputs = { research: { fromQuery: { kind: prd.artifactKind, where: 'true' } } }
    expect(checkWorkflow(byQuery, resolve).map((f) => f.message)).toEqual(['producer type differs from consumer type'])
    byQuery.steps[1]!.inputs = { research: { fromQuery: { kind: report.artifactKind, where: 'inputs.nope' } } }
    expect(checkWorkflow(byQuery, resolve).map((f) => f.message)).toEqual([expect.stringMatching(/^fromQuery where: /)])
    byQuery.steps[1]!.inputs = { research: { fromQuery: { kind: report.artifactKind, where: 'inputs.repository.id' } } }
    expect(checkWorkflow(byQuery, resolve).map((f) => f.message)).toEqual(['fromQuery where is string, not bool'])
    byId.steps[1]!.inputs = { research: { fromQuery: { kind: report.artifactKind, where: 'true' } } }
    expect(checkWorkflow(byId, resolve).map((f) => f.message)).toEqual(['producer type differs from consumer type']) // a list into one artifact
    const u = linear()
    u.steps[1]!.inputs = {}
    expect(checkWorkflow(u, resolve).map((f) => f.message)).toEqual(['required input research unbound'])
    const v = linear()
    v.outputBindings = { prd: { fromStep: { stepRef: 'write-prd', output: 'prd' } }, extra: { literal: 1 } }
    expect(checkWorkflow(v, resolve).map((f) => f.message)).toEqual(['keys must equal outputs keys', 'unknown port extra'])
    const w = linear()
    w.steps[1]!.inputs!.research!.onMissing = 'omit'
    expect(checkWorkflow(w, resolve).map((f) => f.message)).toEqual(['onMissing: omit only on optional inputs'])
  })

  it('state is in scope for a repeat body input and next, nowhere else', () => {
    const perItem = (expr: string, repeat: boolean, until = 'iteration.index >= inputs.items.size()') =>
      ({
        inputs: { items: { type: { kind: 'value', schema: { type: 'array', items: { type: 'string' } } } } },
        entry: ['each'],
        steps: [{
          id: 'each', uses: { kind: 'Task', name: 'handle-item' }, timeout: '1h', inputs: { item: { expression: expr } },
          ...(repeat ? { repeat: {
            state: { index: { type: { kind: 'value', schema: { type: 'integer' } } }, items: { type: { kind: 'value', schema: { type: 'array', items: { type: 'string' } } } } },
            initial: { index: { literal: 1 }, items: { fromInput: 'items' } },
            next: { index: { expression: 'state.index + 1' }, items: { fromState: 'items' } },
            until, maxIterations: 10,
          } } : {}),
        }],
        transitions: [{ id: 'done', from: [{ stepRef: 'each', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }],
        timeout: '2h',
      }) as unknown as Workflow['spec']
    expect(checkWorkflow(perItem('state.items[state.index - 1]', true), resolve)).toEqual([])
    expect(checkWorkflow(perItem('state.items[state.index - 1]', false), resolve).map((f) => f.message)[0]).toMatch(/^expression: Unknown variable: state/)
    expect(checkWorkflow(perItem("state.index + 'x'", true), resolve).map((f) => f.message)[0]).toMatch(/^expression: /) // state carries its declared InputSpec type
    expect(checkWorkflow(perItem('state.items[state.index - 1]', true, 'state.index >= 2'), resolve).map((f) => f.message)[0]).toMatch(/^until: Unknown variable: state/)
    const byExpression = perItem('state.items[state.index - 1]', true)
    ;(byExpression.steps[0]!.repeat!.state.index as { required?: unknown }).required = { expression: 'true' }
    expect(checkWorkflow(byExpression, resolve).map((f) => f.path)).toEqual(['/spec/steps/0/repeat/state/index/required']) // a state var is required or not
  })

  it('type-checks when and until expressions', () => {
    const s = example('workflow-review-loop') as Workflow
    s.spec.steps[1]!.repeat!.until = 'iteration.outputs.nope'
    expect(checkWorkflow(s.spec, resolve).map((f) => f.message)[0]).toMatch(/^until: /)
    const t = example('workflow-fan-in') as Workflow
    t.spec.transitions[1]!.to[0]!.when = 'steps.approval.outputs.result.passed + 1'
    expect(checkWorkflow(t.spec, resolve).map((f) => f.message)[0]).toMatch(/^when: /)
    const u = example('workflow-fan-in') as Workflow
    u.spec.transitions[1]!.to[0]!.when = 'steps.approval.phase'
    expect(checkWorkflow(u.spec, resolve).map((f) => f.message)).toEqual(['when is string, not bool'])
  })
})
