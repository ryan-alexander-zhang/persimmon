// The local UI server (25-ui.md): the JSON API under `/api/`, the built tools under `/tools/`. Loopback only.
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Engine } from '../engine.js'
import { api } from './api.js'
import { serveStatic, toolsRoot } from './static.js'

export interface ServeOptions {
  port?: number
  host?: string
  toolsDir?: string
}

export async function serve(engine: Engine, o: ServeOptions = {}): Promise<{ close: () => Promise<void>; port: number }> {
  const toolsDir = o.toolsDir ?? toolsRoot()
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
    if (path === '/') return redirect(res, '/tools/eventstorming/')
    if (path.startsWith('/api/')) return void api(engine, req, res)
    if (path.startsWith('/tools/') && serveStatic(toolsDir, path.slice('/tools/'.length), res)) return
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { code: 'not_found', message: `no route ${req.method} ${path}` } }))
  })
  await new Promise<void>((done) => server.listen(o.port ?? 4747, o.host ?? '127.0.0.1', done))
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections() // a kept-alive browser tab would hold the close open
        server.close(() => done())
      }),
  }
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location })
  res.end()
}
