// The suite's own Engine callbacks server (22-conformance.md): enough of 07-adapter.md for an Adapter to publish the
// fixture, with the token check an Adapter must survive. Records every call.
import { createServer, type Server } from 'node:http'
import { memoryBlobs } from '../store/memory-blobs.js'

export interface Recorded {
  name: string
  token: string | undefined
  args: Record<string, unknown>
}

export interface FakeCallbacks {
  calls: Recorded[]
  close(): Promise<void>
}

const adapterOnly = new Set(['signal', 'putBlob'])

/** Listens on `socketPath`; `tokens.call` may do everything but `signal`, `tokens.adapter` only `signal` and `putBlob`. */
export function serveCallbacks(socketPath: string, tokens: { call: string; adapter: string }, fixture: { artifact: Record<string, unknown> }): Promise<FakeCallbacks> {
  const blobs = memoryBlobs()
  const calls: Recorded[] = []
  const server: Server = createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      const name = req.url?.split('/').pop() ?? ''
      const token = req.headers.authorization?.replace(/^Bearer /, '')
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(data || '{}') as Record<string, unknown>
      } catch {
        /* reported below */
      }
      calls.push({ name, token, args })
      const fail = (code: string, message: string) => ({ error: { code, message } })
      const body =
        token !== tokens.call && token !== tokens.adapter ? fail('unauthorized', 'unknown or expired token')
        : token === tokens.adapter && !adapterOnly.has(name) ? fail('forbidden', `${name} not allowed for an adapter token`)
        : name === 'signal' && token === tokens.call ? fail('forbidden', 'signal not allowed for a call token')
        : handle(name, args, blobs, fixture)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    })
  })
  return new Promise((resolve) => server.listen(socketPath, () => resolve({ calls, close: () => new Promise((r) => server.close(() => r())) })))
}

function handle(name: string, args: Record<string, unknown>, blobs: ReturnType<typeof memoryBlobs>, fixture: { artifact: Record<string, unknown> }): { result?: unknown; error?: { code: string; message: string } } {
  switch (name) {
    case 'getArtifact':
      return { result: fixture.artifact }
    case 'putBlob':
      if (typeof args.bytes !== 'string' || typeof args.mediaType !== 'string') return { error: { code: 'invalid_input', message: 'putBlob needs bytes (base64) and mediaType' } }
      return { result: blobs.put(Buffer.from(args.bytes, 'base64'), args.mediaType) }
    case 'getBlob': {
      const b = blobs.get(`blob://${String(args.digest).replace(/^sha256:/, '')}`)
      return b ? { result: { bytes: Buffer.from(b.bytes).toString('base64'), mediaType: b.mediaType } } : { error: { code: 'not_found', message: `blob ${String(args.digest)}` } }
    }
    case 'publishArtifact': {
      const a = args as { kind?: { apiVersion?: string; kind?: string }; id?: string; content?: unknown; representations?: { digest?: string }[] }
      if (!a.kind?.apiVersion || !a.kind.kind || typeof a.id !== 'string' || a.content === undefined) return { error: { code: 'invalid_input', message: 'publishArtifact needs kind, id and content' } }
      const unknown = (a.representations ?? []).find((r) => !r.digest || !blobs.get(`blob://${r.digest.replace(/^sha256:/, '')}`))
      if (unknown) return { error: { code: 'invalid_input', message: `representation digest ${unknown.digest ?? '(none)'} was never put` } }
      return { result: { apiVersion: a.kind.apiVersion, kind: a.kind.kind, namespace: 'conformance', id: a.id, revision: 1 } }
    }
    case 'log':
    case 'signal':
      return { result: null }
    case 'getResource':
    case 'list':
    case 'getKindSchema':
      return { error: { code: 'not_found', message: `${name}: the conformance suite holds no Resources` } }
    default:
      return { error: { code: 'invalid_input', message: `unknown callback ${name}` } }
  }
}
