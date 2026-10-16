// The JSON API over the Engine (25-ui.md): revisioned kinds, their artifacts, one revision, its representations, create the next one.
// Local mode binds loopback and trusts the user, so there is no auth here; server mode adds https and tokens.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRevision } from '../cli/create.js'
import type { Engine } from '../engine.js'
import type { KindDefinition } from '../kind-definition/types.js'
import type { Resource } from '../resource/types.js'

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

const maxBody = 16 * 1024 * 1024

/** Answers one `/api/...` request. */
export async function api(engine: Engine, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    // a page on any origin can reach loopback: a DNS-rebound host reads the Store, a cross-site no-cors POST writes it;
    // the Host header and a JSON content type (which forces a CORS preflight no page passes) keep it to this user's tabs
    const port = (req.socket.address() as { port?: number }).port
    const host = req.headers.host ?? ''
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, 'forbidden', `host ${host} is not this server`)
    if (req.method === 'POST' && !/^application\/json\b/.test(req.headers['content-type'] ?? '')) throw new HttpError(415, 'unsupported_media_type', 'POST needs content-type application/json')
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const path = decode(url.pathname).split('/').filter(Boolean).slice(1) // after `api`
    const { status, body, raw } = await route(engine, req, path, url)
    if (raw) {
      // an agent's HTML is untrusted and would run on this origin: `sandbox` with no token runs no script, submits no form,
      // opens no popup, and gives the page an opaque origin; `nosniff` keeps a text/plain blob from being read as HTML;
      // `same-origin` keeps any site the user visits from pulling a .js or .css representation in with <script src>
      res.writeHead(status, {
        'content-type': /^text\//.test(raw.mediaType) ? `${raw.mediaType}; charset=utf-8` : raw.mediaType,
        'content-length': raw.bytes.length,
        'x-content-type-options': 'nosniff',
        'content-security-policy': 'sandbox',
        'cross-origin-resource-policy': 'same-origin',
      })
      res.end(raw.bytes)
    } else send(res, status, body)
  } catch (e) {
    const { status, code } = e instanceof HttpError ? e : { status: 500, code: 'internal' }
    send(res, status, { error: { code, message: (e as Error).message } })
  }
}

/** A malformed escape is the caller's error, not ours. */
export function decode(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    throw new HttpError(400, 'bad_request', `path ${path}: malformed escape`)
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function route(engine: Engine, req: IncomingMessage, path: string[], url: URL): Promise<{ status: number; body?: unknown; raw?: { bytes: Uint8Array; mediaType: string } }> {
  const method = req.method ?? 'GET'
  const [head, ...rest] = path
  if (head === 'kinds' && rest.length === 0 && method === 'GET')
    return { status: 200, body: engine.kinds.definitions().filter((kd) => kd.spec.revisioned).map((kd) => ({ name: kd.metadata.name, apiVersion: apiVersionOf(kd), kind: kd.spec.names.kind, plural: kd.spec.names.plural })) }
  if (head !== 'artifacts') throw new HttpError(404, 'not_found', `no route ${method} ${url.pathname}`)

  if (rest.length === 0 && method === 'GET') {
    const kindName = url.searchParams.get('kind')
    if (!kindName) throw new HttpError(400, 'bad_request', 'kind query parameter required')
    const kd = revisionedKind(engine, kindName)
    const namespace = url.searchParams.get('namespace') ?? engine.dispatch.defaultNamespace
    const latest = new Map<string, number>()
    for (const r of engine.store.resources.list(kd.spec.names.kind, namespace)) {
      const { id, revision } = identityOf(r)
      if (revision > (latest.get(id) ?? 0)) latest.set(id, revision)
    }
    return { status: 200, body: [...latest].map(([id, revision]) => ({ apiVersion: apiVersionOf(kd), kind: kd.spec.names.kind, namespace, id, revision })) }
  }

  const [namespace, kindName, id, revision, representation] = rest
  if (!namespace || !kindName || !id || rest.length > 5) throw new HttpError(404, 'not_found', `no route ${method} ${url.pathname}`)
  const kd = revisionedKind(engine, kindName)

  if (method === 'POST' && rest.length === 3) {
    const { content, base } = (await body(req)) as { content?: unknown; base?: unknown }
    if (content === undefined) throw new HttpError(400, 'bad_request', 'body {content} required')
    if (base !== undefined) {
      // the editor names the revision it edited; a save over a newer one would silently fork the lineage
      const last = engine.store.resources.listRevisions(kd.spec.names.kind, namespace, id).at(-1)
      const latest = last ? identityOf(last).revision : 0
      if (base !== latest) throw new HttpError(409, 'conflict', `${id} is at revision ${latest}, not ${String(base)}; reload before saving`)
    }
    const r = await write(engine, { apiVersion: apiVersionOf(kd), kind: kd.spec.names.kind, namespace, id }, content)
    drainAfter(engine) // a publish may fire a Trigger; nothing else drains while ui runs (08-store.md)
    return { status: 201, body: { apiVersion: r.apiVersion, kind: r.kind, namespace, ...identityOf(r) } }
  }
  if (method !== 'GET') throw new HttpError(404, 'not_found', `no route ${method} ${url.pathname}`)

  const revisions = engine.store.resources.listRevisions(kd.spec.names.kind, namespace, id)
  if (rest.length === 3) {
    if (revisions.length === 0) throw new HttpError(404, 'not_found', `${kindName} ${id} not found in ${namespace}`)
    return { status: 200, body: { apiVersion: apiVersionOf(kd), kind: kd.spec.names.kind, namespace, id, revisions: revisions.map((r) => identityOf(r).revision) } }
  }
  const wanted = revision === 'latest' ? identityOf(revisions.at(-1) ?? throwNotFound(kindName, namespace, id)).revision : Number(revision)
  if (!Number.isInteger(wanted)) throw new HttpError(400, 'bad_request', `revision ${revision}: a number or latest`)
  const found = engine.store.resources.get({ kind: kd.spec.names.kind, namespace, name: `${id}.r${wanted}` })
  if (!found) throw new HttpError(404, 'not_found', `${kindName} ${id} revision ${wanted} not found in ${namespace}`)
  if (representation === undefined) return { status: 200, body: found }
  // one representation's bytes (18-artifact.md): `json` is the content, the rest the files the agent left
  // by name, else by `<name>.<ext>`: a page links its sibling by the file name the agent wrote, the name is the stem
  const reps = (found.status as { representations?: { name: string; mediaType: string; digest: string }[] } | undefined)?.representations ?? []
  const rep = reps.find((r) => r.name === representation) ?? reps.find((r) => r.name === representation.replace(/\.[^.]+$/, ''))
  if (!rep) throw new HttpError(404, 'not_found', `${kindName} ${id} revision ${wanted} has no representation ${representation}`)
  const blob = engine.store.blobs.get(`blob://${rep.digest.replace(/^sha256:/, '')}`)
  if (!blob) throw new HttpError(500, 'internal', `${representation}: blob ${rep.digest} missing`)
  return { status: 200, raw: { bytes: blob.bytes, mediaType: rep.mediaType } }
}

/** The create path's errors are the user's input: a taken revision is a conflict, anything else the engine refused is bad content. */
async function write(engine: Engine, ref: { apiVersion: string; kind: string; namespace: string; id: string }, content: unknown): Promise<Resource> {
  try {
    return await createRevision(engine, ref, content)
  } catch (e) {
    const message = (e as Error).message
    throw new HttpError(/is not the next one|exists with a different spec/.test(message) ? 409 : 400, /is not the next one|exists with a different spec/.test(message) ? 'conflict' : 'invalid', message)
  }
}

const drains = new WeakMap<Engine, Promise<void>>()
/** One drain at a time per engine, after the response; a failure is the engine's log, not the caller's. */
function drainAfter(engine: Engine): void {
  const next = (drains.get(engine) ?? Promise.resolve()).then(() => engine.drain()).catch(() => undefined)
  drains.set(engine, next)
}

function revisionedKind(engine: Engine, name: string): KindDefinition {
  const kd = engine.kinds.definitions().find((k) => k.metadata.name === name && k.spec.revisioned)
  if (!kd) throw new HttpError(404, 'unknown_kind', `no revisioned kind ${name}`)
  return kd
}

const apiVersionOf = (kd: KindDefinition) => `${kd.spec.group}/${kd.spec.versions.at(-1)!.name}`
const identityOf = (r: Resource) => (r.spec as { identity: { id: string; revision: number } }).identity

function throwNotFound(kind: string, namespace: string, id: string): never {
  throw new HttpError(404, 'not_found', `${kind} ${id} not found in ${namespace}`)
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const c of req) {
    size += (c as Buffer).length
    if (size > maxBody) throw new HttpError(413, 'payload_too_large', `body over ${maxBody} bytes`)
    chunks.push(c as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
  } catch (e) {
    throw new HttpError(400, 'bad_request', `body: ${(e as Error).message}`)
  }
}
