// task Handler: validates Tasks, drives TaskRuns (17-runs.md task Handler table).
import type { Describe } from '../../adapter/types.js'
import { durationMs } from '../../config.js'
import type { Finding, HandlerImpl, ReconcileInput, ReconcileResult } from '../../handler/types.js'
import type { Action, AdapterFinishedPayload, ReconcileError, PublishRequest } from '../../reconcile/types.js'
import type { Resource, RevisionRef } from '../../resource/types.js'
import type { Closure } from '../../snapshot/walk.js'
import { fromClosure, type HandlerDeps } from '../deps.js'
import { checkInputs, checkOutputs, PortError } from '../ports/ports.js'
import type { RuntimeValues } from '../ports/types.js'
import { ContextError, resolveContext } from './context.js'
import { backoffMs, shouldRetry } from './retry.js'
import { type Attempt, type ExecutorSpec, neverRetried, type Task, type TaskResult, type TaskRun, type TaskSpec, terminal } from './types.js'

const err = (code: string, message: string, retryable = false): ReconcileError => ({ code, message, retryable })
/** RFC 3339 without a fraction, as every design example writes times. */
export const rfc3339 = (d: Date): string => d.toISOString().replace(/\.\d{3}Z$/, 'Z')

interface Loaded {
  task: Task
  executor: ExecutorSpec
  describe: Describe & { supports?: { query: boolean; cancel: boolean; complete: boolean } }
  closure: Closure
}

export function taskHandler(deps: HandlerDeps): HandlerImpl {
  const load = (run: TaskRun): Loaded => {
    if (!run.metadata.snapshot) throw new Error(`${run.metadata.name}: no snapshot`)
    const closure = deps.closure(run.metadata.snapshot)
    const ns = run.metadata.namespace
    const task = fromClosure(closure, 'Task', ns, run.spec.taskRef.name) as unknown as Task | undefined
    if (!task) throw new Error(`Task ${run.spec.taskRef.name} not in the snapshot`)
    const executor = fromClosure(closure, 'Executor', ns, task.spec.executorRef.name)?.spec as ExecutorSpec | undefined
    if (!executor) throw new Error(`Executor ${task.spec.executorRef.name} not in the snapshot`)
    const describe = deps.adapters.require(executor.adapter, 'executor').status?.describe as Loaded['describe']
    return { task, executor, describe, closure }
  }

  return {
    validate(resource: Resource): { findings: Finding[] } {
      if (resource.kind !== 'Task') return { findings: [] }
      const spec = resource.spec as unknown as TaskSpec
      const findings: Finding[] = []
      const bad = (path: string, message: string, code = 'invalid_input') => findings.push({ severity: 'error', code, path, message })
      const retryOn = new Set(spec.retryPolicy?.retryOn ?? [])
      for (const c of spec.retryPolicy?.abortOn ?? []) if (retryOn.has(c)) bad('/spec/retryPolicy', `${c} in both retryOn and abortOn`)
      for (const c of retryOn) if (neverRetried.has(c)) bad('/spec/retryPolicy/retryOn', `${c} is never retried`)
      for (const [i, e] of (spec.action.context ?? []).entries()) {
        if (e.kind === 'file' || e.kind === 'artifact') {
          const port = spec.inputs?.[e.input]
          const want = e.kind === 'file' ? 'externalResource' : 'artifact'
          if (!port) bad(`/spec/action/context/${i}/input`, `${e.input} is not an input`)
          else if (port.type.kind !== want) bad(`/spec/action/context/${i}/input`, `${e.input} is not an ${want} port`)
        }
      }
      return { findings }
    },

    reconcile(input: ReconcileInput): ReconcileResult {
      const run = input.resource as unknown as TaskRun
      if (run.kind !== 'TaskRun') return { actions: [] }
      const status = run.status ?? { phase: 'Pending', attempts: [] }
      if (terminal.has(status.phase)) return { actions: [] }
      const ev = input.event
      const now = deps.now()
      const lei = run.spec.address.logicalExecutionId
      const attempts = status.attempts ?? []
      const current = attempts.at(-1)
      // statusPatch is a merge patch: `waitingReason: null` clears the field (03-reconcile.md)
      const patch = (p: Record<string, unknown>) => p
      const closeAttempts = (error: ReconcileError): Attempt[] =>
        attempts.map((a, i) => (i === attempts.length - 1 && (a.state === 'running' || a.state === 'unknown') ? { ...a, state: 'failed', finishedAt: rfc3339(now), error } : a))
      const fail = (error: ReconcileError, extra: Action[] = []): ReconcileResult => ({
        statusPatch: patch({ phase: 'Failed', error, attempts: closeAttempts(error), waitingReason: null }),
        actions: [...extra, { type: 'clearTimer', key: 'attempt' }, { type: 'clearTimer', key: 'deadline' }],
      })

      const startAttempt = (index: number): ReconcileResult => {
        const loaded = load(run)
        const { task, executor, describe } = loaded
        let inputs: RuntimeValues
        let context
        try {
          inputs = checkInputs(task.spec.inputs ?? {}, run.spec.inputs)
          context = resolveContext(task.spec.action.context ?? [], task.spec.inputs ?? {}, inputs, loaded.closure, run.metadata.namespace)
        } catch (e) {
          if (e instanceof PortError || e instanceof ContextError) return fail(err(e instanceof ContextError ? e.code : 'invalid_input', e.message))
          throw e
        }
        const key = `${lei}/${index}`
        const attemptDeadline = new Date(Math.min(now.getTime() + durationMs(task.spec.timeout), Date.parse(run.spec.deadline)))
        const outputs = task.spec.outputs ?? {}
        const outputSchemas = Object.fromEntries(
          Object.entries(outputs)
            .filter(([, o]) => o.type.kind === 'artifact')
            .map(([port, o]) => {
              const ak = (o.type as { artifactKind: { apiVersion: string; kind: string } }).artifactKind
              const kd = loaded.closure.resources.find((r) => r.kind === 'KindDefinition' && (r.spec as { names: { kind: string } }).names.kind === ak.kind)
              const version = ak.apiVersion.split('/')[1]
              return [port, (kd?.spec as { versions?: { name: string; schema: unknown }[] } | undefined)?.versions?.find((v) => v.name === version)?.schema ?? {}]
            }),
        )
        const attempt: Attempt = { index, state: 'running', idempotencyKey: key, startedAt: rfc3339(now) }
        const human = executor.type === 'human'
        return {
          statusPatch: patch({
            phase: human ? 'Waiting' : 'Running',
            ...(human ? { waitingReason: 'human' } : { waitingReason: null }),
            attempts: [...attempts, attempt],
          }),
          actions: [
            {
              type: 'callAdapter',
              adapterId: executor.adapter,
              op: 'execute',
              idempotencyKey: key,
              deadline: rfc3339(attemptDeadline),
              payload: {
                taskRun: { ref: ref(run), logicalExecutionId: lei, idempotencyKey: key, attempt: index },
                task: { instructions: task.spec.action.instructions, parameters: task.spec.action.parameters ?? {}, sideEffects: task.spec.sideEffects, outputs, outputSchemas },
                executor: { type: executor.type, configuration: executor.configuration ?? {}, security: executor.security ?? { networkAccess: 'deny' } },
                inputs,
                context,
                deadline: rfc3339(attemptDeadline),
                // credentials and engine are added by the dispatcher; never in the RunLog (13-executor.md)
              },
            },
            { type: 'setTimer', key: 'attempt', at: rfc3339(attemptDeadline) },
            ...(index === 1 ? [{ type: 'setTimer', key: 'deadline', at: run.spec.deadline } as Action] : []),
          ],
        }
      }

      const attemptFailed = (a: Attempt, error: ReconcileError, extra: Action[] = []): ReconcileResult => {
        const { task } = load(run)
        const done: Attempt = { ...a, state: 'failed', finishedAt: rfc3339(now), error }
        const rest = attempts.slice(0, -1)
        const actions: Action[] = [...extra, { type: 'abandonScope', key: a.idempotencyKey }, { type: 'clearTimer', key: 'attempt' }]
        if (shouldRetry(task.spec.retryPolicy, a.index, error, task.spec.sideEffects)) {
          const at = rfc3339(new Date(now.getTime() + backoffMs(task.spec.retryPolicy!, a.index, deps.random)))
          return { statusPatch: patch({ phase: 'Waiting', waitingReason: 'retryBackoff', attempts: [...rest, done] }), actions: [...actions, { type: 'setTimer', key: 'backoff', at }] }
        }
        return { statusPatch: patch({ phase: 'Failed', error, attempts: [...rest, done], waitingReason: null }), actions: [...actions, { type: 'clearTimer', key: 'deadline' }] }
      }

      const succeed = (a: Attempt, result: TaskResult, extraPatch: Record<string, unknown> = {}): ReconcileResult => {
        const { task } = load(run)
        try {
          if (result.protocol !== 'persimmon.result/v1') throw new PortError(`protocol ${String(result.protocol)}`)
          checkOutputs(task.spec.outputs ?? {}, result.outputs)
          const staged = (input.context.staged ?? []).filter((s) => s.scope === a.idempotencyKey).map((s) => s.ref)
          for (const v of Object.values(result.outputs))
            if (v.kind === 'artifact' && !staged.some((s) => sameRef(s, v.ref))) throw new PortError(`artifact ${v.ref.id} revision ${v.ref.revision} not staged in this attempt`)
        } catch (e) {
          if (e instanceof PortError) return attemptFailed(a, err('schema_violation', e.message))
          throw e
        }
        const done: Attempt = { ...a, state: 'succeeded', finishedAt: rfc3339(now) }
        return {
          statusPatch: patch({ phase: 'Succeeded', outputs: result.outputs, attempts: [...attempts.slice(0, -1), done], waitingReason: null, ...extraPatch }),
          actions: [{ type: 'commitScope', key: a.idempotencyKey }, { type: 'clearTimer', key: 'attempt' }, { type: 'clearTimer', key: 'deadline' }],
        }
      }

      const cancelCall = (a: Attempt | undefined): Action[] => {
        if (!a) return []
        const { executor, describe } = load(run)
        if (!describe.supports?.cancel) return []
        return [{ type: 'callAdapter', adapterId: executor.adapter, op: 'cancel', idempotencyKey: `${a.idempotencyKey}/cancel/${ev.sequence}`, payload: { logicalExecutionId: lei, idempotencyKey: a.idempotencyKey } }]
      }

      switch (ev.type) {
        case 'Created':
          return startAttempt(1)

        case 'TimerFired': {
          if (ev.payload.key === 'backoff') return startAttempt((current?.index ?? 0) + 1)
          if (ev.payload.key === 'attempt' && current?.state === 'running') return attemptFailed(current, err('timeout', `attempt ${current.index} exceeded its deadline`, true))
          if (ev.payload.key === 'deadline') {
            const actions: Action[] = current ? [...cancelCall(current), { type: 'abandonScope', key: current.idempotencyKey }] : []
            return fail(err('timeout', 'deadline exceeded'), actions)
          }
          if (ev.payload.key === 'query' && current?.state === 'unknown') return query(current)
          return { actions: [] }
        }

        case 'AdapterFinished': {
          const p = ev.payload
          if (!current) return { actions: [] }
          if (p.idempotencyKey.startsWith(`${current.idempotencyKey}/cancel/`)) return { actions: [] } // recorded only
          if (p.idempotencyKey.startsWith(`${current.idempotencyKey}/query/`)) return onQuery(current, p)
          if (p.idempotencyKey !== current.idempotencyKey || current.state !== 'running') return { actions: [] }
          if (p.state === 'succeeded') {
            if ((p.result as { accepted?: boolean }).accepted === true) {
              const acked: Attempt = { ...current, acknowledged: true }
              return { statusPatch: patch({ phase: 'Waiting', waitingReason: 'human', attempts: [...attempts.slice(0, -1), acked] }), actions: [] }
            }
            return succeed(current, p.result as unknown as TaskResult)
          }
          if (p.state === 'failed') return attemptFailed(current, p.error)
          return unknown(current)
        }

        case 'Signal': {
          if (!current?.acknowledged && load(run).executor.type !== 'human') return { actions: [] }
          const body = ev.payload.payload as { taskResult: TaskResult; publish?: { port: string; request: PublishRequest }[] } | undefined
          if (!body?.taskResult || !current) return { actions: [] }
          const outputs: RuntimeValues = { ...body.taskResult.outputs }
          for (const p of body.publish ?? []) {
            const ref = deps.callback(input.engine.token, 'publishArtifact', p.request as unknown as Record<string, unknown>) as RevisionRef
            outputs[p.port] = { kind: 'artifact', ref }
          }
          // artifacts published here are staged to this reconcile, so the staged check sees them
          const stagedNow = Object.values(outputs).flatMap((v) => (v.kind === 'artifact' ? [{ ref: v.ref, scope: current.idempotencyKey }] : []))
          input.context.staged = [...(input.context.staged ?? []), ...stagedNow]
          return succeed(current, { ...body.taskResult, outputs }, input.context.actor ? { actor: input.context.actor } : {})
        }

        case 'CancelRequested': {
          const actions: Action[] = current ? [...cancelCall(current), { type: 'abandonScope', key: current.idempotencyKey }] : []
          return { statusPatch: patch({ phase: 'Cancelled', waitingReason: null }), actions: [...actions, { type: 'clearTimer', key: 'attempt' }, { type: 'clearTimer', key: 'deadline' }, { type: 'clearTimer', key: 'backoff' }] }
        }

        default:
          return { actions: [] }
      }

      function unknown(a: Attempt): ReconcileResult {
        if (a.acknowledged) return { actions: [] }
        const { describe } = load(run)
        if (describe.supports?.query) {
          const marked: Attempt = { ...a, state: 'unknown' }
          return { statusPatch: patch({ phase: 'Waiting', waitingReason: 'adapter', attempts: [...attempts.slice(0, -1), marked] }), actions: query(marked).actions }
        }
        return attemptFailed(a, err('unknown_result', 'no recorded answer', load(run).task.spec.sideEffects === 'none'))
      }

      function query(a: Attempt): ReconcileResult {
        const { executor } = load(run)
        return { actions: [{ type: 'callAdapter', adapterId: executor.adapter, op: 'query', idempotencyKey: `${a.idempotencyKey}/query/${ev.sequence}`, payload: { logicalExecutionId: lei, idempotencyKey: a.idempotencyKey } }] }
      }

      function onQuery(a: Attempt, p: AdapterFinishedPayload): ReconcileResult {
        if (p.state !== 'succeeded') return attemptFailed({ ...a, state: 'running' }, err('unknown_result', 'query failed', load(run).task.spec.sideEffects === 'none'))
        const q = p.result as { state: string; result?: TaskResult; error?: ReconcileError }
        if (q.state === 'succeeded' && q.result) return succeed(a, q.result)
        if (q.state === 'failed' && q.error) return attemptFailed(a, q.error)
        if (q.state === 'running') return { actions: [{ type: 'setTimer', key: 'query', at: rfc3339(new Date(now.getTime() + 30_000)) }] }
        return attemptFailed(a, err('unknown_result', 'adapter does not know', load(run).task.spec.sideEffects === 'none'))
      }
    },
  }
}

function ref(r: { apiVersion: string; kind: string; metadata: { namespace?: string | undefined; name: string; uid?: string | undefined } }) {
  return { apiVersion: r.apiVersion, kind: r.kind, namespace: r.metadata.namespace as string, name: r.metadata.name, uid: r.metadata.uid as string }
}

const sameRef = (a: RevisionRef, b: RevisionRef) => a.kind === b.kind && a.namespace === b.namespace && a.id === b.id && a.revision === b.revision

