import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAllDocuments } from 'yaml'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCli } from '../cli/index.js'
import { openEngine } from '../cli/context.js'
import type { Engine } from '../engine.js'
import { serve } from './index.js'

const KIND = 'eventstormings.sdd.persimmon.ai'
const model = (name: string) => ({ version: '4.0', meta: { name, level: 'big-picture' }, contexts: [], contextRelationships: [], nodes: [], edges: [] })

describe('persimmon ui server', () => {
  let dir: string
  let tools: string
  let engine: Engine
  let server: { close: () => Promise<void>; port: number }
  const url = (path: string) => `http://127.0.0.1:${server.port}${path}`
  const get = (path: string) => fetch(url(path))
  const post = (path: string, body: unknown) => fetch(url(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'persimmon-ui-'))
    tools = join(dir, 'tools')
    mkdirSync(join(tools, 'demo'), { recursive: true })
    writeFileSync(join(tools, 'demo', 'index.html'), '<!doctype html><title>demo</title>')
    writeFileSync(join(tools, 'demo', 'app.js'), 'export const x = 1\n')
    const cli = { cwd: dir, out: () => {}, err: () => {} }
    expect(await runCli(['init'], cli)).toBe(0) // the SDLC pack's kinds come with init
    engine = await openEngine(cli)
    server = await serve(engine, { port: 0, toolsDir: tools })
  })
  afterEach(async () => {
    await server.close()
    await engine.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('lists revisioned kinds, creates revisions and reads them back', async () => {
    const kinds = (await (await get('/api/kinds')).json()) as { name: string }[]
    expect(kinds).toContainEqual({ name: KIND, apiVersion: 'sdd.persimmon.ai/v1', kind: 'EventStorming', plural: 'eventstormings' })

    const first = await post(`/api/artifacts/default/${KIND}/x`, { content: model('x') })
    expect([first.status, await first.json()]).toEqual([201, { apiVersion: 'sdd.persimmon.ai/v1', kind: 'EventStorming', namespace: 'default', id: 'x', revision: 1 }])
    const second = await post(`/api/artifacts/default/${KIND}/x`, { content: model('x again') })
    expect([second.status, ((await second.json()) as { revision: number }).revision]).toEqual([201, 2])

    expect(await (await get(`/api/artifacts?kind=${KIND}`)).json()).toEqual([{ apiVersion: 'sdd.persimmon.ai/v1', kind: 'EventStorming', namespace: 'default', id: 'x', revision: 2 }])
    expect(await (await get(`/api/artifacts/default/${KIND}/x`)).json()).toEqual({ apiVersion: 'sdd.persimmon.ai/v1', kind: 'EventStorming', namespace: 'default', id: 'x', revisions: [1, 2] })

    const rev = (await (await get(`/api/artifacts/default/${KIND}/x/2`)).json()) as Record<string, never>
    expect(rev).toMatchObject({
      apiVersion: 'sdd.persimmon.ai/v1',
      kind: 'EventStorming',
      metadata: { name: 'x.r2', namespace: 'default' },
      spec: { identity: { id: 'x', revision: 2 }, content: model('x again'), provenance: { inputs: [], actor: { kind: 'user', id: 'local' } } },
      status: { representations: [] },
    })
    expect((rev.status as { contentDigest: string }).contentDigest).toMatch(/^sha256:/)
    expect(await (await get(`/api/artifacts/default/${KIND}/x/latest`)).json()).toEqual(rev)
  })

  it('answers 400 on content the kind refuses and 404 on what is not there', async () => {
    const bad = await post(`/api/artifacts/default/${KIND}/y`, { content: { title: 'x' } })
    expect(bad.status).toBe(400)
    expect(((await bad.json()) as { error: { message: string } }).error.message).toContain("must have required property 'version'")
    // DSL 4.1: a context carries the subdomain it realises, and the kind refuses an empty one
    const tagged = (subdomain: string) => ({ ...model('t'), version: '4.1', contexts: [{ id: 'c', name: 'C', order: 0, subdomain }] })
    expect((await post(`/api/artifacts/default/${KIND}/t`, { content: tagged('claims') })).status).toBe(201)
    expect((await post(`/api/artifacts/default/${KIND}/t`, { content: tagged('') })).status).toBe(400)

    expect((await get('/api/artifacts?kind=nothings.example.com')).status).toBe(404)
    expect((await post('/api/artifacts/default/nothings.example.com/x', { content: {} })).status).toBe(404)
    expect((await get(`/api/artifacts/default/${KIND}/missing`)).status).toBe(404)
    expect((await get(`/api/artifacts/default/${KIND}/missing/1`)).status).toBe(404)
    expect((await get('/api/nothing')).status).toBe(404)
  })

  it("serves a revision's representation as its bytes, sandboxed and unsniffed; an unknown name is 404", async () => {
    const html = engine.store.blobs.put(Buffer.from('<h1>screens</h1><script>fetch("/api/kinds")</script>'), 'text/html')
    const scope = { uid: 'test', key: 'k' }
    engine.store.resources.stage({
      apiVersion: 'sdd.persimmon.ai/v1', kind: 'Design', metadata: { name: 'ui.r1', namespace: 'default' },
      spec: { identity: { id: 'ui', revision: 1 }, content: {}, provenance: { producerRef: { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', namespace: 'default', name: 'run', uid: 'uid-run' }, inputs: [], actor: { kind: 'user', id: 'local' } } },
      status: { contentDigest: 'sha256:' + '0'.repeat(64), representations: [{ name: 'screens', mediaType: 'text/html', digest: html.digest }, { name: 'ghost', mediaType: 'text/plain', digest: 'sha256:' + 'f'.repeat(64) }] },
    }, scope)
    engine.store.resources.commitScope(scope)
    const page = await get('/api/artifacts/default/designs.sdd.persimmon.ai/ui/1/screens')
    expect([page.status, page.headers.get('content-type'), page.headers.get('content-security-policy'), page.headers.get('x-content-type-options'), page.headers.get('cross-origin-resource-policy'), page.headers.get('content-length')]).toEqual([200, 'text/html; charset=utf-8', 'sandbox', 'nosniff', 'same-origin', '52'])
    expect(await page.text()).toBe('<h1>screens</h1><script>fetch("/api/kinds")</script>') // the bytes as published; the policy, not a rewrite, keeps the script from running
    expect((await get('/api/artifacts/default/designs.sdd.persimmon.ai/ui/latest/screens')).status).toBe(200)
    expect((await get('/api/artifacts/default/designs.sdd.persimmon.ai/ui/1/screens.html')).status).toBe(200) // the file name a sibling page links
    const none = await get('/api/artifacts/default/designs.sdd.persimmon.ai/ui/1/mockups')
    expect([none.status, (await none.json()).error.message]).toEqual([404, 'designs.sdd.persimmon.ai ui revision 1 has no representation mockups'])
    const gone = await get('/api/artifacts/default/designs.sdd.persimmon.ai/ui/1/ghost')
    expect([gone.status, (await gone.json()).error.code]).toEqual([500, 'internal']) // a named blob that is not in the store is ours, not the caller's
    expect((await get('/api/artifacts/default/designs.sdd.persimmon.ai/ui/1/screens/more')).status).toBe(404)
    const rebound = await new Promise<number>((resolve) => {
      request({ host: '127.0.0.1', port: server.port, path: '/api/artifacts/default/designs.sdd.persimmon.ai/ui/1/screens', headers: { host: `evil.example:${server.port}` } }, (res) => resolve(res.statusCode!)).end()
    })
    expect(rebound).toBe(403)
  })

  it('keeps other origins out and refuses what it cannot parse', async () => {
    // fetch drops a Host header, so the rebound request goes through node:http
    const rebound = await new Promise<{ status: number; code: string }>((resolve) => {
      request({ host: '127.0.0.1', port: server.port, path: '/api/kinds', headers: { host: `evil.example:${server.port}` } }, (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode!, code: JSON.parse(text).error.code }))
      }).end()
    })
    expect(rebound).toEqual({ status: 403, code: 'forbidden' })
    const plain = await fetch(url(`/api/artifacts/default/${KIND}/x`), { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ content: model('x') }) })
    expect([plain.status, (await plain.json()).error.code]).toEqual([415, 'unsupported_media_type'])
    const escaped = await get('/api/artifacts/default/%zz/x')
    expect([escaped.status, (await escaped.json()).error.code]).toEqual([400, 'bad_request'])
    const top = await get('/%')
    expect([top.status, (await top.json()).error.code]).toEqual([400, 'bad_request'])
    expect((await post(`/api/artifacts/default/${KIND}/forked`, { content: model('forked') })).status).toBe(201)
    const stale = await post(`/api/artifacts/default/${KIND}/forked`, { content: model('forked'), base: 0 })
    expect([stale.status, (await stale.json()).error.code]).toEqual([409, 'conflict'])
    expect((await post(`/api/artifacts/default/${KIND}/forked`, { content: model('forked'), base: 1 })).status).toBe(201)
  })

  it('serves a tool, falls back to its index.html, and redirects the root', async () => {
    const js = await get('/tools/demo/app.js')
    expect([js.status, js.headers.get('content-type')]).toEqual([200, 'text/javascript; charset=utf-8'])
    expect(await js.text()).toBe('export const x = 1\n')
    const index = await get('/tools/demo/')
    expect([index.status, index.headers.get('content-type'), await index.text()]).toEqual([200, 'text/html; charset=utf-8', '<!doctype html><title>demo</title>'])
    expect(await (await get('/tools/demo/board/deep-link')).text()).toBe('<!doctype html><title>demo</title>') // single-page app route
    expect((await get('/tools/nothing/')).status).toBe(404)
    expect((await get('/tools/demo/../../persimmon.yaml')).status).toBe(404)

    const root = await fetch(url('/'), { redirect: 'manual' })
    expect([root.status, root.headers.get('location')]).toEqual([302, '/tools/progress/'])
  })

  it('the Inbox lists a TaskRun parked on a human, serves its form and answers it through the complete path (37-progress.md)', async () => {
    const vr = { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/ValidationResult' } } }
    const ask = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'ask', namespace: 'default' }, spec: { inputs: {}, outputs: { result: vr }, executorRef: { kind: 'Executor', name: 'local-reviewer' }, action: { instructions: 'Answer' }, timeout: '1h', sideEffects: 'none' } }
    const wf = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'ask-wf', namespace: 'default' }, spec: { entry: ['ask'], steps: [{ id: 'ask', uses: { kind: 'Task', name: 'ask' }, timeout: '1h' }], transitions: [{ id: 'done', from: [{ stepRef: 'ask', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '3h' } }
    for (const d of [ask, wf]) await engine.apply(d as never)
    await engine.create({ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'r1', namespace: 'default' }, spec: { workflowRef: { kind: 'Workflow', name: 'ask-wf' }, inputs: {}, origin: { kind: 'manual' } } } as never)
    await engine.drain()

    const list = (await (await get('/api/inbox')).json()) as { directory: string; parked: unknown[] }
    expect(list).toEqual({ directory: dir, parked: [{ namespace: 'default', taskRun: 'r1-ask', task: 'ask', deadline: expect.any(String), form: true, verdict: true }] })
    const runs = (await (await get('/api/runs')).json()) as { directory: string; runs: Record<string, unknown>[] }
    expect(runs.directory).toBe(dir)
    expect(runs.runs).toEqual([expect.objectContaining({ namespace: 'default', name: 'r1', workflow: 'ask-wf', phase: 'Running', steps: { ask: { phase: 'Pending' } }, upstream: [], parked: [{ taskRun: 'r1-ask', task: 'ask', verdict: true }] })])
    const tree = (await (await get('/api/runs/default/r1')).json()) as { kind: string; label: string; children: Record<string, unknown>[] }
    expect([tree.kind, tree.label]).toEqual(['WorkflowRun', 'r1'])
    expect(tree.children).toEqual([expect.objectContaining({ kind: 'TaskRun', name: 'r1-ask', label: 'ask', task: 'ask', phase: 'Waiting', waitingReason: 'human', parked: true, children: [] })])
    expect((await get('/api/runs/default/nope')).status).toBe(404)
    const form = (await (await get('/api/inbox/default/r1-ask')).json()) as { instructions: string; verdict: boolean }
    expect([form.instructions, form.verdict]).toEqual(['Answer', true])
    expect((await get('/api/inbox/default/nope')).status).toBe(404)

    const bad = await post('/api/inbox/default/r1-ask', { outputs: { result: { kind: 'value', value: { passed: 'yes' } } } })
    expect([bad.status, (await bad.json()).error.message]).toEqual([400, expect.stringMatching(/^complete: result: /)]) // the port schema, as at the terminal
    const ok = await post('/api/inbox/default/r1-ask', { outputs: { result: { kind: 'value', value: { passed: false, findings: [{ severity: 'error', code: 'blocking_1', message: 'G-1: too vague' }], evidence: [] } } } })
    expect([ok.status, await ok.json()]).toEqual([200, { answered: 'TaskRun/r1-ask' }])
    await vi.waitFor(() => expect(engine.store.resources.get({ kind: 'WorkflowRun', namespace: 'default', name: 'r1' })?.status).toMatchObject({ phase: 'Succeeded' }))
    expect(existsSync(join(dir, '.persimmon', 'inbox', 'r1-ask.yaml'))).toBe(false) // the form is answered
    expect(((await (await get('/api/inbox')).json()) as { parked: unknown[] }).parked).toEqual([])
    const again = await post('/api/inbox/default/r1-ask', { outputs: {} })
    expect([again.status, (await again.json()).error.message]).toEqual([409, 'TaskRun/r1-ask is Succeeded, not waiting for a human'])

    expect(((await (await get('/api/runs')).json()) as { runs: { phase: string; parked: unknown[] }[] }).runs[0]).toMatchObject({ phase: 'Succeeded', parked: [] })
    expect(await (await get('/api/kinds/prds.sdd.persimmon.ai')).json()).toMatchObject({ kind: 'Prd', schema: { type: 'object', properties: { goals: { type: 'array' } } } })
    expect((await get('/api/kinds/tasks.persimmon.ai')).status).toBe(404)
  })

  it('a run\'s upstream is every artifact its refs reach through provenance (37-progress.md)', async () => {
    const docs = parseAllDocuments(readFileSync('docs/design/examples/sdlc-domain.yaml', 'utf8')).map((d) => d.toJS()).filter(Boolean)
    const prd = docs.find((d) => d.kind === 'Prd')
    await engine.create(prd)
    const ref = { apiVersion: 'sdd.persimmon.ai/v1', kind: 'Prd', namespace: 'default', id: prd.spec.identity.id, revision: 1 }
    const port = { type: { kind: 'artifact', artifactKind: { apiVersion: 'sdd.persimmon.ai/v1', kind: 'Prd' } } }
    const ask = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'ask', namespace: 'default' }, spec: { inputs: { prd: port }, outputs: { result: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/ValidationResult' } } } }, executorRef: { kind: 'Executor', name: 'local-reviewer' }, action: { instructions: 'Answer' }, timeout: '1h', sideEffects: 'none' } }
    const wf = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'ask-wf', namespace: 'default' }, spec: { inputs: { prd: port }, entry: ['ask'], steps: [{ id: 'ask', uses: { kind: 'Task', name: 'ask' }, inputs: { prd: { fromInput: 'prd' } }, timeout: '1h' }], transitions: [{ id: 'done', from: [{ stepRef: 'ask', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '3h' } }
    for (const d of [ask, wf]) await engine.apply(d as never)
    await engine.create({ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'r2', namespace: 'default' }, spec: { workflowRef: { kind: 'Workflow', name: 'ask-wf' }, inputs: { prd: { kind: 'artifact', ref } }, origin: { kind: 'manual' } } } as never)
    const runs = (await (await get('/api/runs')).json()) as { runs: { upstream: unknown[] }[] }
    expect(runs.runs[0]!.upstream).toEqual([{ kind: 'Prd', id: 'expense-claims' }]) // a hand-written revision cites nothing further
  })

  it('a project directory sharing the store neither lists nor answers another directory\'s TaskRun (08-store.md)', async () => {
    const ask = { apiVersion: 'persimmon.ai/v1', kind: 'Task', metadata: { name: 'ask', namespace: 'default' }, spec: { inputs: {}, outputs: { result: { type: { kind: 'value', schema: { $ref: 'persimmon.ai/v1#/ValidationResult' } } } }, executorRef: { kind: 'Executor', name: 'local-reviewer' }, action: { instructions: 'Answer' }, timeout: '1h', sideEffects: 'none' } }
    const wf = { apiVersion: 'persimmon.ai/v1', kind: 'Workflow', metadata: { name: 'ask-wf', namespace: 'default' }, spec: { entry: ['ask'], steps: [{ id: 'ask', uses: { kind: 'Task', name: 'ask' }, timeout: '1h' }], transitions: [{ id: 'done', from: [{ stepRef: 'ask', outcomes: ['Succeeded'] }], to: [{ terminal: 'Succeeded' }] }], timeout: '3h' } }
    for (const d of [ask, wf]) await engine.apply(d as never)
    await engine.create({ apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', metadata: { name: 'r1', namespace: 'default' }, spec: { workflowRef: { kind: 'Workflow', name: 'ask-wf' }, inputs: {}, origin: { kind: 'manual' } } } as never)
    await engine.drain()
    const tree = join(dir, 'tree')
    mkdirSync(tree)
    writeFileSync(join(tree, 'persimmon.yaml'), `mode: local\nstore: {sqlite: ${join(dir, '.persimmon', 'persimmon.db')}}\nblobs: ${join(dir, '.persimmon', 'blobs')}\n`)
    const other = await openEngine({ cwd: tree, out: () => {}, err: () => {} })
    const at = await serve(other, { port: 0, toolsDir: tools })
    try {
      const there = (path: string, init?: RequestInit) => fetch(`http://127.0.0.1:${at.port}${path}`, init)
      expect(await (await there('/api/inbox')).json()).toEqual({ directory: tree, parked: [] })
      const refused = await there('/api/inbox/default/r1-ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outputs: {} }) })
      expect([refused.status, (await refused.json()).error.message]).toEqual([409, `TaskRun/r1-ask belongs to project directory ${dir}; answer it there`])
    } finally {
      await at.close()
      await other.close()
    }
  })
})
