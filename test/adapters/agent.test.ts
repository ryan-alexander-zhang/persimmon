// The agent Adapters against stub `claude` and `codex` binaries and a fake Engine callbacks socket:
// prompt order, output schema, artifact publication, credentials in the agent env, cancel.
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const stubs = mkdtempSync(join(tmpdir(), 'persimmon-stubs-'))
const cwd = mkdtempSync(join(tmpdir(), 'persimmon-agent-cwd-'))
const socketPath = join(stubs, 'engine.sock')
const calls: { name: string; args: unknown }[] = []
let server: Server

const stub = (name: string, body: string) => {
  const f = join(stubs, name)
  writeFileSync(f, `#!/usr/bin/env node\n${body}`)
  chmodSync(f, 0o755)
}

beforeAll(async () => {
  // claude stub: records args and prompt, answers like `claude -p --output-format json`
  stub('claude', `
    const fs = require('node:fs'); let p = ''
    process.stdin.on('data', (c) => (p += c)).on('end', () => {
      fs.writeFileSync(process.env.STUB_OUT + '/claude.json', JSON.stringify({ args: process.argv.slice(2), prompt: p, env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? null, token: process.env.PERSIMMON_ADAPTER_TOKEN ?? null } }))
      if (process.env.STUB_SLEEP) return setTimeout(() => {}, Number(process.env.STUB_SLEEP))
      if (process.env.STUB_FAIL) { process.stderr.write('boom ' + process.env.GITHUB_TOKEN + '\\n'); process.exit(1) }
      if (process.env.STUB_AUTH) { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Failed to authenticate' })); process.exit(1) }
      process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '{}', structured_output: JSON.parse(process.env.STUB_RESULT) }))
    })`)
  // codex stub: records args and prompt, writes the answer file named by -o
  stub('codex', `
    const fs = require('node:fs'); let p = ''; const a = process.argv.slice(2)
    process.stdin.on('data', (c) => (p += c)).on('end', () => {
      fs.writeFileSync(process.env.STUB_OUT + '/codex.json', JSON.stringify({ args: a, prompt: p, schema: JSON.parse(fs.readFileSync(a[a.indexOf('--output-schema') + 1], 'utf8')) }))
      fs.writeFileSync(a[a.indexOf('-o') + 1], process.env.STUB_RESULT)
    })`)
  // lint stub: records stdin and args, writes the result file named by LINT_OUT
  stub('lint', `
    const fs = require('node:fs'); let p = ''
    process.stdin.on('data', (c) => (p += c)).on('end', () => {
      fs.writeFileSync(process.env.STUB_OUT + '/lint.json', JSON.stringify({ args: process.argv.slice(2), stdin: JSON.parse(p), env: { REGISTRY_TOKEN: process.env.REGISTRY_TOKEN ?? null } }))
      if (process.env.STUB_RESULT) fs.writeFileSync(process.argv[2], process.env.STUB_RESULT)
    })`)
  server = createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      const name = req.url!.split('/').pop()!
      const args = JSON.parse(data)
      calls.push({ name, args })
      const result =
        name === 'getArtifact' ? { spec: { identity: { id: args.id, revision: args.revision }, content: { title: 'Research', findings: [] } } }
        : name === 'putBlob' ? { uri: 'blob://x', digest: 'sha256:' + 'a'.repeat(64) }
        : name === 'publishArtifact' && args.content.title === 'BAD' ? undefined
        : name === 'publishArtifact' ? { ...args.kind, namespace: 'demo', id: args.id, revision: 1 }
        : {}
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(req.headers.authorization !== 'Bearer ct-1' ? { error: { code: 'unauthorized', message: 'bad token' } } : result === undefined ? { error: { code: 'invalid_input', message: 'ProductRequirement content: must match format "uri"' } } : { result }))
    })
  })
  await new Promise<void>((r) => server.listen(socketPath, r))
})
afterAll(() => {
  server.close()
  rmSync(stubs, { recursive: true, force: true })
  rmSync(cwd, { recursive: true, force: true })
})

const research = { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ResearchReport', namespace: 'demo', id: 'research-checkout-v2', revision: 1 }
const payload = (over: Record<string, unknown> = {}) => ({
  taskRun: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'demo', name: 'prd-create-001-write-prd', uid: 'u1' }, logicalExecutionId: 'prd-create-001//write-prd', idempotencyKey: 'prd-create-001//write-prd/1', attempt: 1 },
  task: {
    instructions: 'Write the PRD.', parameters: { effort: 'low' }, sideEffects: 'none',
    outputs: { prd: { type: { kind: 'artifact', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } }, count: { type: { kind: 'value', schema: { type: 'integer' } } } },
    outputSchemas: { prd: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } } },
  },
  executor: { type: 'agent', configuration: { model: 'sonnet', sandbox: 'read-only' }, security: { networkAccess: 'deny', credentialBindings: ['github-token'] } },
  inputs: { research: { kind: 'artifact', ref: research }, maxRequirements: { kind: 'value', value: 12 } },
  context: [
    { kind: 'artifact', ref: research },
    { kind: 'prompt', name: 'tpl', mediaType: 'text/markdown', content: 'Preserve ids.\n', digest: 'sha256:' + 'b'.repeat(64) },
    { kind: 'file', ref: { provider: 'git', type: 'repository', id: 'r', locator: { path: '.' }, version: 'v' }, path: 'AGENTS.md' },
  ],
  deadline: new Date(Date.now() + 60_000).toISOString(),
  credentials: { 'github-token': 'ghp-secret' },
  engine: { endpoint: `unix://${socketPath}`, token: 'ct-1' },
  ...over,
})

function adapter(name: string, req: unknown, env: Record<string, string> = {}) {
  return new Promise<{ lines: Record<string, unknown>[]; code: number | null }>((resolve) => {
    const child = spawn(process.execPath, [join(root, 'adapters', name, 'index.mjs')], { cwd, env: { PATH: `${stubs}:${process.env.PATH}`, HOME: process.env.HOME!, STUB_OUT: stubs, PERSIMMON_ADAPTER_TOKEN: 'at-1', ...env } })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => process.stderr.write(c))
    child.on('close', (code) => resolve({ lines: out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)), code }))
    child.stdin.end(JSON.stringify(req) + '\n')
  })
}
const last = (r: { lines: Record<string, unknown>[] }) => r.lines.at(-1) as { ok: boolean; result?: any; error?: any }

describe('claude-code/v1', () => {
  it('describes the executor Role', async () => {
    const d = last(await adapter('claude-code', { id: 1, op: 'describe', payload: {} }))
    expect(d.result).toMatchObject({ adapterId: 'claude-code/v1', protocol: 'persimmon.adapter/v1', executorTypes: ['agent'], supports: { cancel: true, complete: false } })
  })

  it('builds the prompt in context order, publishes artifact outputs, passes credentials as env', async () => {
    calls.length = 0
    const r = await adapter('claude-code', { id: 2, op: 'execute', payload: payload() }, { STUB_RESULT: JSON.stringify({ outputs: { prd: { title: 'Checkout v2' }, count: 2 }, summary: 'done' }) })
    expect(r.lines[0]).toEqual({ id: 2, event: 'waiting', reason: 'agent' })
    expect(last(r)).toEqual({ id: 2, ok: true, result: { protocol: 'persimmon.result/v1', summary: 'done', outputs: { prd: { kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'prd-create-001-write-prd-prd', revision: 1 } }, count: { kind: 'value', value: 2 } } } })
    const seen = JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8'))
    const p: string = seen.prompt
    const order = ['ResearchReport research-checkout-v2 revision 1', 'Preserve ids.', 'File AGENTS.md', '"maxRequirements": 12', 'Write the PRD.', '## Answer'].map((s) => p.indexOf(s))
    expect(order.every((i) => i >= 0) && order.every((i, k) => k === 0 || i > order[k - 1]!)).toBe(true)
    expect(p).toContain('"title": "Research"')
    expect(p.slice(p.indexOf('## Answer'))).toContain('"required": [\n    "title"')
    expect(seen.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--model', 'sonnet', '--effort', 'low', '--restricted']))
    const schema = JSON.parse(seen.args[seen.args.indexOf('--json-schema') + 1])
    expect(schema.properties.outputs).toEqual({ type: 'object', required: ['prd', 'count'], additionalProperties: false, properties: { prd: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } }, count: { type: 'integer' } } })
    expect(seen.env).toEqual({ GITHUB_TOKEN: 'ghp-secret', token: null })
    expect(calls.map((c) => c.name)).toEqual(['getArtifact', 'putBlob', 'publishArtifact'])
    expect(calls[2]!.args).toMatchObject({ kind: { kind: 'ProductRequirement' }, id: 'prd-create-001-write-prd-prd', content: { title: 'Checkout v2' }, inputs: [research], representations: [{ name: 'json', mediaType: 'application/json' }] })
  })

  it('reports a non-zero agent exit as agent_failed, retryable', async () => {
    const r = await adapter('claude-code', { id: 3, op: 'execute', payload: payload() }, { STUB_FAIL: '1' })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'agent_failed', retryable: true } })
    expect(r.lines.some((l) => l.event === 'log' && l.text === 'boom [redacted]')).toBe(true) // credential values never reach a log line
  })

  it('a missing agent binary is invalid_input, not retried', async () => {
    const r = await adapter('claude-code', { id: 11, op: 'execute', payload: payload() }, { PATH: '/nonexistent' })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'invalid_input', retryable: false } })
  })

  it('an attempt whose deadline has passed is timeout', async () => {
    const r = await adapter('claude-code', { id: 12, op: 'execute', payload: payload({ deadline: new Date(Date.now() - 1000).toISOString() }) })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'timeout', retryable: true } })
  })

  it('reports the agent error text when claude exits 1 with a JSON result', async () => {
    const r = await adapter('claude-code', { id: 9, op: 'execute', payload: payload() }, { STUB_AUTH: '1' })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'agent_failed', message: 'Failed to authenticate', retryable: true } })
  })

  it('a publish the engine refuses is schema_violation, not retryable', async () => {
    const r = await adapter('claude-code', { id: 10, op: 'execute', payload: payload() }, { STUB_RESULT: JSON.stringify({ outputs: { prd: { title: 'BAD' }, count: 1 } }) })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'schema_violation', retryable: false, message: expect.stringContaining('format "uri"') } })
  })

  it('refuses a skill context entry with invalid_input', async () => {
    const r = await adapter('claude-code', { id: 4, op: 'execute', payload: payload({ context: [{ kind: 'skill', name: 's', source: {}, digest: 'sha256:' + 'c'.repeat(64), format: 'x/v1' }] }) })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'invalid_input', retryable: false } })
  })

  it('cancel kills the running agent by the attempt idempotencyKey', async () => {
    const running = adapter('claude-code', { id: 5, op: 'execute', payload: payload() }, { STUB_SLEEP: '30000' })
    const pid = join(cwd, '.persimmon', 'agents', encodeURIComponent('prd-create-001//write-prd/1') + '.pid')
    for (let i = 0; i < 100 && !existsSync(pid); i++) await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(pid)).toBe(true)
    const c = last(await adapter('claude-code', { id: 6, op: 'cancel', payload: { logicalExecutionId: 'prd-create-001//write-prd', idempotencyKey: 'prd-create-001//write-prd/1' } }))
    expect(c.result).toEqual({ state: 'cancelled' })
    expect(last(await running)).toMatchObject({ ok: false, error: { code: 'cancelled', retryable: false } })
    expect(last(await adapter('claude-code', { id: 7, op: 'cancel', payload: { logicalExecutionId: 'nope', idempotencyKey: 'k' } })).result).toEqual({ state: 'unknown' })
  })
})

describe('codex/v1', () => {
  it('writes the schema file, reads the answer file, maps sandbox and model', async () => {
    calls.length = 0
    const r = await adapter('codex', { id: 8, op: 'execute', payload: payload({ executor: { type: 'agent', configuration: { model: 'gpt-6-sol', sandbox: 'workspace-write' }, security: { networkAccess: 'deny', credentialBindings: [] } } }) }, { STUB_RESULT: JSON.stringify({ outputs: { prd: { title: 'PRD' }, count: 1 } }) })
    expect(last(r).result.outputs.prd.ref.id).toBe('prd-create-001-write-prd-prd')
    const seen = JSON.parse(readFileSync(join(stubs, 'codex.json'), 'utf8'))
    expect(seen.args).toEqual(expect.arrayContaining(['exec', '--ephemeral', '-s', 'workspace-write', '-m', 'gpt-6-sol', '-']))
    expect(seen.schema.properties.outputs.required).toEqual(['prd', 'count'])
    // strict form: closed objects, every property required, optional ones widened with null, no format
    expect(seen.schema).toEqual({ type: 'object', required: ['outputs', 'summary'], additionalProperties: false, properties: { outputs: { type: 'object', required: ['prd', 'count'], additionalProperties: false, properties: { prd: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string' } } }, count: { type: 'integer' } } }, summary: { anyOf: [{ type: 'string' }, { type: 'null' }] } } })
  })

  it('strict form recurses into items and oneOf, keeps enum and $defs, and nulls are stripped from the answer', async () => {
    const outputSchemas = { prd: { type: 'object', required: ['title', 'items'], properties: { title: { type: 'string' }, note: { type: 'string', format: 'uri' }, items: { type: 'array', items: { oneOf: [{ type: 'object', required: ['id'], properties: { id: { type: 'string' }, level: { enum: ['a', 'b'] } } }, { $ref: '#/$defs/x' }] } } }, $defs: { x: { type: 'object', properties: { y: { type: 'integer' } } } } } }
    calls.length = 0
    const task = { ...payload().task, outputs: { prd: payload().task.outputs.prd }, outputSchemas }
    const r = await adapter('codex', { id: 13, op: 'execute', payload: payload({ task }) }, { STUB_RESULT: JSON.stringify({ outputs: { prd: { title: 'P', note: null, items: [{ id: 'i', level: null }] } }, summary: null }) })
    expect(calls.find((c) => c.name === 'publishArtifact')!.args).toMatchObject({ content: { title: 'P', items: [{ id: 'i' }] } })
    expect(last(r).result).not.toHaveProperty('summary')
    const seen = JSON.parse(readFileSync(join(stubs, 'codex.json'), 'utf8'))
    expect(seen.schema.properties.outputs.properties.prd).toEqual({
      type: 'object', required: ['title', 'note', 'items'], additionalProperties: false,
      properties: {
        title: { type: 'string' },
        note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        items: { type: 'array', items: { anyOf: [{ type: 'object', required: ['id', 'level'], additionalProperties: false, properties: { id: { type: 'string' }, level: { anyOf: [{ enum: ['a', 'b'] }, { type: 'null' }] } } }, { $ref: '#/$defs/x' }] } },
      },
      $defs: { x: { type: 'object', required: ['y'], additionalProperties: false, properties: { y: { anyOf: [{ type: 'integer' }, { type: 'null' }] } } } },
    })
    expect(seen.prompt).toContain('## Instructions')
  })
})

describe('subprocess/v1', () => {
  const executor = { type: 'script', configuration: { program: ['lint', join(cwd, 'result.json')], resultFile: 'result.json' }, security: { networkAccess: 'deny', credentialBindings: ['registry-token'] } }
  const p = (over: Record<string, unknown> = {}) => payload({ executor, credentials: { 'registry-token': 'reg-secret' }, task: { ...payload().task, parameters: { args: ['--fix'] } }, ...over })

  it('describes script and tool types with file context only', async () => {
    const d = last(await adapter('subprocess', { id: 20, op: 'describe', payload: {} }))
    expect(d.result).toMatchObject({ adapterId: 'subprocess/v1', executorTypes: ['script', 'tool'], contextKinds: ['file'], supports: { cancel: true } })
  })

  it('feeds the payload on stdin without secrets, appends args, reads and removes the result file, publishes artifacts', async () => {
    calls.length = 0
    const r = await adapter('subprocess', { id: 21, op: 'execute', payload: p() }, { STUB_RESULT: JSON.stringify({ outputs: { prd: { title: 'Lint' }, count: 0 }, summary: 'clean' }) })
    expect(r.lines[0]).toEqual({ id: 21, event: 'waiting', reason: 'script' })
    expect(last(r).result).toMatchObject({ protocol: 'persimmon.result/v1', summary: 'clean', outputs: { prd: { kind: 'artifact', ref: { id: 'prd-create-001-write-prd-prd' } }, count: { kind: 'value', value: 0 } } })
    const seen = JSON.parse(readFileSync(join(stubs, 'lint.json'), 'utf8'))
    expect(seen.args).toEqual([join(cwd, 'result.json'), '--fix'])
    expect(seen.stdin).not.toHaveProperty('credentials')
    expect(seen.stdin).not.toHaveProperty('engine')
    expect(seen.stdin.task.instructions).toBe('Write the PRD.')
    expect(seen.env).toEqual({ REGISTRY_TOKEN: 'reg-secret' })
    expect(existsSync(join(cwd, 'result.json'))).toBe(false)
    expect(calls.map((c) => c.name)).toEqual(['putBlob', 'publishArtifact'])
  })

  it('a program that writes no result file fails the attempt as agent_failed', async () => {
    const r = await adapter('subprocess', { id: 22, op: 'execute', payload: p() })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'agent_failed', retryable: true, message: expect.stringContaining('result.json') } })
  })
})

