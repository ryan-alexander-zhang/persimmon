import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'
import { Engine, localActor } from './engine.js'
import { readClosure } from './snapshot/snapshot.js'
import type { Resource } from './resource/types.js'
import type { Closure } from './snapshot/walk.js'
import { memoryBlobs } from './store/test-util.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const closure = example('snapshot-closure') as Closure
const fresh = ({ status: _s, ...r }: Resource): Resource => ({ ...r, metadata: { name: r.metadata.name, ...(r.metadata.namespace ? { namespace: r.metadata.namespace } : {}) } })
const fakeAdapter = (id: string, roles = 'executor'): Resource => ({
  apiVersion: 'persimmon.ai/v1', kind: 'Adapter', metadata: { name: id.replace('/', '-') },
  spec: { id, roles: roles.split(','), transport: 'stdio', command: ['node', join(process.cwd(), 'test/fixtures/fake-adapter.mjs')], env: { FAKE_ID: id, FAKE_ROLES: roles } },
})

describe('Engine', () => {
  let engine: Engine
  let clock: number
  let dir: string
  beforeEach(() => {
    clock = Date.parse('2026-09-21T09:00:00Z')
    dir = mkdtempSync(join(tmpdir(), 'persimmon-engine-'))
    engine = new Engine({ config: parseConfig({}), storePath: ':memory:', blobs: memoryBlobs(), now: () => new Date(clock), cwd: dir })
    engine.dispatch.retryBaseMs = 0
  })
  afterEach(async () => {
    await engine.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('registers the core kinds and applies every design definition example', async () => {
    await engine.start()
    expect(engine.kinds.get('persimmon.ai/v1', 'WorkflowRun').definition.spec.snapshotOnCreate).toBe(true)
    expect(engine.handlers.get('persimmon.ai/v1', 'Trigger').impl).toBeDefined()
    await engine.apply(fakeAdapter('claude-code/v1'))
    expect(engine.adapters.require('claude-code/v1', 'executor').status?.describeDigest).toMatch(/^sha256:/)
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) await engine.apply(fresh(r as Resource))
    for (const n of ['task-approve-prd', 'validator-cel', 'gate-prd-approval', 'trigger-on-prd-published']) {
      const r = example(n) as Resource
      if (n === 'gate-prd-approval') {
        await engine.apply({ ...example('kind-definition-researchreport'), metadata: { name: 'reviewreports.engineering.persimmon.ai' }, spec: { ...example('kind-definition-researchreport').spec, names: { kind: 'ReviewReport', plural: 'reviewreports' } } })
      }
      await engine.apply(r)
    }
    expect(engine.store.resources.list('Task', 'demo').map((r) => r.metadata.name)).toEqual(['approve-prd', 'research', 'write-prd'])
    // SpecMutable update: generation bumps, SpecUpdated appended for handled kinds
    const wf = example('workflow-prd-create') as Resource
    ;(wf.spec as { timeout: string }).timeout = '3h'
    const { resource } = await engine.apply(wf)
    expect(resource.metadata.generation).toBe(2)
    expect(engine.store.runLog.read(resource.metadata.uid!).map((e) => e.event.type)).toEqual(['Created', 'SpecUpdated'])
    // Immutable kinds refuse a changed spec
    const prd = example('kind-definition-productrequirement')
    prd.spec.versions[0].schema.required = ['title']
    await expect(engine.apply(prd)).rejects.toThrow()
  })

  it('a missing Executor credential fails the attempt with permission_denied', async () => {
    await engine.start()
    await engine.apply(fakeAdapter('claude-code/v1'))
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) await engine.apply(fresh(r as Resource))
    await engine.create(fresh(example('run-workflowrun')))
    await engine.drain()
    const research = engine.store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: 'prd-create-001-research' })!
    expect(research.status).toMatchObject({ phase: 'Failed', error: { code: 'permission_denied', message: 'credential demo/github-token not found' } })
  })

  it('a Pipeline validates and runs through its expansion; the snapshot holds the Workflow, not the sugar', async () => {
    await engine.start()
    await engine.apply(fakeAdapter('claude-code/v1'))
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) await engine.apply(fresh(r as Resource))
    const prdCreate = closure.resources.find((r) => r.kind === 'Workflow')!.spec as { inputs: unknown; outputs: unknown; outputBindings: unknown; steps: unknown[] }
    const pipeline = { apiVersion: 'persimmon.ai/v1', kind: 'Pipeline', metadata: { name: 'prd-pipeline', namespace: 'demo' }, spec: { inputs: prdCreate.inputs, outputs: prdCreate.outputs, outputBindings: prdCreate.outputBindings, phases: prdCreate.steps, timeout: '3h' } } as Resource
    // a broken phase is reported through the expansion
    const bad = { ...pipeline, spec: { ...pipeline.spec, phases: [{ ...(prdCreate.steps[0] as object), inputs: { nope: { fromInput: 'repository' } } }] } } as Resource
    await expect(engine.apply(bad)).rejects.toThrow(/Workflow\/prd-pipeline: .*nope/)
    await engine.apply(pipeline)
    expect(engine.store.resources.get({ kind: 'Workflow', namespace: 'demo', name: 'prd-pipeline' })).toBeUndefined() // nothing derived is stored live

    const errors: string[] = []
    engine.dispatch.onError = (_u, ev, e) => errors.push(`${ev.type}: ${e.message}`)
    const base = example('run-workflowrun') as Resource
    const { resource: run } = await engine.create(fresh({ ...base, metadata: { ...base.metadata, name: 'prd-pipeline-001' }, spec: { ...(base.spec as object), workflowRef: { kind: 'Pipeline', name: 'prd-pipeline' } } } as Resource))
    const members = readClosure(run.metadata.snapshot!, engine.store.snapshots).resources
    const names = members.map((r) => `${r.kind}/${r.metadata.name}`)
    expect(names).toContain('Workflow/prd-pipeline')
    expect(names).toContain('KindDefinition/pipelines.persimmon.ai')
    expect(names.some((n) => n.startsWith('Pipeline/'))).toBe(false)
    expect((members.find((r) => r.kind === 'Workflow' && r.metadata.name === 'prd-pipeline')!.spec as { transitions: unknown[] }).transitions).toHaveLength(2)
    await engine.drain()
    expect(errors).toEqual([])
    expect(engine.store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: 'prd-pipeline-001-research' })?.metadata.ownerReferences?.[0]?.uid).toBe(run.metadata.uid)
  })

  it('an Approval expands to a Gate and Validators; a Pipeline phase uses it and routes on passed', async () => {
    await engine.start()
    await engine.apply(fakeAdapter('claude-code/v1'))
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) await engine.apply(fresh(r as Resource))
    await engine.apply({ ...fakeAdapter('review-ui/v1'), spec: { ...(fakeAdapter('review-ui/v1').spec as object), env: { FAKE_ID: 'review-ui/v1', FAKE_ROLES: 'executor', FAKE_TYPES: 'human' } } } as Resource)
    for (const n of ['executor-product-reviewers', 'task-approve-prd']) await engine.apply(example(n))
    const approval = { apiVersion: 'persimmon.ai/v1', kind: 'Approval', metadata: { name: 'prd-approval', namespace: 'demo' }, spec: { inputs: { prd: { type: { kind: 'artifact', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } } }, approvers: [{ name: 'human', uses: { kind: 'Task', name: 'approve-prd' } }], timeout: '72h' } } as Resource
    const bad = { ...approval, spec: { ...approval.spec, approvers: [{ name: 'human', uses: { kind: 'Task', name: 'approve-prd' }, resultOutput: 'nope' }] } } as Resource
    await expect(engine.apply(bad)).rejects.toThrow(/Validator\/prd-approval-human: .*nope/)
    const unmapped = { ...approval, spec: { ...approval.spec, approvers: [{ name: 'human', uses: { kind: 'Task', name: 'approve-prd' }, inputs: { doc: 'prd' } }] } } as Resource
    await expect(engine.apply(unmapped)).rejects.toThrow(/doc is not an input of Task approve-prd.*required input prd of Task approve-prd is not mapped/s)
    await engine.apply(approval)
    expect(engine.store.resources.get({ kind: 'Gate', namespace: 'demo', name: 'prd-approval' })).toBeUndefined()

    const prdCreate = closure.resources.find((r) => r.kind === 'Workflow')!.spec as { inputs: unknown; outputs: unknown; outputBindings: unknown; steps: unknown[] }
    const approve = { id: 'approve', uses: { kind: 'Approval', name: 'prd-approval' }, inputs: { prd: { fromStep: { stepRef: 'write-prd', output: 'prd' } } }, timeout: '72h' }
    const pipeline = { apiVersion: 'persimmon.ai/v1', kind: 'Pipeline', metadata: { name: 'prd-pipeline', namespace: 'demo' }, spec: { inputs: prdCreate.inputs, outputs: prdCreate.outputs, outputBindings: prdCreate.outputBindings, phases: [...prdCreate.steps, approve], timeout: '80h' } } as Resource
    await engine.apply(pipeline) // the live Approval is read through its expansion: steps.approve.outputs.result exists

    const base = example('run-workflowrun') as Resource
    const { resource: run } = await engine.create(fresh({ ...base, metadata: { ...base.metadata, name: 'prd-pipeline-002' }, spec: { ...(base.spec as object), workflowRef: { kind: 'Pipeline', name: 'prd-pipeline' } } } as Resource))
    const names = readClosure(run.metadata.snapshot!, engine.store.snapshots).resources.map((r) => `${r.kind}/${r.metadata.name}`)
    for (const n of ['Workflow/prd-pipeline', 'Gate/prd-approval', 'Validator/prd-approval-human', 'Task/approve-prd', 'KindDefinition/approvals.persimmon.ai']) expect(names).toContain(n)
    expect(names.some((n) => n.startsWith('Approval/') || n.startsWith('Pipeline/'))).toBe(false)
    const wf = readClosure(run.metadata.snapshot!, engine.store.snapshots).resources.find((r) => r.kind === 'Workflow' && r.metadata.name === 'prd-pipeline')!.spec as { transitions: { id: string; dispatch?: string; to: unknown[] }[] }
    expect(wf.transitions.find((t) => t.id === 'after-approve')).toMatchObject({ dispatch: 'first', to: [{ terminal: 'Succeeded', when: 'steps.approve.outputs.result.passed' }, { terminal: 'Failed', reason: 'approve_rejected' }] })
    // the step's child run names the composition, as the Workflow step does (found in UAT: GateRun.gateRef pinned kind Gate and the round stalled)
    expect(() => engine.kinds.validateResource({ apiVersion: 'persimmon.ai/v1', kind: 'GateRun', metadata: { name: 'g', namespace: 'demo' }, spec: { gateRef: { kind: 'Approval', name: 'prd-approval' }, address: { workflowRunRef: { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: 'x' }, stepRef: 'approve', iterationPath: '', logicalExecutionId: 'x//approve' }, deadline: '2026-09-21T10:00:00Z', inputs: {} } } as Resource)).not.toThrow()
  })

  it('a ReviewLoop expands to an outer Workflow and its round body; a rejected round feeds the next; maxRounds is an input', { timeout: 60_000 }, async () => {
    process.env.PERSIMMON_CRED_DEMO__GITHUB_TOKEN = 'ghp-test' // the produce Task's Executor binds demo/github-token
    await engine.start()
    await engine.listen() // the fake agent publishes through the Engine callbacks
    await engine.apply({ ...fakeAdapter('claude-code/v1'), spec: { ...(fakeAdapter('claude-code/v1').spec as object), env: { FAKE_ID: 'claude-code/v1', FAKE_MODE: 'publish' } } } as Resource)
    await engine.apply({ ...fakeAdapter('review-ui/v1'), spec: { ...(fakeAdapter('review-ui/v1').spec as object), env: { FAKE_ID: 'review-ui/v1', FAKE_ROLES: 'executor', FAKE_TYPES: 'human' } } } as Resource)
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) await engine.apply(fresh(r as Resource))
    for (const n of ['executor-product-reviewers', 'task-approve-prd']) await engine.apply(example(n))
    const prd = { type: { kind: 'artifact', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } }
    const writePrd = closure.resources.find((r) => r.kind === 'Task' && r.metadata.name === 'write-prd')!
    const revise = { ...writePrd, metadata: { name: 'revise-prd', namespace: 'demo' }, spec: { ...(writePrd.spec as object), inputs: { ...(writePrd.spec as { inputs: object }).inputs, last: { ...prd, required: false }, verdict: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/GateResult' } }, required: false } } } } as Resource
    await engine.apply(revise)
    await engine.apply({ apiVersion: 'persimmon.ai/v1', kind: 'Approval', metadata: { name: 'prd-approval', namespace: 'demo' }, spec: { inputs: { prd }, approvers: [{ name: 'human', uses: { kind: 'Task', name: 'approve-prd' } }], timeout: '72h' } } as Resource)
    const loop = { apiVersion: 'persimmon.ai/v1', kind: 'ReviewLoop', metadata: { name: 'prd-loop', namespace: 'demo' }, spec: { inputs: { research: { type: { kind: 'artifact', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport' } } } }, produce: { uses: { kind: 'Task', name: 'revise-prd' }, inputs: { research: { fromInput: 'research' } }, timeout: '35m' }, review: { uses: { kind: 'Approval', name: 'prd-approval' }, inputs: { prd: { fromStep: { stepRef: 'produce', output: 'prd' } } }, timeout: '72h' }, subject: 'prd', previous: 'last', feedback: 'verdict', maxRounds: 2, timeout: '24h' } } as Resource
    await expect(engine.apply({ ...loop, spec: { ...loop.spec, feedback: 'research' } } as Resource)).rejects.toThrow(/research must be an optional input/)
    await expect(engine.apply({ ...loop, spec: { ...loop.spec, review: { ...(loop.spec as { review: object }).review, uses: { kind: 'Task', name: 'approve-prd' } } } } as Resource)).rejects.toThrow(/does not run as a GateRun/)
    await expect(engine.apply({ ...loop, spec: { ...loop.spec, subject: 'passed' } } as Resource)).rejects.toThrow(/passed is a name the loop reserves/)
    await expect(engine.apply({ ...loop, spec: { ...loop.spec, produce: { ...(loop.spec as { produce: { inputs: object } }).produce, inputs: { research: { fromInput: 'research' }, last: { fromInput: 'research' } } } } } as Resource)).rejects.toThrow(/last is fed by the loop/)
    await expect(engine.apply({ ...loop, spec: { ...loop.spec, inputs: { ...(loop.spec as { inputs: object }).inputs, maxRounds: { type: { kind: 'value', schema: { type: 'integer' } } } } } } as Resource)).rejects.toThrow(/maxRounds is the input the loop adds itself/)
    // a finding on the body points at what the user wrote, its message names the expansion
    const badReview = await engine.apply({ ...loop, spec: { ...loop.spec, review: { ...(loop.spec as { review: object }).review, inputs: { prd: { fromStep: { stepRef: 'produce', output: 'nope' } } } } } } as Resource).catch((e: Error & { findings: { path?: string; message: string }[] }) => e)
    expect(badReview).toBeInstanceOf(Error)
    expect((badReview as unknown as { findings: { path?: string; message: string }[] }).findings[0]).toMatchObject({ path: '/spec/review/inputs/prd', message: expect.stringMatching(/^Workflow\/prd-loop-round: /) })
    await engine.apply(loop)

    const errors: string[] = []
    engine.dispatch.onError = (_u, ev, e) => errors.push(`${ev.type}: ${e.message}`)
    const research = { kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport', namespace: 'demo', id: 'research-checkout-v2', revision: 1 } }
    const { resource: run } = await engine.create({ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'prd-loop-001', namespace: 'demo' }, spec: { workflowRef: { kind: 'ReviewLoop', name: 'prd-loop' }, inputs: { research }, origin: { kind: 'manual' } } } as Resource)
    const names = readClosure(run.metadata.snapshot!, engine.store.snapshots).resources.map((r) => `${r.kind}/${r.metadata.name}`)
    for (const n of ['Workflow/prd-loop', 'Workflow/prd-loop-round', 'Gate/prd-approval', 'Validator/prd-approval-human', 'Task/revise-prd', 'Task/approve-prd']) expect(names).toContain(n)
    await engine.drain()
    expect(errors).toEqual([])
    const round = engine.store.resources.get({ kind: 'WorkflowRun', namespace: 'demo', name: 'prd-loop-001-rounds-1' })!
    expect(round.metadata.ownerReferences?.[0]?.uid).toBe(run.metadata.uid)
    expect(engine.store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: 'prd-loop-001-rounds-1-produce' })?.metadata.ownerReferences?.[0]?.uid).toBe(round.metadata.uid)

    // the fake agent published the PRD; the human approver is asked; a rejection carries the PRD and the verdict into round 2
    const verdict = (passed: boolean) => ({ taskResult: { protocol: 'persimmon.result/v1', outputs: { result: { kind: 'value', value: { passed, findings: passed ? [] : [{ severity: 'error', code: 'scope', message: 'too broad' }], evidence: [] } } } }, publish: [] })
    const answer = async (runName: string, n: number, passed: boolean) => {
      const tr = engine.store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: `${runName}-rounds-${n}-review-human-task` })
      expect(tr?.status).toMatchObject({ phase: 'Waiting' })
      engine.signal(tr!.metadata.uid as string, `v-${runName}-${n}`, localActor, verdict(passed), 'api')
      await engine.drain()
    }
    await answer('prd-loop-001', 1, false)
    const produce2 = engine.store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: 'prd-loop-001-rounds-2-produce' })
    expect(produce2).toBeDefined()
    const inputs2 = (produce2!.spec as { inputs: Record<string, { kind: string; ref?: { id: string }; value?: { passed: boolean } }> }).inputs
    expect(inputs2.last).toMatchObject({ kind: 'artifact', ref: { kind: 'ProductRequirement' } })
    expect(inputs2.verdict).toMatchObject({ kind: 'value', value: { passed: false } })
    await answer('prd-loop-001', 2, true)
    expect(engine.store.resources.getByUid(run.metadata.uid as string)?.status).toMatchObject({ phase: 'Succeeded', outputs: { passed: { value: true }, rounds: { value: 2 }, prd: { kind: 'artifact' } } })

    // a run may ask for fewer rounds than the ceiling: one round, rejected, is a verdict, not iteration_limit
    const { resource: short } = await engine.create({ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'prd-loop-003', namespace: 'demo' }, spec: { workflowRef: { kind: 'ReviewLoop', name: 'prd-loop' }, inputs: { research, maxRounds: { kind: 'value', value: 1 } }, origin: { kind: 'manual' } } } as Resource)
    await engine.drain()
    await answer('prd-loop-003', 1, false)
    expect(engine.store.resources.getByUid(short.metadata.uid as string)?.status).toMatchObject({ phase: 'Succeeded', outputs: { passed: { value: false }, rounds: { value: 1 } } })
    expect(errors).toEqual([])

    // a cycle through produce (A produces with B, B with A) is refused at apply, since an update runs the Handler validate as create does; never a stack overflow
    const loopB = { ...loop, metadata: { name: 'prd-loop-b', namespace: 'demo' }, spec: { ...loop.spec, previous: undefined, feedback: undefined, produce: { uses: { kind: 'ReviewLoop', name: 'prd-loop' }, inputs: { research: { fromInput: 'research' } }, timeout: '1h' } } } as Resource
    await engine.apply(loopB)
    await expect(engine.apply({ ...loop, spec: { ...loop.spec, previous: undefined, feedback: undefined, produce: { uses: { kind: 'ReviewLoop', name: 'prd-loop-b' }, inputs: { research: { fromInput: 'research' } }, timeout: '1h' } } } as Resource)).rejects.toThrow(/expands through itself/)
  })

  it('a fromArtifact step binds the latest committed revision, never a staged one, and the kind reaches the snapshot', async () => {
    await engine.start()
    await engine.apply(fakeAdapter('claude-code/v1'))
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition' && r.kind !== 'Workflow')) await engine.apply(fresh(r as Resource))
    const kind = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport' }
    const report = (revision: number): Resource => ({ ...kind, metadata: { name: `research-checkout-v2.r${revision}`, namespace: 'demo' }, spec: { identity: { id: 'research-checkout-v2', revision }, content: { title: `r${revision}`, findings: [] } } })
    await engine.create(report(1))
    await engine.create(report(2))
    engine.store.resources.stage({ ...report(3), status: { contentDigest: 'sha256:' + '0'.repeat(64), representations: [] } }, { uid: 'someone', key: 'open' }) // reserved, not committed
    const byId = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'by-id', namespace: 'demo' }, spec: { entry: ['write-prd'], steps: [{ id: 'write-prd', uses: { kind: 'Task', name: 'write-prd' }, inputs: { research: { fromArtifact: { kind, id: '"research-checkout-v2"' } } }, timeout: '1h' }], transitions: [{ id: 'done', from: [{ stepRef: 'write-prd', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '2h' } } as Resource
    await engine.apply(byId)
    const { resource: run } = await engine.create({ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'by-id-001', namespace: 'demo' }, spec: { workflowRef: { kind: 'Workflow', name: 'by-id' }, inputs: {}, origin: { kind: 'manual' } } } as Resource)
    await engine.drain()
    const task = engine.store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: 'by-id-001-write-prd' })!
    expect((task.spec as { inputs: { research: unknown } }).inputs.research).toEqual({ kind: 'artifact', ref: { ...kind, namespace: 'demo', id: 'research-checkout-v2', revision: 2 } })
    const kinds = readClosure(run.metadata.snapshot!, engine.store.snapshots).resources.filter((r) => r.kind === 'KindDefinition').map((r) => (r.spec as { names: { kind: string } }).names.kind)
    expect(kinds).toContain('ResearchReport') // x-persimmon-kind-ref on the binding's kind pulled it in
    // no revision at all: the run fails at the step with source absent
    const none = { ...byId, metadata: { ...byId.metadata, name: 'by-id-none' }, spec: { ...byId.spec, steps: [{ ...(byId.spec as { steps: object[] }).steps[0], inputs: { research: { fromArtifact: { kind, id: '"nope"' } } } }] } } as Resource
    await engine.apply(none)
    const { resource: noneRun } = await engine.create({ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'by-id-002', namespace: 'demo' }, spec: { workflowRef: { kind: 'Workflow', name: 'by-id-none' }, inputs: {}, origin: { kind: 'manual' } } } as Resource)
    await engine.drain()
    expect(engine.store.resources.getByUid(noneRun.metadata.uid!)!.status).toMatchObject({ phase: 'Failed', error: { message: expect.stringMatching(/research: source absent/) } })
  })

  it('runs prd-create end to end against the fake Adapter until the task fails validation', async () => {
    process.env.PERSIMMON_CRED_DEMO__GITHUB_TOKEN = 'ghp-test'
    await engine.start()
    await engine.apply(fakeAdapter('claude-code/v1'))
    for (const n of ['kind-definition-productrequirement', 'kind-definition-researchreport']) await engine.apply(example(n))
    for (const r of closure.resources.filter((r) => r.kind !== 'KindDefinition')) await engine.apply(fresh(r as Resource))
    const errors: string[] = []
    engine.dispatch.onError = (_u, ev, e) => errors.push(`${ev.type}: ${e.message}`)
    const { resource: run } = await engine.create(fresh(example('run-workflowrun'))) // carries the repository input prd-create requires
    expect(run.metadata.snapshot?.uri).toMatch(/^snapshot:\/\//)
    await engine.drain()
    expect(errors).toEqual([])
    const research = engine.store.resources.get({ kind: 'TaskRun', namespace: 'demo', name: 'prd-create-001-research' })!
    expect(research.metadata.ownerReferences?.[0]?.uid).toBe(run.metadata.uid)
    expect(research.status?.phase).toBe('Failed') // the fake answers execute with an echo, not a TaskResult
    expect((research.status as { error: { code: string } }).error.code).toBe('schema_violation')
    const wr = engine.store.resources.getByUid(run.metadata.uid!)!
    expect(wr.status).toMatchObject({ phase: 'Failed', error: { code: 'schema_violation' }, steps: { research: { phase: 'Failed' }, 'write-prd': { phase: 'Skipped' } } })
    expect(engine.store.runLog.listOpen()).toEqual([])
    expect(engine.store.timers.due('2099-01-01T00:00:00Z')).toEqual([])
  })
})

it('a deep cwd gets a short socket path under the temp dir (sun_path limit)', () => {
  const cwd = '/' + 'd'.repeat(120)
  const e = new Engine({ config: parseConfig({}), cwd, storePath: ':memory:', blobs: memoryBlobs() })
  expect(e.endpoint.replace('unix://', '').length).toBeLessThan(100)
  expect(e.endpoint).toMatch(/persimmon-[0-9a-f]{12}\.sock$/)
})

it('one listening engine per project: a second listen fails while the first lives, a stale lock is taken over', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'persimmon-lock-'))
  mkdirSync(join(cwd, '.persimmon'))
  const a = new Engine({ config: parseConfig({}), cwd, storePath: ':memory:', blobs: memoryBlobs() })
  await a.listen()
  const b = new Engine({ config: parseConfig({}), cwd, storePath: ':memory:', blobs: memoryBlobs() })
  await expect(b.listen()).rejects.toThrow(new RegExp(`another persimmon process \\(pid ${process.pid}\\)`))
  await a.close()
  writeFileSync(join(cwd, '.persimmon', 'engine.lock'), '999999') // no such process
  await b.listen()
  expect(readFileSync(join(cwd, '.persimmon', 'engine.lock'), 'utf8')).toBe(String(process.pid))
  await b.close()
  rmSync(cwd, { recursive: true, force: true })
})

