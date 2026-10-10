// The suite's own Engine callbacks server (22-conformance.md): enough of 07-adapter.md for an Adapter to publish the
// fixture, with the token check an Adapter must survive. Records every call.
import { createServer } from 'node:http'
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

/** Listens on `socketPath`; `tokens.call` may do everything, `tokens.adapter` only `putBlob` (07-adapter.md Token table). */
export function serveCallbacks(socketPath: string, tokens: { call: string; adapter: string }, fixture: { artifact: Record<string, unknown> }): Promise<FakeCallbacks> {
  const blobs = memoryBlobs()
  const calls: Recorded[] = []
  const server = createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      const name = req.url?.split('/').pop() ?? ''
      const token = req.headers.authorization?.replace(/^Bearer /, '')
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(data || '{}') as Record<string, unknown>
      } catch {
        /* handled as an empty call */
      }
      calls.push({ name, token, args })
      const body =
        token !== tokens.call && token !== tokens.adapter ? { error: { code: 'unauthorized', message: 'unknown or expired token' } }
        : token === tokens.adapter && name !== 'putBlob' ? { error: { code: 'forbidden', message: `${name} not allowed for an adapter token` } }
        : handle(name, args, blobs, fixture)
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(body))
    })
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => resolve({ calls, close: () => new Promise((r) => server.close(() => r())) }))
  })
}

function handle(name: string, args: Record<string, unknown>, blobs: ReturnType<typeof memoryBlobs>, fixture: { artifact: Record<string, unknown> }): { result?: unknown; error?: { code: string; message: string } } {
  switch (name) {
    case 'getArtifact':
      return { result: fixture.artifact }
    case 'putBlob':
      if (typeof args.bytes !== 'string' || typeof args.mediaType !== 'string') return { error: { code: 'invalid_input', message: 'putBlob needs bytes (base64) and mediaType' } }
      return { result: blobs.put(Buffer.from(args.bytes, 'base64'), args.mediaType) }
    case 'publishArtifact': {
      const a = args as { kind?: { apiVersion?: string; kind?: string }; id?: string; content?: unknown; representations?: { digest?: string }[] }
      if (!a.kind?.apiVersion || !a.kind.kind || typeof a.id !== 'string' || a.content === undefined) return { error: { code: 'invalid_input', message: 'publishArtifact needs kind, id and content' } }
      const unknown = (a.representations ?? []).find((r) => !r.digest || !blobs.get(`blob://${r.digest.replace(/^sha256:/, '')}`))
      if (unknown) return { error: { code: 'invalid_input', message: `representation digest ${unknown.digest ?? '(none)'} was never put` } }
      return { result: { apiVersion: a.kind.apiVersion, kind: a.kind.kind, namespace: 'conformance', id: a.id, revision: 1 } }
    }
    case 'log':
      return { result: null }
    default:
      return { error: { code: 'invalid_input', message: `${name}: the conformance suite serves getArtifact, putBlob, publishArtifact and log` } }
  }
}
