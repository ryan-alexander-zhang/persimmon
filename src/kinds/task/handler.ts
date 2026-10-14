// task Handler: validates Tasks, drives TaskRuns (17-runs.md task Handler table).
import type { Describe } from '../../adapter/types.js'
import { durationMs } from '../../config.js'
import { ExpressionError } from '../../expression/site.js'
import { ajv } from '../../resource/ajv.js'
import type { Finding, HandlerImpl, ReconcileInput, ReconcileResult } from '../../handler/types.js'
import type { Action, AdapterFinishedPayload, ReconcileError, PublishRequest } from '../../reconcile/types.js'
import type { Resource, RevisionRef } from '../../resource/types.js'
import type { Closure } from '../../snapshot/walk.js'
import { fromClosure, type HandlerDeps } from '../deps.js'
import { celTypeOf, checkInputs, checkOutputs, evaluateBinding, expandSchema, inlineSchema, overrideFindings, PortError, siteOf } from '../ports/ports.js'
import type { RuntimeValues } from '../ports/types.js'
import { ContextError, resolveContext } from './context.js'
import { backoffMs, shouldRetry } from './retry.js'
import { type Attempt, type ExecutorSpec, neverRetried, type Task, type TaskResult, type TaskRun, type TaskSpec, terminal } from './types.js'

const err = (code: string, message: string, retryable = false): ReconcileError => ({ code, message, retryable })
const dnsLabel = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/ // resource.yaml Id

/** The identities a Task chose for its artifact outputs, resolved over the bound inputs (12-task.md). */
function outputIdsOf(task: Task, inputs: RuntimeValues): Record<string, string> {
  const site = siteOf({ inputs: task.spec.inputs ?? {} })
  const out: Record<string, string> = {}
  for (const [port, o] of Object.entries(task.spec.outputs ?? {})) {
    if (!o.id) continue
    let v
    try {
      v = evaluateBinding(o.id, { inputs }, site)
    } catch (e) {
      if (e instanceof ExpressionError) throw new PortError(`${port}: id expression: ${e.message}`)
      throw e
    }
    const id = v?.kind === 'value' ? v.value : undefined
    const max = o.type.kind === 'artifacts' ? 59 : 63 // an artifacts output publishes <prefix>-<n>, so the prefix leaves room for the suffix
    if (typeof id !== 'string' || id.length > max || !dnsLabel.test(id)) throw new PortError(`${port}: id ${JSON.stringify(id)} is not an Id${o.type.kind === 'artifacts' ? ' prefix' : ''}`)
    out[port] = id
  }
  return out
}
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
      const findings: Finding[] = overrideFindings(deps.getResource, resource)
      const bad = (path: string, message: string, code = 'invalid_input') => findings.push({ severity: 'error', code, path, message })
      const retryOn = new Set(spec.retryPolicy?.retryOn ?? [])
      for (const c of spec.retryPolicy?.abortOn ?? []) if (retryOn.has(c)) bad('/spec/retryPolicy', `${c} in both retryOn and abortOn`)
      for (const c of retryOn) if (neverRetried.has(c)) bad('/spec/retryPolicy/retryOn', `${c} is never retried`)
      for (const [port, o] of Object.entries(spec.outputs ?? {})) {
        if (!o.id) continue
        if (o.type.kind !== 'artifact' && o.type.kind !== 'artifacts') bad(`/spec/outputs/${port}/id`, `${port}: only an artifact or artifacts output chooses its id`)
        else if ('literal' in o.id) {
          if (typeof o.id.literal !== 'string') bad(`/spec/outputs/${port}/id`, `${port}: id literal is not a string`)
        } else if ('fromInput' in o.id) {
          const t = spec.inputs?.[o.id.fromInput]?.type
          if (t?.kind !== 'value' || celTypeOf(expandSchema(t.schema)) !== 'string') bad(`/spec/outputs/${port}/id`, `${port}: id fromInput ${o.id.fromInput} is not a string value input`)
        } else if ('expression' in o.id) {
          try {
            const type = siteOf({ inputs: spec.inputs ?? {} }).check(o.id.expression)
            if (type !== 'string') bad(`/spec/outputs/${port}/id`, `${port}: id expression is ${type}, not string`)
          } catch (e) {
            bad(`/spec/outputs/${port}/id`, `${port}: id expression: ${(e as Error).message}`, 'invalid_expression')
          }
        } else bad(`/spec/outputs/${port}/id`, `${port}: id reads inputs only`)
      }
      // the Executor's Adapter describe, when both resolve; the Executor's own validate reports an unreachable Adapter
      const ns = resource.metadata.namespace
      const executor = deps.getResource('Executor', ns, spec.executorRef.name)?.spec as ExecutorSpec | undefined
      let describe: (Describe & { parametersSchema?: Record<string, unknown>; contextKinds?: string[]; skillFormats?: string[] }) | undefined
      try {
        describe = executor ? (deps.adapters.require(executor.adapter, 'executor').status?.describe as typeof describe) : undefined
      } catch {
        describe = undefined
      }
      if (describe?.parametersSchema) {
        try {
          if (!ajv.compile(describe.parametersSchema)(spec.action.parameters ?? {})) bad('/spec/action/parameters', `parameters do not match ${executor!.adapter} describe.parametersSchema`)
        } catch (e) {
          findings.push({ severity: 'warning', code: 'adapter_describe', path: '/spec/action/parameters', message: `${executor!.adapter} describe.parametersSchema is not a valid schema: ${(e as Error).message}` })
        }
      }
      for (const [port, o] of Object.entries(spec.outputs ?? {})) if (o.type.kind === 'artifacts' && !o.id) bad(`/spec/outputs/${port}`, `${port}: an artifacts output names its id prefix`)
      const ws = spec.action.workspace
      if (ws && 'input' in ws && spec.inputs?.[ws.input]?.type.kind !== 'externalResource') bad('/spec/action/workspace/input', `${ws.input} is not an externalResource port`)
      for (const [i, e] of (spec.action.context ?? []).entries()) {
        if (describe?.contextKinds && !describe.contextKinds.includes(e.kind)) bad(`/spec/action/context/${i}/kind`, `${executor!.adapter} does not accept ${e.kind} context`)
        if (e.kind === 'file' || e.kind === 'artifact') {
          const port = spec.inputs?.[e.input]
          const want = e.kind === 'file' ? ['externalResource'] : ['artifact', 'artifacts']
          if (!port) bad(`/spec/action/context/${i}/input`, `${e.input} is not an input`)
          else if (!want.includes(port.type.kind)) bad(`/spec/action/context/${i}/input`, `${e.input} is not an ${want[0]} port`)
        }
        if (e.kind === 'skill' && describe?.skillFormats) {
          const skill = deps.getResource('Skill', ns, e.ref.name)?.spec as { format?: string } | undefined
          if (skill && !describe.skillFormats.includes(skill.format ?? '')) bad(`/spec/action/context/${i}/ref`, `Skill ${e.ref.name} format ${skill.format} is not in ${executor!.adapter} describe.skillFormats`)
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
      const answeredAt = () => (ev.type === 'AdapterFinished' && ev.payload.finishedAt ? rfc3339(new Date(ev.payload.finishedAt)) : rfc3339(now)) // the adapter's answer time, not the delivery time
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
        let outputIds: Record<string, string>
        try {
          inputs = checkInputs(task.spec.inputs ?? {}, run.spec.inputs)
          context = resolveContext(task.spec.action.context ?? [], task.spec.inputs ?? {}, inputs, loaded.closure, run.metadata.namespace)
          outputIds = outputIdsOf(task, inputs)
        } catch (e) {
          if (e instanceof PortError || e instanceof ContextError) return fail(err(e instanceof ContextError ? e.code : 'invalid_input', e.message))
          throw e
        }
        const ws = task.spec.action.workspace
        let workspace: string | undefined
        if (ws && 'path' in ws) workspace = ws.path // relative to the engine's cwd; the dispatcher makes it absolute
        else if (ws) {
          const v = inputs[ws.input]
          const path = v?.kind === 'externalResource' ? (v.ref.locator as { path?: unknown } | undefined)?.path : undefined
          if (typeof path !== 'string') return fail(err('invalid_input', `workspace input ${ws.input} has no locator.path`))
          workspace = path
        }
        const key = `${lei}/${index}`
        const attemptDeadline = new Date(Math.min(now.getTime() + durationMs(task.spec.timeout), Date.parse(run.spec.deadline)))
        // value ports may name a well-known $ref; the payload carries every schema self-contained (10-ports.md)
        const outputs = Object.fromEntries(Object.entries(task.spec.outputs ?? {}).map(([port, o]) => [port, o.type.kind === 'value' && o.type.schema ? { ...o, type: { kind: 'value' as const, schema: inlineSchema(o.type.schema) } } : o]))
        const outputSchemas = Object.fromEntries(
          Object.entries(outputs)
            .filter(([, o]) => o.type.kind === 'artifact' || o.type.kind === 'artifacts') // an artifacts port: the schema of one item
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
            context,
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
                task: { instructions: task.spec.action.instructions, parameters: task.spec.action.parameters ?? {}, sideEffects: task.spec.sideEffects, outputs, outputSchemas, outputIds },
                executor: { type: executor.type, configuration: executor.configuration ?? {}, security: executor.security ?? { networkAccess: 'deny' } },
                inputs,
                context,
                deadline: rfc3339(attemptDeadline),
                ...(workspace ? { workspace } : {}),
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
        const done: Attempt = { ...a, state: 'failed', finishedAt: answeredAt(), error }
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
          const chosen = outputIdsOf(task, checkInputs(task.spec.inputs ?? {}, run.spec.inputs))
          for (const [port, id] of Object.entries(chosen)) {
            const v = result.outputs[port]
            if (v?.kind === 'artifact' && v.ref.id !== id) throw new PortError(`${port}: published ${v.ref.id}, not the chosen id ${id}`)
            if (v?.kind === 'artifacts') for (const [i, ref] of v.refs.entries()) if (ref.id !== `${id}-${i + 1}`) throw new PortError(`${port}[${i}]: published ${ref.id}, not the chosen id ${id}-${i + 1}`)
          }
          const staged = (input.context.staged ?? []).filter((s) => s.scope === a.idempotencyKey).map((s) => s.ref)
          for (const v of Object.values(result.outputs))
            for (const ref of v.kind === 'artifact' ? [v.ref] : v.kind === 'artifacts' ? v.refs : [])
              if (!staged.some((s) => sameRef(s, ref))) throw new PortError(`artifact ${ref.id} revision ${ref.revision} not staged in this attempt`)
        } catch (e) {
          if (e instanceof PortError) return attemptFailed(a, err('schema_violation', e.message))
          throw e
        }
        const done: Attempt = { ...a, state: 'succeeded', finishedAt: answeredAt() }
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
          const stagedNow: { ref: RevisionRef; scope: string }[] = []
          for (const p of body.publish ?? []) {
            const ref = deps.callback(input.engine.token, 'publishArtifact', p.request as unknown as Record<string, unknown>) as RevisionRef
            outputs[p.port] = { kind: 'artifact', ref }
            stagedNow.push({ ref, scope: current.idempotencyKey }) // only what was published here is staged; a ref the signal carries is not
          }
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
        return attemptFailed(a, err('unknown_result', 'no recorded answer', load(run).task.spec.sideEffects !== 'nonIdempotent'))
      }

      function query(a: Attempt): ReconcileResult {
        const { executor } = load(run)
        return { actions: [{ type: 'callAdapter', adapterId: executor.adapter, op: 'query', idempotencyKey: `${a.idempotencyKey}/query/${ev.sequence}`, payload: { logicalExecutionId: lei, idempotencyKey: a.idempotencyKey } }] }
      }

      function onQuery(a: Attempt, p: AdapterFinishedPayload): ReconcileResult {
        if (p.state !== 'succeeded') return attemptFailed({ ...a, state: 'running' }, err('unknown_result', 'query failed', load(run).task.spec.sideEffects !== 'nonIdempotent'))
        const q = p.result as { state: string; result?: TaskResult; error?: ReconcileError }
        if (q.state === 'succeeded' && q.result) return succeed(a, q.result)
        if (q.state === 'failed' && q.error) return attemptFailed(a, q.error)
        if (q.state === 'running') return { actions: [{ type: 'setTimer', key: 'query', at: rfc3339(new Date(now.getTime() + 30_000)) }] }
        return attemptFailed(a, err('unknown_result', 'adapter does not know', load(run).task.spec.sideEffects !== 'nonIdempotent'))
      }
    },
  }
}

function ref(r: { apiVersion: string; kind: string; metadata: { namespace?: string | undefined; name: string; uid?: string | undefined } }) {
  return { apiVersion: r.apiVersion, kind: r.kind, namespace: r.metadata.namespace as string, name: r.metadata.name, uid: r.metadata.uid as string }
}

const sameRef = (a: RevisionRef, b: RevisionRef) => a.kind === b.kind && a.namespace === b.namespace && a.id === b.id && a.revision === b.revision

