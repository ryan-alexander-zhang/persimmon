import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(await runCli(['init'], cli)).toBe(0)
    expect(await runCli(['apply', 'packs/ai-native/global/10-artifact-kinds.yaml', '--global'], cli)).toBe(0)
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
