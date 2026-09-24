import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import type { CredentialStore } from '../store/store.js'
import type { AdapterSpec, CallOptions, CallOutcome, Request, Response, StreamLine } from './types.js'

export class TransportError extends Error {}

/** Sends one request over the Adapter's transport. stdio: one process per call (07-adapter.md). */
export async function call(
  spec: AdapterSpec,
  op: string,
  payload: Record<string, unknown>,
  credentials: CredentialStore,
  o: CallOptions = {},
): Promise<CallOutcome> {
  const request: Request = { protocol: 'persimmon.adapter/v1', id: randomUUID(), op, payload }
  return spec.transport === 'stdio' ? stdio(spec, request, credentials, o) : http(spec, request, credentials, o)
}

function stdio(spec: AdapterSpec, request: Request, credentials: CredentialStore, o: CallOptions): Promise<CallOutcome> {
  const [cmd, ...args] = spec.command as [string, ...string[]]
  const env: Record<string, string> = { ...(process.env as Record<string, string>), ...spec.env }
  for (const name of spec.credentialBindings ?? []) {
    const v = credentials.resolve(name)
    if (v === undefined) throw new TransportError(`${spec.id}: credential ${name} not found`)
    env[name.toUpperCase().replaceAll('-', '_')] = v
  }
  if (o.adapterToken) env.PERSIMMON_ADAPTER_TOKEN = o.adapterToken

  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, stdio: ['pipe', 'pipe', 'inherit'], ...(o.cwd ? { cwd: o.cwd } : {}) })
    let settled = false
    const done = (out: CallOutcome) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill()
      resolve(out)
    }
    const timer = o.timeoutMs === undefined ? undefined : setTimeout(() => done({ state: 'unknown', reason: 'deadline' }), Math.max(0, o.timeoutMs))

    child.on('error', (e) => done({ state: 'unknown', reason: `spawn: ${e.message}` }))
    child.on('exit', (code) => done({ state: 'unknown', reason: `exited ${code} before responding` }))
    createInterface({ input: child.stdout }).on('line', (line) => {
      let msg: Response | StreamLine
      try {
        msg = JSON.parse(line) as Response | StreamLine
      } catch {
        return done({ state: 'unknown', reason: `bad line: ${line.slice(0, 80)}` })
      }
      if ('event' in msg) return o.onStream?.(msg)
      if (msg.id !== request.id) return done({ state: 'unknown', reason: `response id ${msg.id} != ${request.id}` })
      done(outcomeOf(msg))
    })
    child.stdin.end(JSON.stringify(request) + '\n')
  })
}

async function http(spec: AdapterSpec, request: Request, credentials: CredentialStore, o: CallOptions): Promise<CallOutcome> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const bearer = spec.credentialBindings?.[0]
  if (bearer) {
    const v = credentials.resolve(bearer)
    if (v === undefined) throw new TransportError(`${spec.id}: credential ${bearer} not found`)
    headers.authorization = `Bearer ${v}`
  }
  const signal = o.timeoutMs === undefined ? undefined : AbortSignal.timeout(Math.max(1, o.timeoutMs))
  let res: globalThis.Response
  try {
    res = await fetch(spec.url as string, { method: 'POST', headers, body: JSON.stringify(request), ...(signal ? { signal } : {}) })
  } catch (e) {
    return { state: 'unknown', reason: (e as Error).message }
  }
  if (res.status === 202) return { state: 'pending' }
  if (!res.ok) return { state: 'unknown', reason: `http ${res.status}` }
  const body = (await res.json()) as Response
  if (body.id !== request.id) return { state: 'unknown', reason: `response id ${body.id} != ${request.id}` }
  return outcomeOf(body)
}

export function outcomeOf(r: Response): CallOutcome {
  return r.ok ? { state: 'succeeded', result: r.result } : { state: 'failed', error: r.error }
}
