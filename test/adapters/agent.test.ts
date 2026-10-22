// The agent Adapters against stub `claude` and `codex` binaries and a fake Engine callbacks socket:
// prompt order, output schema, artifact publication, credentials in the agent env, cancel.
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error plain module
import { skillDigest } from '../../adapters/lib/skills.mjs'

const root = join(import.meta.dirname, '..', '..')
const stubs = mkdtempSync(join(tmpdir(), 'persimmon-stubs-'))
const cwd = mkdtempSync(join(tmpdir(), 'persimmon-agent-cwd-'))
const socketPath = join(stubs, 'engine.sock')
const calls: { name: string; args: unknown }[] = []
const stored: Record<string, unknown> = {} // artifact content getArtifact answers by id
let server: Server

const stub = (name: string, body: string) => {
  const f = join(stubs, name)
  writeFileSync(f, `#!/usr/bin/env node\n${body}`)
  chmodSync(f, 0o755)
}

beforeAll(async () => {
  // claude stub: records args and prompt, answers like `claude -p --output-format stream-json --verbose`
  stub('claude', `
    const fs = require('node:fs'); let p = ''
    process.stdin.on('data', (c) => (p += c)).on('end', () => {
      fs.writeFileSync(process.env.STUB_OUT + '/claude.json', JSON.stringify({ args: process.argv.slice(2), prompt: p, cwd: process.cwd(), note: fs.existsSync('NOTE.md'), skill: fs.existsSync('.claude/skills/prd-writer/SKILL.md'), env: { GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? null, token: process.env.PERSIMMON_ADAPTER_TOKEN ?? null } }))
      if (process.env.STUB_SLEEP) return setTimeout(() => {}, Number(process.env.STUB_SLEEP))
      if (process.env.STUB_FAIL) { process.stderr.write('boom ' + process.env.GITHUB_TOKEN + '\\n' + (process.env.DEPLOY_KEY ?? '') + '\\n'); process.exit(1) }
      if (process.env.STUB_AUTH) { process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: process.env.STUB_AUTH === '1' ? 'Failed to authenticate' : process.env.STUB_AUTH })); process.exit(1) }
      process.stderr.write('\\x1b[1mthinking\\x1b[0m about ' + (process.env.GITHUB_TOKEN ?? '') + '\\n')
      if (process.env.STUB_FILES) { const d = /goes in \`([^\`]+)\\/[a-z]+\\/\`/.exec(p)[1]; for (const f of process.env.STUB_FILES.split(',')) { fs.mkdirSync(require('node:path').dirname(d + '/' + f), { recursive: true }); fs.writeFileSync(d + '/' + f, 'x'.repeat(3)) } }
      const ev = (o) => process.stdout.write(JSON.stringify(o) + '\\n')
      ev({ type: 'system', subtype: 'init', tools: ['Bash'] })
      ev({ type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the brief.' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } })
      ev({ type: 'user', message: { content: [{ type: 'tool_result', content: '6 passed' }] } })
      ev({ type: 'result', subtype: 'success', is_error: false, result: '{}', structured_output: JSON.parse(process.env.STUB_RESULT) })
    })`)
  // codex stub: records args and prompt, writes the answer file named by -o
  stub('codex', `
    const fs = require('node:fs'); let p = ''; const a = process.argv.slice(2)
    process.stdin.on('data', (c) => (p += c)).on('end', () => {
      fs.writeFileSync(process.env.STUB_OUT + '/codex.json', JSON.stringify({ args: a, prompt: p, skill: fs.existsSync('.agents/skills/prd-writer/SKILL.md'), schema: JSON.parse(fs.readFileSync(a[a.indexOf('--output-schema') + 1], 'utf8')) }))
      process.stdout.write('codex: reading the brief\\n')
      fs.writeFileSync(a[a.indexOf('-o') + 1], process.env.STUB_RESULT)
    })`)
  // lint stub: records stdin and args, writes the result file named by LINT_OUT
  stub('lint', `
    const fs = require('node:fs'); let p = ''
    process.stdin.on('data', (c) => (p += c)).on('end', () => {
      fs.writeFileSync(process.env.STUB_OUT + '/lint.json', JSON.stringify({ args: process.argv.slice(2), stdin: JSON.parse(p), env: { REGISTRY_TOKEN: process.env.REGISTRY_TOKEN ?? null } }))
      process.stdout.write('lint: 3 files checked\\n')
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
        name === 'getArtifact' ? { spec: { identity: { id: args.id, revision: args.revision }, content: stored[args.id] ?? { title: 'Research', findings: [] } } }
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
    expect(d.result).toMatchObject({ adapterId: 'claude-code/v1', protocol: 'persimmon.adapter/v1', executorTypes: ['agent'], contextKinds: ['file', 'artifact', 'prompt', 'skill'], skillFormats: ['claude-code-skill/v1'], supports: { cancel: true, complete: false } })
  })

  it('an artifacts output: the answered list publishes in order as <prefix>-<n> under the chosen prefix', async () => {
    calls.length = 0
    const base = payload()
    const task = { ...base.task, outputs: { adrs: { type: { kind: 'artifacts', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } } }, outputSchemas: { adrs: base.task.outputSchemas.prd }, outputIds: { adrs: 'checkout-adr' } }
    const r = await adapter('claude-code', { id: 9, op: 'execute', payload: payload({ task }) }, { STUB_RESULT: JSON.stringify({ adrs: [{ title: 'One' }, { title: 'Two' }] }) })
    const refs = ['checkout-adr-1', 'checkout-adr-2'].map((id) => ({ apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id, revision: 1 }))
    expect(last(r)).toEqual({ id: 9, ok: true, result: { protocol: 'persimmon.result/v1', outputs: { adrs: { kind: 'artifacts', refs } } } })
    expect(calls.filter((c) => c.name === 'publishArtifact').map((c) => [c.args.id, c.args.content.title])).toEqual([['checkout-adr-1', 'One'], ['checkout-adr-2', 'Two']])
    const schema = JSON.parse(JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8')).args.filter((_: string, i: number, a: string[]) => a[i - 1] === '--json-schema')[0])
    expect(schema.properties.adrs).toEqual({ type: 'array', maxItems: 999, items: base.task.outputSchemas.prd })
  })

  it('files the agent leaves under <files>/<port>/ publish as representations named by stem, typed by extension; the directory is gone after', async () => {
    calls.length = 0
    const writer = (over: Record<string, unknown> = {}) => payload({ executor: { type: 'agent', configuration: { model: 'sonnet', sandbox: 'workspace-write' }, security: { networkAccess: 'deny', credentialBindings: [] } }, ...over })
    const result = JSON.stringify({ prd: { title: 'Checkout v2' }, count: 2 })
    const r = await adapter('claude-code', { id: 21, op: 'execute', payload: writer() }, { STUB_RESULT: result, STUB_FILES: 'prd/screens.png,prd/Test_Report.v2.html,prd/notes.weird,prd/.DS_Store,prd/sub/ignored.txt' })
    expect(last(r).ok).toBe(true)
    const p: string = JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8')).prompt
    const dir = /goes in `([^`]+)\/prd\/`: flat/.exec(p)![1]! // the literal directory per artifact port, then the rule
    expect(dir.startsWith(join(realpathSync(cwd), '.persimmon-files-'))).toBe(true) // inside the workspace (process.cwd() is the real path), where the sandbox lets the agent write
    expect(existsSync(dir)).toBe(false)
    expect(readdirSync(cwd).filter((n) => n.startsWith('.persimmon-files-'))).toEqual([])
    expect(calls.filter((c) => c.name === 'putBlob').map((c) => c.args.mediaType)).toEqual(['application/json', 'text/html', 'application/octet-stream', 'image/png']) // the content first, then the files by file name (uppercase first); a dotfile and a nested file are not read
    expect(calls.find((c) => c.name === 'publishArtifact')!.args.representations.map((x: { name: string; mediaType: string }) => `${x.name} ${x.mediaType}`)).toEqual(['json application/json', 'test-report-v2 text/html', 'notes application/octet-stream', 'screens image/png']) // the stem made a DNS label
    expect(r.lines.filter((l) => l.event === 'log').map((l) => l.text)).toContain('prd/sub: not a regular file, not a representation')
    // two stems that collide, the content's own name, and a stem that empties are the agent's mistake, retried
    for (const [files, said] of [['prd/a.png,prd/a_.png', 'named a like a.png'], ['prd/json.txt', 'never json'], ['prd/__.html', 'never json or empty']]) {
      const bad = await adapter('claude-code', { id: 22, op: 'execute', payload: writer() }, { STUB_RESULT: result, STUB_FILES: files! })
      expect(last(bad)).toMatchObject({ ok: false, error: { code: 'agent_failed', retryable: true, message: expect.stringContaining(said!) } })
    }
    expect(readdirSync(cwd).filter((n) => n.startsWith('.persimmon-files-'))).toEqual([])
    // the directory lands in payload.workspace when one is set, and a .gitignore keeps a killed attempt's leftovers out of git status
    const ws = mkdtempSync(join(tmpdir(), 'persimmon-ws-'))
    const seen = await adapter('claude-code', { id: 24, op: 'execute', payload: writer({ workspace: ws }) }, { STUB_RESULT: result, STUB_FILES: 'prd/report.html' })
    expect(last(seen).ok).toBe(true)
    const wsPrompt: string = JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8')).prompt
    expect(/goes in `([^`]+)\/prd\/`/.exec(wsPrompt)![1]!.startsWith(join(ws, '.persimmon-files-'))).toBe(true) // the workspace as the payload gave it
    expect(readdirSync(ws)).toEqual([])
    // a read-only sandbox, a Task with no artifact port: no directory, no note
    calls.length = 0
    const ro = await adapter('claude-code', { id: 25, op: 'execute', payload: payload() }, { STUB_RESULT: result })
    expect(last(ro).ok).toBe(true)
    expect(JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8')).prompt).not.toContain('.persimmon-files-')
    expect(calls.filter((c) => c.name === 'putBlob').length).toBe(1)
    // a list output's n-th item takes <port>/<n>/
    const base = writer()
    const task = { ...base.task, outputs: { adrs: { type: { kind: 'artifacts', artifactKind: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement' } } } }, outputSchemas: { adrs: base.task.outputSchemas.prd }, outputIds: { adrs: 'checkout-adr' } }
    calls.length = 0
    const list = await adapter('claude-code', { id: 23, op: 'execute', payload: writer({ task }) }, { STUB_RESULT: JSON.stringify({ adrs: [{ title: 'One' }, { title: 'Two' }] }), STUB_FILES: 'adrs/2/diagram.svg' })
    expect(last(list).ok).toBe(true)
    expect(JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8')).prompt).toMatch(/goes in `[^`]+\/adrs\/` \(`[^`]+\/adrs\/<n>\/` for its n-th item, from 1\)/)
    expect(calls.filter((c) => c.name === 'publishArtifact').map((c) => [c.args.id, c.args.representations.map((x: { name: string }) => x.name)])).toEqual([['checkout-adr-1', ['json']], ['checkout-adr-2', ['json', 'diagram']]])
  })

  it('builds the prompt in context order, publishes artifact outputs, passes credentials as env', async () => {
    calls.length = 0
    const r = await adapter('claude-code', { id: 2, op: 'execute', payload: payload() }, { STUB_RESULT: JSON.stringify({ prd: { title: 'Checkout v2' }, count: 2 }) })
    expect(r.lines[0]).toEqual({ id: 2, event: 'waiting', reason: 'agent' })
    expect(last(r)).toEqual({ id: 2, ok: true, result: { protocol: 'persimmon.result/v1', outputs: { prd: { kind: 'artifact', ref: { apiVersion: 'engineering.persimmon.ai/v1', kind: 'ProductRequirement', namespace: 'demo', id: 'prd-create-001-write-prd-prd', revision: 1 } }, count: { kind: 'value', value: 2 } } } })
    const seen = JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8'))
    const p: string = seen.prompt
    const order = ['ResearchReport research-checkout-v2 revision 1', 'Preserve ids.', 'File AGENTS.md', '"maxRequirements": 12', 'Write the PRD.', '## Answer'].map((s) => p.indexOf(s))
    expect(order.every((i) => i >= 0) && order.every((i, k) => k === 0 || i > order[k - 1]!)).toBe(true)
    expect(p).toContain('"title": "Research"')
    expect(p.slice(p.indexOf('## Answer'))).toContain('"required": [\n    "title"')
    expect(seen.args).toEqual(expect.arrayContaining(['-p', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--effort', 'low', '--restricted']))
    const schema = JSON.parse(seen.args[seen.args.indexOf('--json-schema') + 1])
    expect(schema).toEqual({ type: 'object', required: ['prd', 'count'], additionalProperties: false, properties: { prd: { type: 'object', required: ['title'], properties: { title: { type: 'string' } } }, count: { type: 'integer' } } })
    expect(seen.env).toEqual({ GITHUB_TOKEN: 'ghp-secret', token: null })
    expect(calls.map((c) => c.name)).toEqual(['getArtifact', 'putBlob', 'publishArtifact'])
    expect(calls[2]!.args).toMatchObject({ kind: { kind: 'ProductRequirement' }, id: 'prd-create-001-write-prd-prd', content: { title: 'Checkout v2' }, inputs: [research], representations: [{ name: 'json', mediaType: 'application/json' }] })
    const logs = r.lines.filter((l) => l.event === 'log').map((l) => l.text)
    expect(logs).toContain('thinking about [redacted]') // stderr streams as log lines, credentials redacted
    expect(logs).toContain('Reading the brief.\n> Bash npm test') // stream-json events become a transcript: what it said, what it ran
    expect(logs).toContain('< 6 passed') // and what came back
    expect(logs).toContain('[system init] {"tools":["Bash"]}') // every other event is one line, so an agent that printed nothing else is known to have started
    expect(logs).toContain('[result success] ? turns, ? ms')
    expect(logs.some((t) => t.includes('structured_output'))).toBe(false) // the answer is not a log line
  })

  it('an artifacts input: every ref in provenance, none in the Inputs block', async () => {
    calls.length = 0
    const r2 = { ...research, revision: 2 }
    const many = { ...payload(), inputs: { ...payload().inputs, prior: { kind: 'artifacts', refs: [research, r2] } }, context: [{ kind: 'artifact', ref: research }, { kind: 'artifact', ref: r2 }] }
    const r = await adapter('claude-code', { id: 9, op: 'execute', payload: many }, { STUB_RESULT: JSON.stringify({ prd: { title: 'Checkout v2' }, count: 2 }) })
    expect(last(r).ok).toBe(true)
    expect(calls.find((c) => c.name === 'publishArtifact')!.args.inputs).toEqual([research, r2]) // once each
    const p: string = JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8')).prompt
    expect(p).toContain('ResearchReport research-checkout-v2 revision 2')
    expect(p.slice(p.indexOf('## Inputs'), p.indexOf('## Instructions'))).not.toContain('prior')
  })

  it('configuration.command stands in for claude only under PERSIMMON_ADAPTER_CONFORMANCE=1', async () => {
    const stubbed = { type: 'agent', configuration: { command: [process.execPath, join(root, 'adapters', 'claude-code', 'conformance.mjs')] }, security: { networkAccess: 'deny', credentialBindings: [] } }
    const refused = last(await adapter('claude-code', { id: 15, op: 'execute', payload: payload({ executor: stubbed, credentials: {} }) }))
    expect(refused).toMatchObject({ ok: false, error: { code: 'invalid_input', retryable: false } })
    const record = join(stubs, 'record.json')
    const r = last(await adapter('claude-code', { id: 16, op: 'execute', payload: payload({ executor: stubbed, credentials: {} }) }, { PERSIMMON_ADAPTER_CONFORMANCE: '1', PERSIMMON_CONFORMANCE_ANSWER: JSON.stringify({ prd: { title: 'Stub' }, count: 3 }), PERSIMMON_CONFORMANCE_RECORD: record }))
    expect(r.result.outputs.count).toEqual({ kind: 'value', value: 3 })
    const seen = JSON.parse(readFileSync(record, 'utf8'))
    expect(seen.argv).toContain('--json-schema') // the stub gets the CLI's own arguments
    expect(seen.stdin).toContain('Write the PRD.')
    const empty = last(await adapter('claude-code', { id: 18, op: 'execute', payload: payload({ executor: { ...stubbed, configuration: { command: [] } }, credentials: {} }) }, { PERSIMMON_ADAPTER_CONFORMANCE: '1' }))
    expect(empty).toMatchObject({ ok: false, error: { code: 'invalid_input', message: 'configuration.command must be a non-empty array of strings' } })
    const d = last(await adapter('claude-code', { id: 17, op: 'describe', payload: {} }))
    expect(d.result.conformance.configuration.command[1]).toBe(join(root, 'adapters', 'claude-code', 'conformance.mjs'))
  })

  it('configuration.allowedTools reaches claude as --allowedTools', async () => {
    const r = await adapter('claude-code', { id: 14, op: 'execute', payload: payload({ executor: { type: 'agent', configuration: { sandbox: 'workspace-write', allowedTools: ['Bash(npm test:*)', 'Bash(npm run coverage:*)'] }, security: { networkAccess: 'deny', credentialBindings: [] } } }) }, { STUB_RESULT: JSON.stringify({ prd: { title: 'PRD' }, count: 1 }) })
    expect(last(r).ok).toBe(true)
    const args = JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8')).args as string[]
    expect(args.slice(args.indexOf('--allowedTools'), args.indexOf('--allowedTools') + 3)).toEqual(['--allowedTools', 'Bash(npm test:*)', 'Bash(npm run coverage:*)'])
    expect(args).toContain('acceptEdits')
  })

  it('runs the agent in payload.workspace; a missing one is invalid_input', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'persimmon-ws-'))
    writeFileSync(join(ws, 'NOTE.md'), 'read me')
    const fileCtx = { kind: 'file', ref: { provider: 'git', type: 'repository', id: 'r', locator: { path: ws }, version: 'v' }, path: 'NOTE.md' }
    const r = await adapter('claude-code', { id: 12, op: 'execute', payload: payload({ workspace: ws, context: [fileCtx] }) }, { STUB_RESULT: JSON.stringify({ prd: { title: 'PRD' }, count: 1 }) })
    expect(last(r).ok).toBe(true)
    const seen = JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8'))
    expect(seen.cwd).toBe(realpathSync(ws))
    expect(seen.prompt).toContain('Read `NOTE.md` in the working directory')
    expect(seen.note).toBe(true) // a file context path resolves inside the workspace, where the agent runs
    rmSync(ws, { recursive: true })
    const r2 = await adapter('claude-code', { id: 13, op: 'execute', payload: payload({ workspace: ws }) })
    expect(last(r2)).toMatchObject({ ok: false, error: { code: 'invalid_input', retryable: false, message: `workspace ${ws} is not a directory` } })
  })

  it('reports a non-zero agent exit as agent_failed, retryable', async () => {
    const r = await adapter('claude-code', { id: 3, op: 'execute', payload: payload({ credentials: { 'github-token': 'ghp-secret', 'deploy-key': '-----BEGIN KEY-----\nabcdefgh12345678\n-----END KEY-----' } }) }, { STUB_FAIL: '1' })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'agent_failed', retryable: true } })
    const logs = r.lines.filter((l) => l.event === 'log').map((l) => l.text)
    expect(logs).toContain('boom [redacted]') // credential values never reach a log line
    expect(logs.filter((t) => t === '[redacted]')).toHaveLength(3) // each line of a multi-line secret on its own
    expect(logs.join('\n')).not.toMatch(/abcdefgh|BEGIN KEY/)
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
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'permission_denied', message: 'Failed to authenticate', retryable: false } }) // a dead login is not retried
  })

  it('an API status the CLI reports is the call refused, retryable; an expired session is the login, not', async () => {
    const r = await adapter('claude-code', { id: 9, op: 'execute', payload: payload() }, { STUB_AUTH: 'Failed to authenticate. API Error: 403 Request not allowed' })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'agent_failed', message: 'Failed to authenticate. API Error: 403 Request not allowed', retryable: true } })
    for (const m of ['Failed to authenticate. API Error: 429 rate_limit_error', 'authentication_error: API Error: 529 Overloaded']) expect(last(await adapter('claude-code', { id: 9, op: 'execute', payload: payload() }, { STUB_AUTH: m }))).toMatchObject({ ok: false, error: { code: 'agent_failed', retryable: true } })
    for (const m of ['OAuth session expired and could not be refreshed', 'API Error: 403 {"type":"permission_error","message":"OAuth token has been revoked"}']) expect(last(await adapter('claude-code', { id: 9, op: 'execute', payload: payload() }, { STUB_AUTH: m }))).toMatchObject({ ok: false, error: { code: 'permission_denied', retryable: false } })
  })

  it('a publish the engine refuses is schema_violation, not retryable', async () => {
    const r = await adapter('claude-code', { id: 10, op: 'execute', payload: payload() }, { STUB_RESULT: JSON.stringify({ prd: { title: 'BAD' }, count: 1 }) })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'schema_violation', retryable: false, message: expect.stringContaining('format "uri"') } })
  })

  it('a declared Skill must be installed in the workspace with the declared digest; undeclared ones are logged', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'persimmon-ws-'))
    const src = join(ws, '.claude', 'skills', 'prd-writer')
    mkdirSync(src, { recursive: true })
    writeFileSync(join(src, 'SKILL.md'), '# PRD writer\nOne requirement per line.\n')
    const skill = { kind: 'skill', name: 'prd-writer', source: { provider: 'file', type: 'directory', id: 'x', locator: { path: 'skills/prd-writer' }, version: '1' }, digest: skillDigest(src), format: 'claude-code-skill/v1' }
    const ok = await adapter('claude-code', { id: 4, op: 'execute', payload: payload({ workspace: ws, context: [skill] }) }, { STUB_RESULT: JSON.stringify({ prd: { title: 'S' }, count: 1 }) })
    expect(last(ok).ok).toBe(true)
    const seen = JSON.parse(readFileSync(join(stubs, 'claude.json'), 'utf8'))
    expect(seen.args).not.toContain('--add-dir')
    expect(seen.skill).toBe(true) // the CLI finds it where it looks; the Adapter wrote nothing
    expect(seen.prompt).toContain('## Skill prd-writer\n\nThe skill `prd-writer` is installed at `.claude/skills/prd-writer` in the working directory.')
    expect(existsSync(src)).toBe(true) // and it stays
    // edited after install: the declared digest no longer matches
    writeFileSync(join(src, 'SKILL.md'), '# edited\n')
    expect(last(await adapter('claude-code', { id: 41, op: 'execute', payload: payload({ workspace: ws, context: [skill] }) }))).toMatchObject({ ok: false, error: { code: 'skill_digest_mismatch', retryable: false, message: expect.stringContaining('persimmon skill install prd-writer') } })
    // not installed at all
    rmSync(src, { recursive: true })
    expect(last(await adapter('claude-code', { id: 42, op: 'execute', payload: payload({ workspace: ws, context: [skill] }) }))).toMatchObject({ ok: false, error: { code: 'invalid_input', retryable: false, message: expect.stringContaining('not installed at .claude/skills/prd-writer') } })
    // a format this Adapter does not read
    expect(last(await adapter('claude-code', { id: 43, op: 'execute', payload: payload({ workspace: ws, context: [{ ...skill, format: 'x/v1' }] }) }))).toMatchObject({ ok: false, error: { code: 'invalid_input', retryable: false } })
    // codex looks in its own directory; an installed skill nobody declared is logged, not refused
    mkdirSync(join(ws, '.agents', 'skills', 'prd-writer'), { recursive: true })
    writeFileSync(join(ws, '.agents', 'skills', 'prd-writer', 'SKILL.md'), '# PRD writer\nOne requirement per line.\n')
    mkdirSync(join(ws, '.agents', 'skills', 'house-style'), { recursive: true })
    const cx = await adapter('codex', { id: 45, op: 'execute', payload: payload({ workspace: ws, executor: { type: 'agent', configuration: { model: 'gpt-6-sol', sandbox: 'workspace-write' }, security: { networkAccess: 'deny', credentialBindings: [] } }, context: [skill] }) }, { STUB_RESULT: JSON.stringify({ prd: { title: 'S' }, count: 1 }) })
    expect(last(cx).ok).toBe(true)
    expect(JSON.parse(readFileSync(join(stubs, 'codex.json'), 'utf8')).skill).toBe(true)
    expect(cx.lines.some((l) => l.event === 'log' && l.text === 'workspace skills not declared by this Task: house-style')).toBe(true)
    rmSync(ws, { recursive: true, force: true })
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
    const r = await adapter('codex', { id: 8, op: 'execute', payload: payload({ executor: { type: 'agent', configuration: { model: 'gpt-6-sol', sandbox: 'workspace-write' }, security: { networkAccess: 'deny', credentialBindings: [] } } }) }, { STUB_RESULT: JSON.stringify({ prd: { title: 'PRD' }, count: 1 }) })
    expect(last(r).result.outputs.prd.ref.id).toBe('prd-create-001-write-prd-prd')
    expect(r.lines.filter((l) => l.event === 'log').map((l) => l.text)).toEqual(['codex: reading the brief']) // stdout is the transcript: it streams as log lines
    const seen = JSON.parse(readFileSync(join(stubs, 'codex.json'), 'utf8'))
    expect(seen.args).toEqual(expect.arrayContaining(['exec', '--ephemeral', '-s', 'workspace-write', '-m', 'gpt-6-sol', '-c', 'sandbox_workspace_write.network_access=false', '-']))
    expect(seen.schema.required).toEqual(['prd', 'count'])
    // strict form: closed objects, every property required, optional ones widened with null, no format
    expect(seen.schema).toEqual({ type: 'object', required: ['prd', 'count'], additionalProperties: false, properties: { prd: { type: 'object', required: ['title'], additionalProperties: false, properties: { title: { type: 'string' } } }, count: { type: 'integer' } } }) // flat: no outputs wrapper, no summary
  })

  it('network is closed unless security.networkAccess is allowlist; deny cannot pair with the full sandbox', async () => {
    const exec = (security: Record<string, unknown>, sandbox = 'workspace-write') => ({ type: 'agent', configuration: { model: 'gpt-6-sol', sandbox }, security })
    await adapter('codex', { id: 30, op: 'execute', payload: payload({ executor: exec({ credentialBindings: [] }) }) }, { STUB_RESULT: JSON.stringify({ prd: { title: 'P' }, count: 1 }) })
    expect(JSON.parse(readFileSync(join(stubs, 'codex.json'), 'utf8')).args).toContain('sandbox_workspace_write.network_access=false')
    await adapter('codex', { id: 31, op: 'execute', payload: payload({ executor: exec({ networkAccess: 'allowlist', allowedHosts: ['api.openai.com'] }) }) }, { STUB_RESULT: JSON.stringify({ prd: { title: 'P' }, count: 1 }) })
    expect(JSON.parse(readFileSync(join(stubs, 'codex.json'), 'utf8')).args).toContain('sandbox_workspace_write.network_access=true')
    const r = await adapter('codex', { id: 32, op: 'execute', payload: payload({ executor: exec({ networkAccess: 'deny' }, 'full') }) })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'invalid_input', retryable: false } })
  })

  it('strict form recurses into items and oneOf, keeps enum and hoisted $defs, and nulls are stripped from the answer', async () => {
    const outputSchemas = { prd: { type: 'object', required: ['title', 'items'], properties: { title: { type: 'string' }, note: { type: 'string', format: 'uri' }, items: { type: 'array', items: { oneOf: [{ type: 'object', required: ['id'], properties: { id: { type: 'string' }, level: { enum: ['a', 'b'] } } }, { $ref: '#/$defs/x' }] } } }, $defs: { x: { type: 'object', properties: { y: { type: 'integer' } } } } } }
    calls.length = 0
    const task = { ...payload().task, outputs: { prd: payload().task.outputs.prd }, outputSchemas }
    const r = await adapter('codex', { id: 13, op: 'execute', payload: payload({ task }) }, { STUB_RESULT: JSON.stringify({ prd: { title: 'P', note: null, items: [{ id: 'i', level: null }] } }) })
    expect(calls.find((c) => c.name === 'publishArtifact')!.args).toMatchObject({ content: { title: 'P', items: [{ id: 'i' }] } })
    expect(last(r).result).not.toHaveProperty('summary')
    const seen = JSON.parse(readFileSync(join(stubs, 'codex.json'), 'utf8'))
    expect(seen.schema.properties.prd).toEqual({
      type: 'object', required: ['title', 'note', 'items'], additionalProperties: false,
      properties: {
        title: { type: 'string' },
        note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        items: { type: 'array', items: { anyOf: [{ type: 'object', required: ['id', 'level'], additionalProperties: false, properties: { id: { type: 'string' }, level: { anyOf: [{ enum: ['a', 'b'] }, { type: 'null' }] } } }, { $ref: '#/$defs/prd.x' }] } },
      },
    })
    // the port's $defs are hoisted to the root under `<port>.<name>`, where the CLI resolves them (strict applies to them too)
    expect(seen.schema.$defs).toEqual({ 'prd.x': { type: 'object', required: ['y'], additionalProperties: false, properties: { y: { anyOf: [{ type: 'integer' }, { type: 'null' }] } } } })
    expect(seen.prompt).toContain('## Instructions')
    // the prompt prints the port's own hoisted definitions, so `#/$defs/prd.x` has a body in the prose
    const answer = seen.prompt.slice(seen.prompt.indexOf('## Answer'))
    expect(answer).toContain('"$ref": "#/$defs/prd.x"')
    expect(answer).toMatch(/"prd\.x": \{[\s\S]*"y"/)
  })
})

describe('subprocess/v1', () => {
  const executor = { type: 'script', configuration: { program: ['lint', join(cwd, 'result.json')], resultFile: 'result.json' }, security: { networkAccess: 'deny', credentialBindings: ['registry-token'] } }
  const p = (over: Record<string, unknown> = {}) => payload({ executor, credentials: { 'registry-token': 'reg-secret' }, task: { ...payload().task, parameters: { args: ['--fix'] } }, ...over })

  it('describes script and tool types with file context only', async () => {
    const d = last(await adapter('subprocess', { id: 20, op: 'describe', payload: {} }))
    expect(d.result).toMatchObject({ adapterId: 'subprocess/v1', executorTypes: ['script', 'tool'], contextKinds: ['file'], supports: { cancel: true } })
  })

  it('reads the result file from the workspace', async () => {
    const ws = mkdtempSync(join(tmpdir(), 'persimmon-ws-'))
    const r = await adapter('subprocess', { id: 24, op: 'execute', payload: p({ workspace: ws, executor: { ...executor, configuration: { program: ['lint', join(ws, 'result.json')], resultFile: 'result.json' } } }) }, { STUB_RESULT: JSON.stringify({ outputs: { prd: { title: 'Lint' }, count: 0 } }) })
    expect(last(r).ok).toBe(true)
    expect(existsSync(join(ws, 'result.json'))).toBe(false) // consumed there, not under the adapter's cwd
    rmSync(ws, { recursive: true })
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
    expect(r.lines.filter((l) => l.event === 'log').map((l) => l.text)).toEqual(['lint: 3 files checked']) // the program's stdout streams as log lines
  })

  it('a program that writes no result file fails the attempt as agent_failed', async () => {
    const r = await adapter('subprocess', { id: 22, op: 'execute', payload: p() })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'agent_failed', retryable: true, message: expect.stringContaining('result.json') } })
  })
})


describe('junit/v1', () => {
  const outcome = { apiVersion: 'sdd.persimmon.ai/v1', kind: 'TestOutcome' }
  const record = { apiVersion: 'sdd.persimmon.ai/v1', kind: 'AcceptanceRecord', namespace: 'demo', id: 'p-t-1', revision: 1 }
  const junitXml = '<?xml version="1.0"?><testsuites><testsuite name="claim"><testcase classname="test/claim.test.ts" name="claim &gt; ac 1"/><testcase classname="test/claim.test.ts" name="claim &gt; ac 3"><failure message="expected complete">AssertionError</failure></testcase></testsuite></testsuites>'
  // a test command: writes what JUNIT says to junit.xml (unless empty), prints OUT, exits CODE or kills itself with SIG
  const program = [process.execPath, '-e', "const fs = require('node:fs'); if (process.env.JUNIT) fs.writeFileSync('junit.xml', process.env.JUNIT); console.log(process.env.OUT ?? 'ran'); if (process.env.SIG) process.kill(process.pid, process.env.SIG); process.exit(Number(process.env.CODE ?? 0))"]
  const p = (ws: string, configuration: Record<string, unknown> = { program, junit: 'junit.xml' }) => payload({
    workspace: ws, executor: { type: 'script', configuration, security: { networkAccess: 'deny' } }, credentials: {}, context: [],
    inputs: { record: { kind: 'artifact', ref: record } },
    task: { instructions: 'Run the tests.', parameters: {}, sideEffects: 'idempotent', outputs: { testOutcome: { type: { kind: 'artifact', artifactKind: outcome } } }, outputSchemas: {}, outputIds: { testOutcome: 'p-t-1-tests' } },
  })
  const published = () => calls.filter((c) => c.name === 'publishArtifact').map((c) => c.args as { id: string; content: Record<string, unknown>; inputs: unknown[] })
  const ws = () => mkdtempSync(join(tmpdir(), 'persimmon-junit-'))

  it('describes a script type with no context', async () => {
    const d = last(await adapter('junit', { id: 40, op: 'describe', payload: {} }))
    expect(d.result).toMatchObject({ adapterId: 'junit/v1', executorTypes: ['script'], contextKinds: [], skillFormats: [] })
  })

  it('a red suite is an outcome, not a failure: exit code and every test case published, the record pinned', async () => {
    calls.length = 0
    const dir = ws()
    const r = await adapter('junit', { id: 41, op: 'execute', payload: p(dir) }, { JUNIT: junitXml, CODE: '1' })
    expect(last(r)).toMatchObject({ ok: true, result: { outputs: { testOutcome: { kind: 'artifact', ref: { id: 'p-t-1-tests' } } } } })
    const [pub] = published()
    expect(pub!.content).toEqual({ command: program, exitCode: 1, tests: [{ classname: 'test/claim.test.ts', name: 'claim > ac 1', status: 'passed' }, { classname: 'test/claim.test.ts', name: 'claim > ac 3', status: 'failed', message: 'expected complete' }], selection: { mode: 'full', reason: 'no Change set: no baseline commit' }, newRed: 1 })
    expect(pub!.inputs).toEqual([record]) // provenance: the record the run followed
    rmSync(dir, { recursive: true })
  })

  it('no test case read answers tests [] with the output tail; a stale report is deleted before the run', async () => {
    calls.length = 0
    const dir = ws()
    writeFileSync(join(dir, 'junit.xml'), junitXml) // an earlier run's
    await adapter('junit', { id: 42, op: 'execute', payload: p(dir) }, { OUT: 'error TS2304: Cannot find name claim', CODE: '2' })
    expect(published()[0]!.content).toMatchObject({ exitCode: 2, tests: [], outputTail: expect.stringContaining('error TS2304') })
    expect(existsSync(join(dir, 'junit.xml'))).toBe(false)
    calls.length = 0
    await adapter('junit', { id: 43, op: 'execute', payload: p(dir) }, { JUNIT: '<testsuites><testsuite>', CODE: '1' })
    expect(published()[0]!.content).toMatchObject({ tests: [], outputTail: expect.stringContaining('unreadable JUnit XML') })
    rmSync(dir, { recursive: true })
  })

  it('a signal-killed command records 128 plus the signal; a directory of reports is read whole', async () => {
    calls.length = 0
    const dir = ws()
    await adapter('junit', { id: 44, op: 'execute', payload: p(dir) }, { SIG: 'SIGKILL' })
    expect(published()[0]!.content).toMatchObject({ exitCode: 137, tests: [] })
    mkdirSync(join(dir, 'reports'))
    const surefire = "const fs = require('node:fs'); fs.writeFileSync('reports/TEST-a.xml', '<testsuite name=\"a\"><testcase classname=\"A\" name=\"one\"/></testsuite>'); fs.writeFileSync('reports/TEST-b.xml', '<testsuite name=\"b\"><testcase classname=\"B\" name=\"two\"><skipped/></testcase><testcase classname=\"B\" name=\"three\"><error message=\"NPE\"/></testcase></testsuite>')"
    calls.length = 0
    await adapter('junit', { id: 45, op: 'execute', payload: p(dir, { program: [process.execPath, '-e', surefire], junit: 'reports' }) })
    expect(published()[0]!.content.tests).toEqual([{ classname: 'A', name: 'one', status: 'passed' }, { classname: 'B', name: 'two', status: 'skipped' }, { classname: 'B', name: 'three', status: 'errored', message: 'NPE' }])
    rmSync(dir, { recursive: true })
  })

  it('records the commit and whether the tested tree was dirty', async () => {
    calls.length = 0
    const dir = ws()
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, stdio: 'ignore' })
    git('init', '-q')
    writeFileSync(join(dir, 'a.txt'), 'a')
    git('add', 'a.txt')
    git('commit', '-qm', 'a')
    await adapter('junit', { id: 46, op: 'execute', payload: p(dir) }, { JUNIT: junitXml })
    expect(published()[0]!.content).toMatchObject({ head: expect.stringMatching(/^[0-9a-f]{40}$/), dirty: false }) // read before the run: its own junit.xml is not the change tested
    writeFileSync(join(dir, 'a.txt'), 'b')
    calls.length = 0
    await adapter('junit', { id: 47, op: 'execute', payload: p(dir) }, { JUNIT: junitXml })
    expect(published()[0]!.content).toMatchObject({ dirty: true })
    rmSync(dir, { recursive: true })
  })

  it('refuses a junit path at or outside the workspace, and a Task without exactly one output, before the command runs', async () => {
    const dir = ws()
    for (const junit of ['.', '..', '/tmp/x.xml']) {
      const r = await adapter('junit', { id: 48, op: 'execute', payload: p(dir, { program, junit }) }, { JUNIT: junitXml })
      expect(last(r)).toMatchObject({ ok: false, error: { code: 'invalid_input', retryable: false, message: expect.stringContaining('inside the workspace') } })
    }
    const two = p(dir)
    two.task.outputs = { ...two.task.outputs, other: two.task.outputs.testOutcome }
    const r = await adapter('junit', { id: 49, op: 'execute', payload: two }, { JUNIT: junitXml })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('declares 2') } })
    expect(existsSync(join(dir, 'junit.xml'))).toBe(false) // never ran
    rmSync(dir, { recursive: true })
  })

  it('deletes only stale reports in a directory, redacts credentials from what it stores, falls back on an empty run', async () => {
    const dir = ws()
    mkdirSync(join(dir, 'reports'))
    writeFileSync(join(dir, 'reports', 'TEST-old.xml'), '<?xml version="1.0"?><!-- old --><testsuite name="old"><testcase name="gone"/></testsuite>')
    writeFileSync(join(dir, 'reports', 'pom.xml'), '<project/>')
    calls.length = 0
    const leak = "console.log('token ' + process.env.REGISTRY_TOKEN); process.exit(3)"
    await adapter('junit', { id: 50, op: 'execute', payload: { ...p(dir, { program: [process.execPath, '-e', leak], junit: 'reports' }), credentials: { 'registry-token': 'reg-secret-1' } } })
    expect(existsSync(join(dir, 'reports', 'TEST-old.xml'))).toBe(false)
    expect(existsSync(join(dir, 'reports', 'pom.xml'))).toBe(true) // not a report
    expect(published()[0]!.content).toMatchObject({ exitCode: 3, tests: [], outputTail: 'token [redacted]' })
    calls.length = 0
    await adapter('junit', { id: 51, op: 'execute', payload: p(dir, { program: [process.execPath, '-e', "require('node:fs').writeFileSync('junit.xml', '<testsuites/>')"], junit: 'junit.xml' }) })
    expect(published()[0]!.content).toMatchObject({ tests: [], outputTail: 'no test read from junit.xml' })
    rmSync(dir, { recursive: true })
  })

  it('an Adapter told to stop fails the attempt instead of publishing an outcome', async () => {
    calls.length = 0
    const dir = ws()
    const child = spawn(process.execPath, [join(root, 'adapters', 'junit', 'index.mjs')], { cwd, env: { PATH: process.env.PATH!, HOME: process.env.HOME! } })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stdin.end(JSON.stringify({ id: 52, op: 'execute', payload: p(dir, { program: [process.execPath, '-e', "require('node:fs').writeFileSync('started', ''); setTimeout(() => {}, 60000)"], junit: 'junit.xml' }) }) + '\n')
    for (let i = 0; i < 100 && !existsSync(join(dir, 'started')); i++) await new Promise((r) => setTimeout(r, 50))
    child.kill('SIGTERM')
    await new Promise((r) => child.on('close', r))
    const answer = JSON.parse(out.trim().split('\n').at(-1)!)
    expect(answer).toMatchObject({ ok: false, error: { code: 'agent_failed', message: expect.stringContaining('stopped with the Adapter') } })
    expect(published()).toEqual([])
    rmSync(dir, { recursive: true })
  })

  it('a command outliving the deadline is timeout under anyExit too, never an outcome', async () => {
    calls.length = 0
    const dir = ws()
    const r = await adapter('junit', { id: 53, op: 'execute', payload: { ...p(dir, { program: [process.execPath, '-e', 'setTimeout(() => {}, 60000)'], junit: 'junit.xml' }), deadline: new Date(Date.now() + 1500).toISOString() } })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'timeout' } })
    expect(published()).toEqual([])
    rmSync(dir, { recursive: true })
  })

  it('reads JUnit: a message from the element text, CDATA and entities, a nameless case, an empty root; paths and roots checked', async () => {
    // @ts-expect-error plain module
    const { testCases, reportPath } = await import('../../adapters/junit/read.mjs')
    expect(testCases('<testsuite><testcase classname="C" name="a &amp; b"><failure><![CDATA[expected <1>\n  at x]]></failure></testcase><testcase classname="Only"/></testsuite>')).toEqual([
      { classname: 'C', name: 'a & b', status: 'failed', message: 'expected <1>' },
      { classname: 'Only', name: 'Only', status: 'passed' },
    ])
    expect(testCases('<testsuites/>')).toEqual([])
    expect(() => testCases('<testsuites><testsuite>')).toThrow()
    expect(reportPath('/w', 'target/surefire-reports')).toBe('/w/target/surefire-reports')
    for (const bad of ['.', '../x', '/abs.xml']) expect(() => reportPath('/w', bad)).toThrow(/inside the workspace/)
  })

  // 36-test-levels.md: a git workspace whose baseline commit is `base`, the record naming `named`
  const gitWs = () => {
    const dir = ws()
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim()
    git('init', '-q')
    mkdirSync(join(dir, 'src'))
    mkdirSync(join(dir, 'docs'))
    writeFileSync(join(dir, 'src', 'claim.ts'), 'a\nb\nc\n')
    writeFileSync(join(dir, 'docs', 'guide.md'), 'x\n')
    writeFileSync(join(dir, '.gitignore'), 'junit*.xml\nran*\n')
    git('add', '.')
    git('commit', '-qm', 'base')
    return { dir, head: git('rev-parse', 'HEAD') }
  }
  const baselineRef = { apiVersion: 'sdd.persimmon.ai/v1', kind: 'TestOutcome', namespace: 'demo', id: 'p-baseline', revision: 1 }
  const round = (dir: string, configuration: Record<string, unknown>, head: string, named: unknown[] = []) => {
    stored['p-baseline'] = { command: ['t'], exitCode: 0, head, tests: [{ classname: 'old', name: 'red before', status: 'failed' }] }
    stored['p-t-1'] = { task: 'T-1', verifies: [{ scenario: 'AC-1', tests: named }] }
    const r = p(dir, configuration)
    r.inputs = { ...r.inputs, baseline: { kind: 'artifact', ref: baselineRef } } as never
    return r
  }
  // writes junit.xml with the given cases, and `ran` with its own argv, so a test sees what ran and how
  const tests = (...cases: string[]) => [process.execPath, '-e', `const fs = require('node:fs'); fs.appendFileSync('ran', JSON.stringify(process.argv.slice(1)) + '\\n'); fs.writeFileSync('junit.xml', '<testsuites><testsuite>${cases.join('')}</testsuite></testsuites>')`]

  it('selects by the Change set: untouched runs nothing, a named test the narrowed run missed runs everything again (36-test-levels.md)', async () => {
    const { dir, head } = gitWs()
    writeFileSync(join(dir, 'docs', 'guide.md'), 'y\n') // outside paths
    calls.length = 0
    const config = { program: tests('<testcase classname="c" name="all"/>'), junit: 'junit.xml', paths: ['src/**'], affected: [...tests('<testcase classname="c" name="near"/>'), '--', '--base={base}', '{files}'] }
    await adapter('junit', { id: 60, op: 'execute', payload: round(dir, config, head) })
    expect(published()[0]!.content).toEqual({ command: config.program, exitCode: 0, tests: [], selection: { mode: 'none', reason: 'untouched' }, head, dirty: true })
    expect(existsSync(join(dir, 'ran'))).toBe(false) // never ran

    writeFileSync(join(dir, 'src', 'claim.ts'), 'a\nB\nc\n')
    writeFileSync(join(dir, 'src', 'new.ts'), 'n\n')
    calls.length = 0
    await adapter('junit', { id: 61, op: 'execute', payload: round(dir, config, head, ['all']) })
    const ran = readFileSync(join(dir, 'ran'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(ran[0]).toEqual([`--base=${head}`, 'src/claim.ts', 'src/new.ts']) // narrowed to the changed files under paths
    expect(ran).toHaveLength(2) // `all` was not among the narrowed run's: everything again
    expect(published()[0]!.content).toMatchObject({ command: config.program, tests: [{ name: 'all', status: 'passed' }], selection: { mode: 'full', reason: '1 named test not selected: all' }, newRed: 0 })
    rmSync(dir, { recursive: true })
  })

  it('selects in pure terms: tiers, held, fullOn, paths, a named test (36-test-levels.md)', async () => {
    // @ts-expect-error plain module
    const { select, changeSet, expand, newRed } = await import('../../adapters/junit/select.mjs')
    const changes = new Map([['src/a.ts', new Set([1])], ['package-lock.json', new Set([2])]])
    const config = { paths: ['src/**'], affected: ['x'] }
    expect(select({ tier: 'baseline', level: 'e2e', config })).toEqual({ mode: 'full', reason: 'baseline' })
    expect(select({ tier: 'plan', level: 'unit', config: {} }).mode).toBe('none') // the last round ran it all
    expect(select({ tier: 'plan', level: 'unit', config })).toEqual({ mode: 'full', reason: 'plan tier' })
    expect(select({ tier: 'round', level: 'api', config, changes, held: 'unit' })).toEqual({ mode: 'none', reason: 'held: unit' })
    expect(select({ tier: 'round', level: 'api', config })).toEqual({ mode: 'full', reason: 'no Change set: no baseline commit' })
    expect(select({ tier: 'round', level: 'api', config: { ...config, fullOn: ['package-lock.json'] }, changes })).toEqual({ mode: 'full', reason: 'fullOn: package-lock.json' })
    expect(select({ tier: 'round', level: 'api', config, changes })).toEqual({ mode: 'affected', reason: '1 changed file' })
    expect(select({ tier: 'round', level: 'api', config: { paths: ['src/**'] }, changes })).toEqual({ mode: 'full', reason: '1 changed file' })
    expect(select({ tier: 'round', level: 'api', config: { paths: ['web/**'] }, changes })).toEqual({ mode: 'none', reason: 'untouched' })
    expect(select({ tier: 'round', level: 'api', config: { paths: ['web/**'] }, changes, named: ['t'] })).toEqual({ mode: 'full', reason: '1 named test' })
    expect(expand(['a', '--only-changed={base}', '{files}', '--mutate={files}'], { base: 'abc', files: ['x', 'y'] })).toEqual(['a', '--only-changed=abc', 'x', 'y', '--mutate=x,y'])
    expect(newRed([{ classname: 'a', name: 'b', status: 'failed' }, { classname: 'a', name: 'c', status: 'errored' }], { tests: [{ classname: 'a', name: 'b', status: 'failed' }] })).toBe(1)
    const { dir, head } = gitWs()
    writeFileSync(join(dir, 'src', 'claim.ts'), 'a\nB\nc\nd\n')
    rmSync(join(dir, 'docs', 'guide.md'))
    writeFileSync(join(dir, 'src', 'new.ts'), 'n\nm')
    expect(changeSet(dir, head)).toEqual(new Map([['docs/guide.md', new Set()], ['src/claim.ts', new Set([2, 4])], ['src/new.ts', new Set([1, 2])]]))
    rmSync(dir, { recursive: true })
  })

  it('measures coverage and mutation over the Change set only (36-test-levels.md)', async () => {
    // @ts-expect-error plain module
    const { coverage, mutation, ranges } = await import('../../adapters/junit/measure.mjs')
    const dir = ws()
    const changes = new Map([['src/a.ts', new Set([1, 2, 3, 4, 9])], ['src/b.ts', new Set([1])], ['docs/x.md', new Set([1])]])
    // paths relative to a source root, one absolute; a line outside the Change set and a file outside paths count nothing
    writeFileSync(join(dir, 'cov.xml'), `<?xml version="1.0"?><coverage><sources><source>${dir}/src</source></sources><packages><package><classes>
      <class filename="a.ts"><lines><line number="1" hits="2"/><line number="2" hits="0"/><line number="3" hits="0"/><line number="4" hits="1"/><line number="7" hits="0"/></lines></class>
      <class filename="${dir}/src/b.ts"><lines><line number="1" hits="1"/></lines></class></classes></package></packages></coverage>`)
    expect(coverage({ workspace: dir, report: 'cov.xml', min: 90, changes, paths: ['src/**'] })).toEqual({ min: 90, covered: 3, total: 5, uncovered: [{ file: 'src/a.ts', lines: '2-3' }] })
    expect(coverage({ workspace: dir, report: 'none.xml', min: 90, changes }).error).toContain('none.xml not read')
    expect(coverage({ workspace: dir, report: 'cov.xml', min: 90 })).toEqual({ min: 90, error: 'no Change set to measure: no baseline commit' })
    expect(ranges([9, 1, 2, 3, 5])).toBe('1-3,5,9')
    const mutant = (line: number, status: string) => ({ id: `${line}${status}`, mutatorName: 'EqualityOperator', location: { start: { line, column: 1 }, end: { line, column: 2 } }, status })
    writeFileSync(join(dir, 'mutation.json'), JSON.stringify({ schemaVersion: '2', thresholds: { high: 80, low: 60 }, files: { 'src/a.ts': { language: 'typescript', source: '', mutants: [mutant(1, 'Killed'), mutant(2, 'Survived'), mutant(3, 'Timeout'), mutant(4, 'NoCoverage'), mutant(4, 'CompileError'), mutant(7, 'Survived')] }, [`${dir}/docs/x.md`]: { language: 'md', source: '', mutants: [mutant(1, 'Survived')] } } }))
    expect(mutation({ workspace: dir, report: 'mutation.json', min: 90, changes, paths: ['src/**'], command: ['stryker'] })).toEqual({
      min: 90, command: ['stryker'], killed: 1, survived: 1, noCoverage: 1, timeout: 1, score: 50,
      survivors: [{ file: 'src/a.ts', line: 2, mutator: 'EqualityOperator' }, { file: 'src/a.ts', line: 4, mutator: 'EqualityOperator' }],
    })
    expect(mutation({ workspace: dir, report: 'mutation.json', min: 90, command: ['stryker'] })).toMatchObject({ survived: 3 }) // no Change set: every mutant
    // a report naming a file by another root resolves by suffix; one that cannot is an error, never a pass unmeasured
    const deep = new Map([['src/main/java/com/x/Claim.java', new Set([3])]])
    writeFileSync(join(dir, 'pit.json'), JSON.stringify({ files: { 'com/x/Claim.java': { mutants: [mutant(3, 'Survived')] } } }))
    expect(mutation({ workspace: dir, report: 'pit.json', min: 90, changes: deep, paths: ['src/**'], command: [] })).toMatchObject({ survived: 1, score: 0 })
    writeFileSync(join(dir, 'jacoco.xml'), '<coverage><sources><source>src/main/java</source></sources><packages><package><classes><class filename="com/x/Claim.java"><lines><line number="3" hits="1"/></lines></class></classes></package></packages></coverage>')
    expect(coverage({ workspace: dir, report: 'jacoco.xml', min: 90, changes: deep, paths: ['src/**'] })).toEqual({ min: 90, covered: 1, total: 1, uncovered: [] })
    writeFileSync(join(dir, 'jacoco-own.xml'), '<?xml version="1.0"?><!DOCTYPE report PUBLIC "-//JACOCO//DTD Report 1.1//EN" "report.dtd"><report name="claims"><package name="com/x"><class name="com/x/Claim" sourcefilename="Claim.java"/><sourcefile name="Claim.java"><line nr="3" mi="2" ci="0" mb="0" cb="0"/><line nr="4" mi="0" ci="1" mb="0" cb="0"/></sourcefile></package></report>')
    expect(coverage({ workspace: dir, report: 'jacoco-own.xml', min: 90, changes: deep, paths: ['src/**'] })).toEqual({ min: 90, covered: 0, total: 1, uncovered: [{ file: 'src/main/java/com/x/Claim.java', lines: '3' }] }) // JaCoCo's own XML
    writeFileSync(join(dir, 'report.js'), `document.querySelector('mutation-test-report-app').report = ${JSON.stringify({ schemaVersion: '2', files: { 'com/x/Claim.java': { mutants: [mutant(3, 'Killed')] } } })};`)
    expect(mutation({ workspace: dir, report: 'report.js', min: 90, changes: deep, paths: ['src/**'], command: [] })).toMatchObject({ killed: 1, score: 100 }) // PIT's html2 report
    writeFileSync(join(dir, 'gremlins.json'), JSON.stringify({ go_module: 'example.com/claims', files: [{ file_name: 'claim.go', mutations: [{ type: 'CONDITIONALS_BOUNDARY', status: 'LIVED', line: 3, column: 9 }, { type: 'ARITHMETIC_BASE', status: 'KILLED', line: 3, column: 2 }, { type: 'INVERT_NEGATIVES', status: 'NOT VIABLE', line: 3, column: 4 }] }] }))
    expect(mutation({ workspace: dir, report: 'gremlins.json', min: 90, changes: new Map([['claims/claim.go', new Set([3])]]), command: [] })).toEqual({ min: 90, command: [], killed: 1, survived: 1, noCoverage: 0, timeout: 0, score: 50, survivors: [{ file: 'claims/claim.go', line: 3, mutator: 'CONDITIONALS_BOUNDARY' }] }) // Gremlins, Go
    writeFileSync(join(dir, 'skipped.json'), JSON.stringify({ go_module: 'm', files: [{ file_name: 'claim.go', mutations: [{ type: 'CONDITIONALS_BOUNDARY', status: 'SKIPPED', line: 3, column: 9 }] }] }))
    expect(mutation({ workspace: dir, report: 'skipped.json', min: 90, changes: new Map([['claims/claim.go', new Set([3])]]), command: [] }).error).toContain('1 mutant on the changed lines, none run') // never a pass unmeasured
    writeFileSync(join(dir, 'timeouts.json'), JSON.stringify({ go_module: 'm', files: [{ file_name: 'claim.go', mutations: [{ type: 'A', status: 'TIMED OUT', line: 3, column: 1 }, { type: 'B', status: 'TIMED OUT', line: 3, column: 2 }] }] }))
    expect(mutation({ workspace: dir, report: 'timeouts.json', min: 90, changes: new Map([['claims/claim.go', new Set([3])]]), command: [] }).error).toContain('all 2 mutants on the changed lines timed out') // a timeout-only 100 is no score
    const twins = new Map([['a/Claim.java', new Set([3])], ['b/Claim.java', new Set([3])]])
    writeFileSync(join(dir, 'twin.json'), JSON.stringify({ files: { 'x/Claim.java': { mutants: [mutant(3, 'Survived')] } } }))
    expect(mutation({ workspace: dir, report: 'twin.json', min: 90, changes: twins, command: [] }).error).toContain('resolves to no changed file')
    writeFileSync(join(dir, 'bad.json'), '{}')
    expect(mutation({ workspace: dir, report: 'bad.json', min: 90, command: [] }).error).toContain('neither a mutation-testing-elements nor a Gremlins report')

    // the unit runner: tests, coverage, then mutation once no red is new
    const g = gitWs()
    writeFileSync(join(g.dir, 'src', 'claim.ts'), 'a\nB\nc\n')
    const cov = `<coverage><packages><package><classes><class filename="src/claim.ts"><lines><line number="2" hits="0"/></lines></class></classes></package></packages></coverage>`
    const program = [process.execPath, '-e', `const fs = require('node:fs'); fs.writeFileSync('junit.xml', '<testsuites><testsuite><testcase classname="c" name="t"/></testsuite></testsuites>'); fs.writeFileSync('cov.xml', '${cov}')`]
    const report = { files: { 'src/claim.ts': { mutants: [mutant(2, 'Killed')] } } }
    const mutate = [process.execPath, '-e', `require('node:fs').writeFileSync('mutation.json', process.argv[1])`, '--', JSON.stringify(report), '{files}']
    calls.length = 0
    await adapter('junit', { id: 65, op: 'execute', payload: round(g.dir, { program, junit: 'junit.xml', coverage: { report: 'cov.xml', min: 90 }, mutation: { program: mutate, report: 'mutation.json', min: 80 } }, g.head) })
    const content = published()[0]!.content
    expect(content.coverage).toEqual({ min: 90, covered: 0, total: 1, uncovered: [{ file: 'src/claim.ts', lines: '2' }] })
    expect(content.mutation).toMatchObject({ min: 80, killed: 1, score: 100, command: expect.arrayContaining(['src/claim.ts']) })
    for (const f of ['../cov.xml', '/tmp/cov.xml']) {
      const r = await adapter('junit', { id: 66, op: 'execute', payload: round(g.dir, { program, junit: 'junit.xml', coverage: { report: f, min: 90 } }, g.head) })
      expect(last(r)).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('inside the workspace') } }) // deleted before a run, so never outside
    }
    rmSync(dir, { recursive: true })
    rmSync(g.dir, { recursive: true })
  })

  it('levels: one TestOutcome per configured level in order, each after a new red held (36-test-levels.md)', async () => {
    const { dir, head } = gitWs()
    writeFileSync(join(dir, 'src', 'claim.ts'), 'a\nB\nc\n')
    const levels = { e2e: { program: tests('<testcase classname="e" name="flow"/>'), junit: 'junit.xml' }, integration: { program: tests('<testcase classname="i" name="db"><failure message="no row"/></testcase>'), junit: 'junit.xml' } }
    const payload = (unit: Record<string, unknown>) => {
      stored['p-t-1'] = { task: 'T-1', verifies: [{ scenario: 'AC-1', tests: ['u'] }] }
      stored['p-t-1-tests'] = unit
      stored['p-baseline-levels-1'] = { command: ['t'], exitCode: 0, head, level: 'integration', tests: [] }
      const r = p(dir, { levels })
      r.task.outputs = { outcomes: { type: { kind: 'artifacts', artifactKind: outcome } } } as never
      r.task.outputIds = { outcomes: 'p-t-1-levels' } as never
      r.inputs = { ...r.inputs, testOutcome: { kind: 'artifact', ref: { ...record, kind: 'TestOutcome', id: 'p-t-1-tests' } }, baselines: { kind: 'artifacts', refs: [{ ...baselineRef, id: 'p-baseline-levels-1' }] } } as never
      return r
    }
    calls.length = 0
    let r = await adapter('junit', { id: 62, op: 'execute', payload: payload({ newRed: 1, selection: { mode: 'full', reason: 'x' } }) })
    expect(last(r).result.outputs.outcomes.refs.map((x: { id: string }) => x.id)).toEqual(['p-t-1-levels-1', 'p-t-1-levels-2'])
    expect(published().map((x) => [x.content.level, x.content.selection])).toEqual([['integration', { mode: 'none', reason: 'held: unit' }], ['e2e', { mode: 'none', reason: 'held: unit' }]])
    calls.length = 0
    r = await adapter('junit', { id: 63, op: 'execute', payload: payload({ newRed: 0, selection: { mode: 'full', reason: 'x' } }) })
    expect(published().map((x) => [x.content.level, x.content.selection, x.content.newRed])).toEqual([['integration', { mode: 'full', reason: '1 changed file' }, 1], ['e2e', { mode: 'none', reason: 'held: integration' }, undefined]])
    const wrong = p(dir, { levels })
    const w = await adapter('junit', { id: 64, op: 'execute', payload: wrong })
    expect(last(w)).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('artifacts output with levels') } })
    rmSync(dir, { recursive: true })
  })
  // 39-test-process.md: a TestHarness names the levels and their commands; a round's cases are what each level must run
  it('reads the levels from a TestHarness bound, the Executor keeping the minimums (39-test-process.md)', async () => {
    const { dir, head } = gitWs()
    writeFileSync(join(dir, 'src', 'claim.ts'), 'a\nB\nc\n')
    const cov = '<coverage><packages><package><classes><class filename="src/claim.ts"><lines><line number="2" hits="1"/></lines></class></classes></package></packages></coverage>'
    const unitRun = [process.execPath, '-e', `const fs = require('node:fs'); fs.writeFileSync('junit.xml', '<testsuites><testsuite><testcase classname="c" name="CAP-1/TC-3 per diem"/></testsuite></testsuites>'); fs.writeFileSync('cov.xml', '${cov}')`]
    stored['h'] = { architecture: 'a', openQuestions: [], levels: {
      unit: { tool: 'node', run: unitRun, one: ['x'], junit: 'junit.xml', paths: ['src/**'], testDir: 'test', seed: 's', conventions: 'c', coverage: { report: 'cov.xml' } },
      api: { tool: 'bru', run: tests('<testcase classname="a" name="CAP-1/TC-1 refused"/>'), one: ['x'], junit: 'junit.xml', testDir: 'api', seed: 's', conventions: 'c' },
      fitness: { tool: 'node --test', run: tests('<testcase classname="f" name="CAP-1/TC-4 no write bypasses the aggregate"/>'), one: ['x'], junit: 'junit.xml', testDir: 'fitness', seed: 's', conventions: 'c' },
    } }
    const harness = { kind: 'artifact', ref: { ...record, kind: 'TestHarness', id: 'h' } }
    calls.length = 0
    const unit = round(dir, { program: ['npm', 'test'], junit: 'junit.xml' }, head) // the pack's placeholder, never run
    unit.inputs = { ...unit.inputs, harness } as never
    await adapter('junit', { id: 67, op: 'execute', payload: unit })
    expect(published()[0]!.content).toMatchObject({ command: unitRun, tests: [{ name: 'CAP-1/TC-3 per diem', status: 'passed' }], coverage: { min: 90, covered: 1, total: 1 } })
    const levels = round(dir, { levels: {} }, head)
    levels.task.outputs = { outcomes: { type: { kind: 'artifacts', artifactKind: outcome } } } as never
    levels.task.outputIds = { outcomes: 'p-t-1-levels' } as never
    levels.inputs = { record: levels.inputs.record, harness, cases: { kind: 'value', value: { unit: [], fitness: ['CAP-1/TC-4'], integration: [], api: ['CAP-1/TC-1'], e2e: [], manual: [], write: { api: false, e2e: false } } } } as never
    calls.length = 0
    await adapter('junit', { id: 68, op: 'execute', payload: levels })
    expect(published().map((x) => [x.content.level, x.content.selection])).toEqual([['fitness', { mode: 'full', reason: 'no Change set: no baseline commit' }], ['api', { mode: 'full', reason: 'no Change set: no baseline commit' }]]) // the harness's levels, fitness first, not the Executor's empty map
    const half = round(dir, { program: ['npm', 'test'], junit: 'junit.xml', coverage: { min: 80 } }, head)
    const r = await adapter('junit', { id: 69, op: 'execute', payload: half })
    expect(last(r)).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('no report') } }) // a minimum alone measures nothing
    rmSync(dir, { recursive: true })
  })

  it('runs a round\'s case ids as named tests, and unit in full in the plan tier under a TestDesign (39-test-process.md)', async () => {
    const { dir, head } = gitWs()
    writeFileSync(join(dir, 'src', 'claim.ts'), 'a\nB\nc\n')
    const config = { program: tests('<testcase classname="c" name="CAP-1/TC-3 per diem"/>'), junit: 'junit.xml', paths: ['src/**'], affected: [...tests('<testcase classname="c" name="near"/>'), '{files}'] }
    const r = round(dir, config, head)
    r.inputs = { ...r.inputs, cases: { kind: 'value', value: { unit: ['CAP-1/TC-3'], integration: [], api: [], e2e: [], manual: [], write: { api: false, e2e: false } } } } as never
    calls.length = 0
    await adapter('junit', { id: 70, op: 'execute', payload: r })
    expect(published()[0]!.content.selection).toEqual({ mode: 'full', reason: '1 named test not selected: CAP-1/TC-3' }) // the narrowed run missed the case: everything again
    const plan = p(dir, { program: config.program, junit: 'junit.xml' })
    stored['p-baseline'] = { command: ['t'], exitCode: 0, head, tests: [] }
    plan.inputs = { baseline: { kind: 'artifact', ref: baselineRef }, testDesign: { kind: 'artifact', ref: { ...record, kind: 'TestDesign', id: 'td' } } } as never
    calls.length = 0
    await adapter('junit', { id: 71, op: 'execute', payload: plan })
    expect(published()[0]!.content.selection).toEqual({ mode: 'full', reason: 'the TestReport reads every case' })
    rmSync(dir, { recursive: true })
  })
})

describe('testdesign/v1', () => {
  const docs = parseAllDocuments(readFileSync(join(root, 'docs/design/examples/sdlc-domain.yaml'), 'utf8')).map((d) => d.toJS()).filter(Boolean)
  const ref = (kind: string, id: string) => ({ apiVersion: 'sdd.persimmon.ai/v1', kind, namespace: 'demo', id, revision: 1 })
  const art = (kind: string) => {
    const d = docs.find((x) => x.kind === kind)
    stored[d.spec.identity.id] = d.spec.content
    return { kind: 'artifact', ref: ref(kind, d.spec.identity.id) }
  }
  const task = (outputs: Record<string, unknown>, outputIds = {}) => ({ instructions: 'x', parameters: {}, sideEffects: 'none', outputs, outputSchemas: {}, outputIds })
  const p = (inputs: Record<string, unknown>, t: unknown, configuration = {}) => payload({ executor: { type: 'script', configuration, security: { networkAccess: 'deny' } }, credentials: {}, context: [], inputs, task: t })
  const named = (qid: string, status = 'passed') => ({ classname: 'c', name: `${qid} x`, status })

  it('describes a script type that runs no program', async () => {
    const d = last(await adapter('testdesign', { id: 90, op: 'describe', payload: {} }))
    expect(d.result).toMatchObject({ adapterId: 'testdesign/v1', executorTypes: ['script'], contextKinds: [], skillFormats: [] })
  })

  it('answers a round\'s cases from the TestDesign, the Plan task and the Spec', async () => {
    const inputs = { plan: art('Plan'), spec: art('Spec'), testDesign: art('TestDesign'), taskId: { kind: 'value', value: 'T-1' } }
    const r = last(await adapter('testdesign', { id: 91, op: 'execute', payload: p(inputs, task({ cases: { type: { kind: 'value', schema: { type: 'object' } } } })) }))
    expect(r.result.outputs.cases).toEqual({ kind: 'value', value: { unit: ['CAP-1/TC-3', 'CAP-1/TC-8', 'CAP-1/TC-9'], fitness: [], integration: [], api: ['CAP-1/TC-1', 'CAP-1/TC-10'], e2e: [], manual: [], write: { api: true, e2e: false } } })
    const none = last(await adapter('testdesign', { id: 92, op: 'execute', payload: p({ plan: inputs.plan, spec: inputs.spec, taskId: inputs.taskId }, task({ cases: { type: { kind: 'value', schema: { type: 'object' } } } })) }))
    expect(none.result.outputs.cases.value.write).toEqual({ api: false, e2e: false }) // no TestDesign: the build of 35-build-process.md
  })

  it('publishes the TestReport of a built Plan, its thresholds the Executor\'s', async () => {
    const qids = docs.find((x) => x.kind === 'TestDesign').spec.content.cases.map((c: { id: string; level: string }) => [c.level, `CAP-1/${c.id}`])
    stored['p-final'] = { command: ['t'], exitCode: 0, head: 'abc', tests: qids.filter(([l]: string[]) => l === 'unit').map(([, q]: string[]) => named(q)), selection: { mode: 'full', reason: 'plan tier' } }
    // TC-2, a P1 api case, has no test: one of five P1 cases not ok
    stored['p-final-levels-1'] = { command: ['t'], exitCode: 0, level: 'api', tests: qids.filter(([l, q]: string[]) => l === 'api' && q !== 'CAP-1/TC-2').map(([, q]: string[]) => named(q)), selection: { mode: 'full', reason: 'plan tier' } }
    stored['p-t-1'] = { task: 'T-1', summary: 'x', openQuestions: [], defects: [{ id: 'D-1', observed: 'cents dropped', expected: 'x', where: 'y' }] }
    const inputs = {
      plan: art('Plan'), spec: art('Spec'), architecture: art('Architecture'), testDesign: art('TestDesign'),
      final: { kind: 'artifact', ref: ref('TestOutcome', 'p-final') }, finals: { kind: 'artifacts', refs: [ref('TestOutcome', 'p-final-levels-1')] },
      records: { kind: 'artifacts', refs: [ref('AcceptanceRecord', 'p-t-1')] }, evaluation: { kind: 'value', value: { summary: 'TC-2 did not run', residualRisks: ['receipt upload untested'] } },
    }
    calls.length = 0
    const out = { report: { type: { kind: 'artifact', artifactKind: { apiVersion: 'sdd.persimmon.ai/v1', kind: 'TestReport' } } } }
    const r = last(await adapter('testdesign', { id: 93, op: 'execute', payload: p(inputs, task(out, { report: 'submit-a-claim-plan-test-report' })) }))
    expect(r.result.outputs.report.ref).toMatchObject({ kind: 'TestReport', id: 'submit-a-claim-plan-test-report' })
    const content = (calls.find((c) => c.name === 'publishArtifact')!.args as { content: any }).content
    expect(content).toMatchObject({ plan: 'submit-a-claim-plan', spec: 'submit-a-claim', testDesign: 'submit-a-claim-tests', head: 'abc', verdict: { result: 'concerns', rule: 'P0 100%, P1 80%, all 90% ok: P1 below 90%' }, defects: [{ record: 'p-t-1', defect: 'D-1', observed: 'cents dropped' }], evaluation: { summary: 'TC-2 did not run' } })
    calls.length = 0
    await adapter('testdesign', { id: 94, op: 'execute', payload: p(inputs, task(out, { report: 'r' }), { thresholds: { p1: 80 } }) })
    expect((calls.find((c) => c.name === 'publishArtifact')!.args as { content: any }).content.verdict).toMatchObject({ result: 'pass', thresholds: { p0: 100, p1: 80, p1Concerns: 80, overall: 80 } })
  })

  it('refuses a Task with neither output', async () => {
    const r = last(await adapter('testdesign', { id: 95, op: 'execute', payload: p({}, task({ x: { type: { kind: 'value', schema: {} } } })) }))
    expect(r).toMatchObject({ ok: false, error: { code: 'invalid_input', message: expect.stringContaining('a cases or a report output') } })
  })
})

describe('outputSchema', () => {
  it("hoists a port schema's $defs to the root and rewrites its $ref, since the CLI resolves refs from the root", async () => {
    const { outputSchema } = await import('../../adapters/lib/agent.mjs')
    const entity = { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }
    const content = { type: 'object', properties: { items: { type: 'array', items: { $ref: '#/$defs/Entity' } }, deep: { anyOf: [{ $ref: '#/$defs/Entity' }, { type: 'null' }] } }, $defs: { Entity: entity } }
    const task = { outputs: { model: { type: { kind: 'artifact' } }, n: { type: { kind: 'value', schema: { type: 'integer' } } } }, outputSchemas: { model: content } }
    const out = outputSchema(task as never) as { properties: Record<string, unknown>; $defs: Record<string, unknown> }
    expect(out.$defs).toEqual({ 'model.Entity': entity })
    expect(out.properties.model).not.toHaveProperty('$defs')
    expect(JSON.stringify(out.properties.model)).toContain('"$ref":"#/$defs/model.Entity"')
    expect(JSON.stringify(out.properties.model).match(/\$ref/g)).toHaveLength(2)
    expect(out.properties.n).toEqual({ type: 'integer' })
  })
  it('an artifacts port is a list of the frozen content schema', async () => {
    const { outputSchema } = await import('../../adapters/lib/agent.mjs')
    const note = { type: 'object', required: ['title'], properties: { title: { type: 'string' } } }
    const out = outputSchema({ outputs: { adrs: { type: { kind: 'artifacts' } } }, outputSchemas: { adrs: note } } as never) as { properties: Record<string, unknown> }
    expect(out.properties.adrs).toEqual({ type: 'array', maxItems: 999, items: note })
  })
})
