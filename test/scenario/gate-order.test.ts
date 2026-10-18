// End to end on SQLite: a Gate whose human validator runs `after` a cel check (14-gate.md). A failing check skips the human,
// so no inbox form appears; a passing one asks them.
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCli } from '../../src/cli/index.js'

const v1 = 'persimmon.ai/v1'
const n = { type: { kind: 'value', schema: { type: 'integer' } } }
const result = { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/ValidationResult' } } }
const docs = [
  { apiVersion: v1, kind: 'Validator', metadata: { name: 'positive' }, spec: { inputs: { n }, evaluator: { type: 'cel', expression: 'inputs.n > 0' }, timeout: '1m' } },
  { apiVersion: v1, kind: 'Task', metadata: { name: 'confirm-n' }, spec: { inputs: { n }, outputs: { result }, executorRef: { kind: 'Executor', name: 'local-reviewer' }, action: { instructions: 'Confirm n.' }, timeout: '1h', sideEffects: 'none' } },
  { apiVersion: v1, kind: 'Validator', metadata: { name: 'n-confirmed' }, spec: { inputs: { n }, evaluator: { type: 'task', taskRef: { kind: 'Task', name: 'confirm-n' }, resultOutput: 'result' }, timeout: '1h' } },
  {
    apiVersion: v1, kind: 'Gate', metadata: { name: 'n-gate' },
    spec: {
      inputs: { n }, outputs: { result: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/GateResult' } } } },
      validators: [{ name: 'check', ref: { kind: 'Validator', name: 'positive' }, inputs: { n: { fromInput: 'n' } } }, { name: 'human', ref: { kind: 'Validator', name: 'n-confirmed' }, inputs: { n: { fromInput: 'n' } }, after: ['check'] }],
      timeout: '2h',
    },
  },
  {
    apiVersion: v1, kind: 'Workflow', metadata: { name: 'judge-n' },
    spec: {
      inputs: { n }, outputs: { passed: { type: { kind: 'value', schema: { type: 'boolean' } } } }, outputBindings: { passed: { expression: 'steps.gate.outputs.result.passed' } },
      entry: ['gate'], steps: [{ id: 'gate', uses: { kind: 'Gate', name: 'n-gate' }, inputs: { n: { fromInput: 'n' } }, timeout: '2h' }],
      transitions: [{ id: 'done', from: [{ stepRef: 'gate', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '3h',
    },
  },
]

describe('scenario: a human validator after a check', () => {
  let dir: string
  let out: string[]
  const run = (...argv: string[]) => runCli(argv, { cwd: dir, out: (l: string) => out.push(l), err: (l: string) => out.push(`ERR ${l}`) })
  const inbox = () => readdirSync(join(dir, '.persimmon', 'inbox'))
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-gate-order-'))
    out = []
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('a failing check skips the human; a passing one asks them', { timeout: 30_000 }, async () => {
    expect(await run('init')).toBe(0)
    writeFileSync(join(dir, 'n.yaml'), docs.map((d) => stringify(d)).join('---\n'))
    expect([await run('apply', join(dir, 'n.yaml'), '-n', 'default'), out.filter((l) => l.startsWith('ERR') || l.startsWith('error'))]).toEqual([0, []])
    out = []
    expect(await run('run', 'judge-n', '--input', 'n=0', '--follow')).toBe(0)
    expect(inbox()).toEqual([]) // never asked
    const gateRun = out.find((l) => l.startsWith('created WorkflowRun/'))!.slice('created WorkflowRun/'.length) + '-gate'
    out = []
    expect(await run('describe', `GateRun/${gateRun}`)).toBe(0)
    expect(out.join('\n')).toContain('not run: check did not pass') // the skipped human's result
    out = []
    expect(await run('run', 'judge-n', '--input', 'n=1', '--follow')).toBe(0)
    expect(inbox()).toHaveLength(1) // the check passed: the human is asked
  })
})
