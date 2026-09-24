// End to end on SQLite: prd-create publishes a PRD through a fake agent, the Trigger starts prd-approval,
// reviews publish ReviewReports, the Gate runs the cel Validator and the human review through cli-human/v1,
// and `persimmon complete` finishes it (20-pack.md lifecycle).
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'
import { Engine } from '../../src/engine.js'
import { loadConfig } from '../../src/config.js'

const fakeAgent = {
  apiVersion: 'persimmon.ai/v1', kind: 'Adapter', metadata: { name: 'claude-code-v1' },
  spec: { id: 'claude-code/v1', roles: ['executor'], transport: 'stdio', command: ['node', join(process.cwd(), 'test/fixtures/fake-adapter.mjs')], env: { FAKE_ID: 'claude-code/v1', FAKE_MODE: 'publish' } },
}
const repo = parse(readFileSync('docs/design/examples/resource-refs.yaml', 'utf8')).externalResourceRef

describe('scenario: PRD lifecycle', () => {
  let dir: string
  let out: string[]
  const cli = () => ({ cwd: dir, out: (l: string) => out.push(l), err: (l: string) => out.push(`ERR ${l}`) })
  const run = (...argv: string[]) => runCli(argv, cli())
  const file = (name: string, doc: unknown) => {
    const p = join(dir, name)
    writeFileSync(p, stringify(doc))
    return p
  }
  const inspect = async <T>(fn: (e: Engine) => T): Promise<T> => {
    const e = new Engine({ config: loadConfig(join(dir, 'persimmon.yaml')), cwd: dir })
    await e.start()
    try {
      return fn(e)
    } finally {
      await e.close()
    }
  }
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-scn-'))
    out = []
    process.env.PERSIMMON_CRED_GITHUB_TOKEN = 'ghp-test'
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('runs prd-create to Succeeded, fires the approval Trigger, and completes the human review from the inbox', { timeout: 60_000 }, async () => {
    expect(await run('init')).toBe(0)
    expect(await run('adapter', 'install', file('agent.yaml', fakeAgent))).toBe(0)
    expect(await run('apply', 'packs/sdlc/namespaced/on-prd-published.yaml', '-n', 'default')).toBe(0)

    const wr = { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'prd-001' }, spec: { workflowRef: { kind: 'Workflow', name: 'prd-create' }, inputs: { repository: { kind: 'externalResource', ref: repo } }, timeout: '1h', origin: { kind: 'manual' } } }
    out = []
    expect(await runCli(['create', file('run.yaml', wr), '--follow'], cli())).toBe(0)
    expect(out.at(-1)).toBe('WorkflowRun/prd-001 Succeeded')

    await inspect((e) => {
      const done = e.store.resources.get({ kind: 'WorkflowRun', namespace: 'default', name: 'prd-001' })!
      const prd = (done.status as { outputs: { prd: { ref: { id: string; revision: number; kind: string } } } }).outputs.prd.ref
      expect(prd).toMatchObject({ kind: 'ProductRequirement', revision: 1 })
      const rev = e.store.resources.get({ kind: 'ProductRequirement', namespace: 'default', name: `${prd.id}.r1` })!
      expect(rev.spec).toMatchObject({ content: { title: 'Checkout v2' }, provenance: { actor: { kind: 'handler', id: 'task' } } })
      expect(e.store.resources.listRevisions('ResearchReport', 'default', 'research-researchreport')).toHaveLength(1)
      // the Trigger fired an ownerless approval run named after the event
      const approvals = e.store.resources.list('WorkflowRun', 'default').filter((r) => r.metadata.name.startsWith('on-prd-published-'))
      expect(approvals).toHaveLength(1)
      expect(approvals[0]!.spec).toMatchObject({ workflowRef: { name: 'prd-approval' }, origin: { kind: 'trigger', eventId: expect.stringMatching(/^sha256:/), causationRef: { name: 'prd-001' } } })
      expect(approvals[0]!.metadata.ownerReferences).toBeUndefined()
    })

    // drain the approval run until it waits on the human: reviews publish, the Gate opens, cli-human drops a form
    for (let i = 0; i < 10 && !existsSync(join(dir, '.persimmon', 'inbox')) ; i++) await run('resume')
    for (let i = 0; i < 10 && readdirSync(join(dir, '.persimmon', 'inbox')).length === 0; i++) await run('resume')
    const forms = readdirSync(join(dir, '.persimmon', 'inbox'))
    expect(forms).toHaveLength(1)
    const form = parse(readFileSync(join(dir, '.persimmon', 'inbox', forms[0]!), 'utf8'))
    expect(form.instructions).toMatch(/Approve or reject/)
    expect(form.outputs.result.type.schema).toEqual({ $ref: 'persimmon.ai/v1#/ValidationResult' })
    const taskRun = forms[0]!.replace(/\.yaml$/, '')
    await inspect((e) => {
      const tr = e.store.resources.get({ kind: 'TaskRun', namespace: 'default', name: taskRun })!
      expect(tr.status).toMatchObject({ phase: 'Waiting', waitingReason: 'human', attempts: [{ acknowledged: true }] })
      const structure = e.store.resources.list('ValidationRun', 'default').find((r) => r.metadata.name.endsWith('-structure'))!
      expect(structure.status).toMatchObject({ phase: 'Succeeded', result: { passed: false, findings: [{ code: 'too_few' }] } }) // 2 requirements < minRequirements 3
    })

    // the human approves
    const result = { protocol: 'persimmon.result/v1', outputs: { result: { kind: 'value', value: { passed: true, findings: [], evidence: [] } } } }
    out = []
    expect(await run('complete', taskRun, '--file', file('result.yaml', result))).toBe(0)
    for (let i = 0; i < 5; i++) await run('resume')
    await inspect((e) => {
      const tr = e.store.resources.get({ kind: 'TaskRun', namespace: 'default', name: taskRun })!
      expect(tr.status).toMatchObject({ phase: 'Succeeded', actor: { kind: 'user', id: 'local' } })
      const approval = e.store.resources.list('WorkflowRun', 'default').find((r) => r.metadata.name.startsWith('on-prd-published-'))!
      // the Gate policy is all: structure failed its check, so the Gate Succeeded with passed false and the run failed on its verdict
      const gate = e.store.resources.list('GateRun', 'default')[0]!
      expect(gate.status).toMatchObject({ phase: 'Succeeded', outputs: { result: { kind: 'value', value: { passed: false, results: { humanReview: { passed: true }, structure: { passed: false } } } } } })
      expect(approval.status).toMatchObject({ phase: 'Succeeded', outputs: { approved: { kind: 'value', value: false } } })
      expect(e.store.runLog.listOpen()).toEqual([])
      expect(e.store.audit.read(tr.metadata.uid!).some((a) => a.change === 'signal')).toBe(true)
    })
  })
})
