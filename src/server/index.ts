// The local UI server (25-ui.md): the JSON API under `/api/`, the built tools under `/tools/`. Loopback only.
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Engine } from '../engine.js'
import { api, decode } from './api.js'
import { serveStatic, toolsRoot } from './static.js'

export interface ServeOptions {
  port?: number
  toolsDir?: string
  /** no POST: the engine is not listening (25-ui.md read-only) */
  readOnly?: boolean
}

export async function serve(engine: Engine, o: ServeOptions = {}): Promise<{ close: () => Promise<void>; port: number }> {
  const toolsDir = o.toolsDir ?? toolsRoot()
  const server = createServer((req, res) => {
    let path: string
    try {
      path = decode(new URL(req.url ?? '/', 'http://127.0.0.1').pathname)
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ error: { code: 'bad_request', message: (e as Error).message } }))
    }
    if (path === '/') return redirect(res, '/tools/progress/') // where the product stands, and the gate waiting on you (37-progress.md)
    if (path.startsWith('/api/')) return void api(engine, req, res, o.readOnly === true)
    if (path.startsWith('/tools/') && serveStatic(toolsDir, path.slice('/tools/'.length), res)) return
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { code: 'not_found', message: `no route ${req.method} ${path}` } }))
  })
  await new Promise<void>((done) => server.listen(o.port ?? 4747, '127.0.0.1', done)) // loopback only: no option to widen it
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
