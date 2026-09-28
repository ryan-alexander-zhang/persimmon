// Dispatcher: Event ─▶ lease ─▶ Handler.reconcile ─▶ commit; timers, adapter calls, retry, stalled (03-reconcile.md).
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { Context, ReconcileInput, ReconcileResult } from '../handler/types.js'
import { audit } from '../handler/write.js'
import { deliverOnce } from '../outbox/deliver.js'
import { engineActor, makeEvent } from '../outbox/event.js'
import type { Resource } from '../resource/types.js'
import type { CredentialStore, RunLogEntry } from '../store/store.js'
import { type Engine as CommitEngine, commit, refOf } from './apply.js'
import { appendEvent } from './events.js'

export { appendEvent }
import { terminalValue } from './status.js'
import type { AdapterFinishedPayload, Event } from './types.js'

export interface Engine extends CommitEngine {
  credentials: CredentialStore
  endpoint: string
  /** Project directory; Task workspaces resolve against it (12-task.md). */
  cwd: string
  maxReconcileAttempts: number
  leaseTtlMs: number
  /** Base of the exponential backoff between attempts; 0 in tests. */
  retryBaseMs: number
  holder: string
  /** callAdapter keys this engine is executing right now. */
  inFlight: Set<string>
  onError?: (uid: string, event: Event, error: Error) => void
}

export class DispatchError extends Error {}

export type Outcome = 'committed' | 'failed' | 'skipped'

/** Delivers one open RunLog entry: `skipped` when stalled or leased elsewhere, `failed` when it will retry or just stalled. */
export async function reconcileOnce(engine: Engine, uid: string, entry: RunLogEntry): Promise<Outcome> {
  const { store, handlers } = engine
  const resource = store.resources.getByUid(uid)
  if (!resource) {
    store.runLog.ack(uid, entry.event.sequence, { actions: [] }, engine.now().toISOString()) // deleted meanwhile
    return 'committed'
  }
  if (resource.metadata.stalled) return 'skipped'
  if (!store.leases.acquire(uid, engine.holder, engine.leaseTtlMs)) return 'skipped'
  try {
    const bound = handlers.get(resource.apiVersion, resource.kind)
    const event = entry.event as unknown as Event
    const attempt = store.runLog.markDelivery(uid, entry.event.sequence)
    // expires with the lease, so a crash between issue and revoke leaves no live token
    const token = store.tokens.issue({ kind: 'reconcile', uid, sequence: event.sequence }, new Date(engine.now().getTime() + engine.leaseTtlMs).toISOString())
    try {
      const input: ReconcileInput = { resource, event, context: contextOf(engine, resource, entry), engine: { endpoint: engine.endpoint, token } }
      const result: ReconcileResult = bound.impl
        ? await bound.impl.reconcile(input)
        : await reconcileViaAdapter(engine, bound.handler.spec.implementation as { adapter: { id: string } }, input)
      if (!store.leases.renew(uid, engine.holder, engine.leaseTtlMs)) throw new DispatchError('lease lost')
      const actor = input.context.actor ?? { kind: 'handler', id: bound.handler.metadata.name }
      await commit(engine, { resource, event, result, actor, handler: bound, causationChain: event.causationChain ?? [] })
      return 'committed'
    } catch (e) {
      engine.onError?.(uid, event, e as Error)
      if (attempt >= engine.maxReconcileAttempts) stall(engine, resource, attempt, (e as Error).message)
      else if (engine.retryBaseMs > 0) await new Promise((r) => setTimeout(r, engine.retryBaseMs * 2 ** (attempt - 1)))
      return 'failed'
    } finally {
      store.tokens.revoke({ kind: 'reconcile', uid, sequence: event.sequence })
    }
  } finally {
    store.leases.release(uid, engine.holder)
  }
}

function contextOf(engine: Engine, resource: Resource, entry: RunLogEntry): Context {
  const { store, kinds } = engine
  const uid = resource.metadata.uid as string
  const children = store.resources.children(uid).map((c) => {
    const t = kinds.get(c.apiVersion, c.kind).definition.spec.terminal
    return { ref: refOf(c), terminal: t ? terminalValue(c, t) !== undefined : false, ...(c.status ? { status: c.status } : {}) }
  })
  const timers = store.timers.due('9999-12-31T23:59:59Z').filter((t) => t.uid === uid).map((t) => t.key)
  const staged = store.resources.staged(uid).filter((s) => s.state === 'staged').map(({ ref, scope }) => ({ ref, scope }))
  const ctx: Context = { children, timers, staged }
  if (resource.metadata.snapshot) ctx.snapshot = resource.metadata.snapshot
  if (entry.actor) ctx.actor = entry.actor as never // API and adapter Signals; engine-originated Events have none
  return ctx
}

async function reconcileViaAdapter(engine: Engine, impl: { adapter: { id: string } }, input: ReconcileInput): Promise<ReconcileResult> {
  const out = await engine.adapters.call(impl.adapter.id, 'reconcile', input as unknown as Record<string, unknown>)
  if (out.state === 'succeeded') return out.result as unknown as ReconcileResult
  throw new DispatchError(out.state === 'failed' ? out.error.message : out.state === 'unknown' ? out.reason : 'pending')
}

function stall(engine: Engine, resource: Resource, attempts: number, lastError: string): void {
  const { store } = engine
  const time = engine.now().toISOString()
  store.transaction(() => {
    const stored = store.resources.put({ ...resource, metadata: { ...resource.metadata, stalled: { attempts, lastError } } })
    store.audit.append(audit(stored, engineActor, time, 'metadata'))
    store.outbox.enqueue(makeEvent({ type: 'resource.stalled', time, subject: refOf(stored), ordinal: 0, actor: engineActor, payload: { attempts, lastError } }))
  })
}

/** Due timers become TimerFired Events and are cleared. */
export function pumpTimers(engine: Engine): number {
  const now = engine.now().toISOString()
  const due = engine.store.timers.due(now)
  for (const t of due) {
    engine.store.transaction(() => {
      appendEvent(engine, t.uid, { type: 'TimerFired', dedupeKey: `timer/${t.key}/${t.at}`, payload: { key: t.key, at: t.at } })
      engine.store.timers.clear(t.uid, t.key)
    })
  }
  return due.length
}

/** Dispatches every outstanding callAdapter not already in flight; answers arrive as AdapterFinished. */
export async function dispatchCalls(engine: Engine): Promise<number> {
  const calls = engine.store.runLog.outstandingCalls().filter((c) => !engine.inFlight.has(`${c.uid}/${c.action.idempotencyKey}`))
  await Promise.all(
    calls.map(async (c) => {
      const key = `${c.uid}/${c.action.idempotencyKey}`
      engine.inFlight.add(key)
      const a = c.action as { adapterId: string; op: string; payload: Record<string, unknown>; idempotencyKey: string; deadline?: string }
      const scope = { kind: 'call', uid: c.uid, idempotencyKey: a.idempotencyKey }
      const finished = (payload: AdapterFinishedPayload) => appendEvent(engine, c.uid, { type: 'AdapterFinished', dedupeKey: `adapter/${a.idempotencyKey}`, payload })
      try {
        const deadline = a.deadline ? new Date(a.deadline) : new Date(engine.now().getTime() + engine.defaultCallDeadlineMs)
        const token = engine.store.tokens.issue(scope, deadline.toISOString())
        const workspace = typeof a.payload.workspace === 'string' ? { workspace: resolve(engine.cwd, a.payload.workspace) } : {} // the Task's path is relative to the project (12-task.md)
        const out = await engine.adapters.call(a.adapterId, a.op, { ...a.payload, ...workspace, ...credentialsFor(engine, a.payload), engine: { endpoint: engine.endpoint, token } }, {
          timeoutMs: deadline.getTime() - engine.now().getTime(),
          onStream: (l) => {
            if (l.event === 'log') engine.store.runLog.log(c.uid, c.sequence, l.text) // stream log lines land beside the `log` callback (07-adapter.md)
          },
        })
        if (out.state === 'pending') return // http 202: the answer arrives at engine.endpoint/responses; the token lives to the deadline
        finished(
          out.state === 'succeeded'
            ? { idempotencyKey: a.idempotencyKey, state: 'succeeded', result: out.result }
            : out.state === 'failed'
              ? { idempotencyKey: a.idempotencyKey, state: 'failed', error: out.error }
              : { idempotencyKey: a.idempotencyKey, state: 'unknown' },
        )
      } catch (e) {
        // an unresolvable credential or a refused Adapter fails the attempt, never the engine (13-executor.md per attempt)
        finished({ idempotencyKey: a.idempotencyKey, state: 'failed', error: { code: 'permission_denied', message: (e as Error).message, retryable: false } })
      } finally {
        engine.store.tokens.revoke(scope)
        engine.inFlight.delete(key)
      }
    }),
  )
  return calls.length
}

/** Executor credentials resolve at dispatch, per attempt, and never enter the RunLog (13-executor.md). */
function credentialsFor(engine: Engine, payload: Record<string, unknown>): { credentials?: Record<string, string> } {
  const names = (payload.executor as { security?: { credentialBindings?: string[] } } | undefined)?.security?.credentialBindings
  if (!payload.executor) return {}
  const credentials: Record<string, string> = {}
  for (const n of names ?? []) {
    const v = engine.credentials.resolve(n)
    if (v === undefined) throw new DispatchError(`credential ${n} not found`)
    credentials[n] = v
  }
  return { credentials }
}

/** On start: every call with no recorded answer is delivered as `unknown` (03-reconcile.md). */
export function recoverCalls(engine: Engine): number {
  const calls = engine.store.runLog.outstandingCalls()
  for (const c of calls) {
    const key = (c.action as { idempotencyKey: string }).idempotencyKey
    appendEvent(engine, c.uid, { type: 'AdapterFinished', dedupeKey: `adapter/${key}`, payload: { idempotencyKey: key, state: 'unknown' } })
  }
  return calls.length
}

/** Runs timers, Outbox delivery, open Events and adapter calls until nothing moves. */
export async function drain(engine: Engine): Promise<void> {
  for (;;) {
    let moved = pumpTimers(engine) > 0
    moved = deliverOnce(engine.store, engine.kinds, 100, { maxCausationDepth: engine.maxCausationDepth, leaseTtlMs: engine.leaseTtlMs, holder: engine.holder, now: engine.now }) > 0 || moved
    for (const { uid, entry } of engine.store.runLog.listOpen()) moved = (await reconcileOnce(engine, uid, entry)) !== 'skipped' || moved
    moved = (await dispatchCalls(engine)) > 0 || moved
    if (!moved) return
  }
}

export const newHolder = (): string => `${process.pid}-${randomUUID().slice(0, 8)}`
