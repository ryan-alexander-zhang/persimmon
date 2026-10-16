import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
    expect([page.status, page.headers.get('content-type'), page.headers.get('content-security-policy'), page.headers.get('x-content-type-options'), page.headers.get('content-length')]).toEqual([200, 'text/html', 'sandbox', 'nosniff', '52'])
    expect(await page.text()).toBe('<h1>screens</h1><script>fetch("/api/kinds")</script>') // the bytes as published; the policy, not a rewrite, keeps the script off the API
    expect((await get('/api/artifacts/default/designs.sdd.persimmon.ai/ui/latest/screens')).status).toBe(200)
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
    expect([root.status, root.headers.get('location')]).toEqual([302, '/tools/eventstorming/'])
  })
})
