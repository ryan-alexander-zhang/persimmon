// Engine callbacks server over a unix socket (local mode): POST /callbacks/<name>, bearer token, JSON args.
import { createServer, type Server } from 'node:http'
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { WriteError } from '../handler/write.js'
import { type CallbackEngine, callback, CallbackError } from './callbacks.js'

const status: Record<CallbackError['code'], number> = { unauthorized: 401, forbidden: 403, not_found: 404, invalid_input: 400 }
/** putBlob carries base64 bytes; 64 MiB of text is the ceiling. */
const maxBody = 64 * 1024 * 1024

export function callbackServer(engine: CallbackEngine): Server {
  return createServer((req, res) => {
    const m = /^\/callbacks\/([a-zA-Z]+)$/.exec(req.url ?? '')
    const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
    if (req.method !== 'POST' || !m) return reply(res, 400, { error: { code: 'invalid_input', message: 'POST /callbacks/<name>' } })
    if (!token) return reply(res, 401, { error: { code: 'unauthorized', message: 'bearer token required' } })
    let body = ''
    let tooBig = false
    req.on('data', (c: Buffer) => {
      body += c.toString()
      if (body.length > maxBody && !tooBig) {
        tooBig = true
        reply(res, 413, { error: { code: 'invalid_input', message: `body over ${maxBody} bytes` } })
        req.destroy()
      }
    })
    req.on('end', () => {
      if (tooBig) return
      try {
        const args = body ? (JSON.parse(body) as Record<string, unknown>) : {}
        reply(res, 200, { result: callback(engine, token, m[1] as string, args) ?? null })
      } catch (e) {
        if (e instanceof CallbackError) return reply(res, status[e.code], { error: { code: e.code, message: e.message } })
        if (e instanceof WriteError) return reply(res, 400, { error: { code: 'invalid_input', message: e.message } }) // bad publish content or shape
        reply(res, 500, { error: { code: 'internal', message: (e as Error).message } })
      }
    })
  })
}

function reply(res: import('node:http').ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

/** Listens on the unix socket behind `unix://<path>`; a stale socket file is removed. */
export function listenUnix(server: Server, endpoint: string): Promise<void> {
  const path = endpoint.replace(/^unix:\/\//, '')
  if (existsSync(path)) unlinkSync(path)
  return new Promise((resolve) =>
    server.listen(path, () => {
      chmodSync(path, 0o600) // only this user reaches the engine
      resolve()
    }),
  )
}
