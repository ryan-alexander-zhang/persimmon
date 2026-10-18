// gate and validator Handlers (17-runs.md gate and validator tables; 14-gate.md semantics).
import { durationMs } from '../../config.js'
import { ExpressionError } from '../../expression/site.js'
import type { Finding, HandlerImpl, ReconcileInput, ReconcileResult } from '../../handler/types.js'
import type { Action, ReconcileError } from '../../reconcile/types.js'
import { ajv } from '../../resource/ajv.js'
import type { ObjectRef, Resource, RevisionRef } from '../../resource/types.js'
import type { Closure, Entry } from '../../snapshot/walk.js'
import { fromClosure, type HandlerDeps } from '../deps.js'
import { bind, celContext, checkInputs, optional, overrideFindings, PortError, requiredFindings, sameType, siteOf } from '../ports/ports.js'
import type { Bindings, InputSpec, RuntimeValue, RuntimeValues } from '../ports/types.js'
import { rfc3339 } from '../task/handler.js'
import type { Gate, GateResult, GateRun, GateSpec, ValidationResult, ValidationRun, Validator, ValidatorSpec } from './types.js'

const err = (code: string, message: string, retryable = false): ReconcileError => ({ code, message, retryable })
const terminal = new Set(['Succeeded', 'Failed', 'Cancelled'])
const validationResult = ajv.getSchema('ports.yaml#/$defs/ValidationResult')!

const refOf = (r: { apiVersion: string; kind: string; metadata: { namespace?: string | undefined; name: string } }): ObjectRef => ({ apiVersion: r.apiVersion, kind: r.kind, namespace: r.metadata.namespace as string, name: r.metadata.name })
const done = (patch: Record<string, unknown>, actions: Action[] = []): ReconcileResult => ({ statusPatch: { waitingReason: null, ...patch }, actions: [...actions, { type: 'clearTimer', key: 'deadline' }] })

/** Validates an evaluator's answer: a boolean becomes a ValidationResult; anything else must match the schema (14-gate.md). */
export function toValidationResult(value: unknown): ValidationResult | undefined {
  if (typeof value === 'boolean') return { passed: value, findings: [], evidence: [] }
  return validationResult(value) ? (value as ValidationResult) : undefined
}

export function gateHandler(deps: HandlerDeps): HandlerImpl {
  return {
    validate(resource: Resource): { findings: Finding[] } {
      if (resource.kind !== 'Gate') return { findings: [] }
      const spec = resource.spec as unknown as GateSpec
      const f: Finding[] = [...overrideFindings(deps.getResource, resource), ...requiredFindings(spec.inputs)]
      const bad = (path: string, message: string) => f.push({ severity: 'error', code: 'invalid_gate', path, message })
      const names = new Set<string>()
      for (const [i, v] of spec.validators.entries()) {
        if (names.has(v.name)) bad(`/spec/validators/${i}/name`, `duplicate validator ${v.name}`)
        // earlier in the list only, so no cycle can be written (14-gate.md)
        for (const a of v.after ?? []) if (!names.has(a)) bad(`/spec/validators/${i}/after`, `${a} is not an earlier validator of this Gate`)
        if (v.after?.length && spec.policy?.strategy === 'any') f.push({ severity: 'warning', code: 'after_any', path: `/spec/validators/${i}/after`, message: `under policy any, after cannot change the verdict: a passing ${v.after[0]} already passes the Gate` })
        names.add(v.name)
        const def = deps.getResource('Validator', resource.metadata.namespace, v.ref.name) as Validator | undefined
        if (!def) {
          f.push({ severity: 'warning', code: 'validator_missing', path: `/spec/validators/${i}/ref`, message: `Validator ${v.ref.name} not found` })
          continue
        }
        for (const [port, spec2] of Object.entries(def.spec.inputs ?? {})) {
          const b = v.inputs?.[port]
          if (!b) {
            if (!optional(spec2)) bad(`/spec/validators/${i}/inputs`, `required input ${port} unbound`)
            continue
          }
          if ('fromValidator' in b) {
            // its result exists and passed only once the validator started after it (14-gate.md)
            if (!v.after?.includes(b.fromValidator)) bad(`/spec/validators/${i}/inputs/${port}`, `fromValidator ${b.fromValidator} is not in after`)
            if (spec2.type.kind !== 'value') bad(`/spec/validators/${i}/inputs/${port}`, `fromValidator feeds a port of kind ${spec2.type.kind}; a result is a value`)
          } else if ('fromInput' in b) {
            const src = spec.inputs?.[b.fromInput]
            if (!src) bad(`/spec/validators/${i}/inputs/${port}`, `unknown Gate input ${b.fromInput}`)
            else {
              if (!sameType(src.type, spec2.type)) bad(`/spec/validators/${i}/inputs/${port}`, 'producer type differs from consumer type')
              if (optional(src) && !src.default && !optional(spec2)) bad(`/spec/validators/${i}/inputs/${port}`, `optional Gate input ${b.fromInput} feeds a required input without a default`)
            }
          } else if ('expression' in b) {
            try {
              siteOf({ inputs: spec.inputs ?? {} }).check(b.expression)
            } catch (e) {
              if (e instanceof ExpressionError) bad(`/spec/validators/${i}/inputs/${port}`, `expression: ${e.message}`)
              else throw e
            }
          }
        }
      }
      if (spec.policy?.strategy === 'quorum' && (spec.policy.count ?? 0) > spec.validators.length) bad('/spec/policy', `quorum count ${spec.policy.count} > ${spec.validators.length} validators`)
      return { findings: f }
    },

    reconcile(input: ReconcileInput): ReconcileResult {
      const run = input.resource as unknown as GateRun
      if (run.kind !== 'GateRun') return { actions: [] }
      const status = run.status ?? { phase: 'Pending', validationRuns: {} }
      const finish = (patch: Record<string, unknown>, actions: Action[] = []): ReconcileResult => done({ validationRuns: status.validationRuns ?? {}, ...patch }, actions) // the status schema requires validationRuns on every patch, a failure before Created stored any included
      if (terminal.has(status.phase)) return { actions: [] }
      const ev = input.event
      const now = deps.now()
      const closure = deps.closure(run.metadata.snapshot!)
      const ns = run.metadata.namespace as string
      const gate = fromClosure(closure, 'Gate', ns, run.spec.gateRef.name) as unknown as Gate | undefined
      if (!gate) throw new Error(`Gate ${run.spec.gateRef.name} not in the snapshot`)
      const cancelRemaining = (): Action[] =>
        input.context.children.filter((c) => !c.terminal).map((c) => ({ type: 'cancelResource', ref: c.ref }))

      /** One ValidationRun for validator `v`, its inputs bound now; a PortError is the caller's to fail on. Without
       * `results` (at Created) its `fromValidator` inputs are left out, as their results do not exist yet. */
      const start = (v: GateSpec['validators'][number], inputs: RuntimeValues, results?: Record<string, ValidationResult>): { action: Action; ref: ObjectRef } => {
        const validator = fromClosure(closure, 'Validator', ns, v.ref.name) as unknown as Validator | undefined
        if (!validator) throw new Error(`Validator ${v.ref.name} not in the snapshot`)
        const entries = Object.entries(v.inputs ?? {})
        const plain = Object.fromEntries(entries.filter(([, b]) => !('fromValidator' in b))) as Bindings
        const late = entries.flatMap(([p, b]) => ('fromValidator' in b ? [[p, b.fromValidator] as const] : []))
        const ports = results ? validator.spec.inputs ?? {} : Object.fromEntries(Object.entries(validator.spec.inputs ?? {}).filter(([p]) => !late.some(([l]) => l === p)))
        let bound: RuntimeValues
        try {
          const earlier = Object.fromEntries(results ? late.map(([p, name]) => [p, { kind: 'value', value: results[name] } as RuntimeValue]) : [])
          bound = checkInputs(ports, { ...bind(plain, { inputs }, siteOf({ inputs: gate.spec.inputs ?? {} })), ...earlier })
        } catch (e) {
          if (e instanceof PortError) throw new PortError(`validator ${v.name}: ${e.message}`)
          throw e
        }
        const name = `${run.metadata.name}-${v.name.toLowerCase()}`
        const deadline = rfc3339(new Date(Math.min(Date.parse(run.spec.deadline), now.getTime() + durationMs(validator.spec.timeout))))
        const address = { ...run.spec.address, stepRef: `${run.spec.address.stepRef}/${v.name}`, logicalExecutionId: `${run.spec.address.logicalExecutionId}/${v.name}` }
        const resource: Resource = {
          apiVersion: 'persimmon.ai/v1',
          kind: 'ValidationRun',
          metadata: { name, namespace: ns },
          spec: { validatorRef: v.ref, gateRunRef: refOf(run), name: v.name, address, deadline, inputs: bound },
        }
        return { action: { type: 'createResource', resource, snapshot: 'inherit', owned: true }, ref: refOf(resource) }
      }

      switch (ev.type) {
        case 'Created': {
          const validationRuns: Record<string, ObjectRef> = {}
          const actions: Action[] = []
          try {
            const inputs = checkInputs(gate.spec.inputs ?? {}, run.spec.inputs)
            for (const v of gate.spec.validators) {
              const s = start(v, inputs) // bound now for every validator, so a misbound one fails the Gate even if it is later skipped
              if (v.after?.length) continue // started once its predecessors pass
              actions.push(s.action)
              validationRuns[v.name] = s.ref
            }
          } catch (e) {
            if (e instanceof PortError) return finish({ phase: 'Failed', error: err('invalid_input', e.message) })
            throw e
          }
          actions.push({ type: 'setTimer', key: 'deadline', at: run.spec.deadline })
          return { statusPatch: { phase: 'Running', validationRuns }, actions }
        }

        case 'ChildFinished': {
          const byName = new Map(input.context.children.map((c) => [c.ref.name, c]))
          const results: Record<string, ValidationResult> = {}
          const validationRuns = { ...status.validationRuns }
          const actions: Action[] = []
          let waiting = false
          // in list order: a validator's `after` are earlier, so their results are known by the time it is reached
          for (const v of gate.spec.validators) {
            const ref = validationRuns[v.name]
            if (!ref) {
              const before = (v.after ?? []).map((a) => results[a])
              if (before.some((r) => r === undefined)) {
                waiting = true // a predecessor still runs
                continue
              }
              const failed = (v.after ?? []).find((a) => !results[a]!.passed)
              if (failed) {
                results[v.name] = { passed: false, findings: [{ severity: 'info', code: 'skipped', message: `not run: ${failed} did not pass` }], evidence: [] }
                continue
              }
              try {
                const s = start(v, checkInputs(gate.spec.inputs ?? {}, run.spec.inputs), results)
                actions.push(s.action)
                validationRuns[v.name] = s.ref
              } catch (e) {
                if (e instanceof PortError) return finish({ phase: 'Failed', error: err('invalid_input', e.message) }, cancelRemaining())
                throw e
              }
              waiting = true
              continue
            }
            const child = byName.get(ref.name)
            const st = child?.status as { phase?: string; result?: ValidationResult; error?: ReconcileError } | undefined
            const phase = ref.name === ev.payload.ref.name ? ev.payload.value : st?.phase
            if (phase === 'Failed') return finish({ phase: 'Failed', error: st?.error ?? err('validator_failed', `${v.name} failed`) }, cancelRemaining())
            if (phase === 'Cancelled') return finish({ phase: 'Failed', error: err('validator_cancelled', `${v.name} was cancelled`) }, cancelRemaining())
            if (phase !== 'Succeeded' || !st?.result) {
              waiting = true // still running
              continue
            }
            results[v.name] = st.result
          }
          if (waiting) return actions.length ? { statusPatch: { validationRuns }, actions } : { actions: [] }
          const passedCount = Object.values(results).filter((r) => r.passed).length
          const policy = gate.spec.policy ?? { strategy: 'all' }
          const passed = policy.strategy === 'all' ? passedCount === gate.spec.validators.length : policy.strategy === 'any' ? passedCount >= 1 : passedCount >= (policy.count ?? 1)
          const result: GateResult = { passed, results }
          return finish({ phase: 'Succeeded', outputs: { result: { kind: 'value', value: result } } })
        }

        case 'TimerFired':
          return ev.payload.key === 'deadline' ? finish({ phase: 'Failed', error: err('timeout', 'gate timeout') }, cancelRemaining()) : { actions: [] }
        case 'CancelRequested':
          return finish({ phase: 'Cancelled' }, cancelRemaining())
        default:
          return { actions: [] }
      }
    },
  }
}

type Seen = { content: unknown; provenance: unknown }

export function validatorHandler(deps: HandlerDeps): HandlerImpl {
  /** Artifact inputs as the evaluator sees them: `{content, provenance}` per port, a list of them for an artifacts port (14-gate.md). */
  const artifactsOf = (token: string, inputs: RuntimeValues): Record<string, Seen | Seen[]> => {
    const seen = (ref: RevisionRef): Seen => {
      const spec = (deps.callback(token, 'getArtifact', ref as unknown as Record<string, unknown>) as Resource).spec as Seen
      return { content: spec.content, provenance: spec.provenance }
    }
    return Object.fromEntries(Object.entries(inputs).flatMap(([port, v]): [string, Seen | Seen[]][] => (v.kind === 'artifact' ? [[port, seen(v.ref)]] : v.kind === 'artifacts' ? [[port, v.refs.map(seen)]] : [])))
  }

  return {
    validate(resource: Resource): { findings: Finding[] } {
      if (resource.kind !== 'Validator') return { findings: [] }
      const spec = resource.spec as unknown as ValidatorSpec
      const f: Finding[] = [...overrideFindings(deps.getResource, resource), ...requiredFindings(spec.inputs)]
      if (spec.evaluator.type === 'cel') {
        try {
          celSite(spec.inputs ?? {}, () => undefined).check(spec.evaluator.expression)
        } catch (e) {
          if (e instanceof ExpressionError) f.push({ severity: 'error', code: 'invalid_expression', path: '/spec/evaluator/expression', message: e.message })
          else throw e
        }
      }
      if (spec.evaluator.type === 'task') {
        const task = deps.getResource('Task', resource.metadata.namespace, spec.evaluator.taskRef.name)
        const out = (task?.spec as { outputs?: Record<string, InputSpec> } | undefined)?.outputs?.[spec.evaluator.resultOutput]
        if (task && (!out || out.type.kind !== 'value')) f.push({ severity: 'error', code: 'invalid_validator', path: '/spec/evaluator/resultOutput', message: `${spec.evaluator.resultOutput} is not a value output of Task ${spec.evaluator.taskRef.name}` })
      }
      if (spec.evaluator.type === 'adapter') {
        try {
          const d = deps.adapters.require(spec.evaluator.adapter, 'evaluator').status?.describe as { configurationSchema?: Record<string, unknown> } | undefined
          if (d?.configurationSchema && !ajv.compile(d.configurationSchema)(spec.evaluator.configuration ?? {}))
            f.push({ severity: 'error', code: 'invalid_input', path: '/spec/evaluator/configuration', message: 'configuration does not match describe.configurationSchema' })
        } catch (e) {
          f.push({ severity: 'warning', code: 'adapter_unavailable', path: '/spec/evaluator/adapter', message: (e as Error).message })
        }
      }
      return { findings: f }
    },

    reconcile(input: ReconcileInput): ReconcileResult {
      const run = input.resource as unknown as ValidationRun
      if (run.kind !== 'ValidationRun') return { actions: [] }
      const status = run.status ?? { phase: 'Pending' }
      if (terminal.has(status.phase)) return { actions: [] }
      const ev = input.event
      const closure = deps.closure(run.metadata.snapshot!)
      const ns = run.metadata.namespace as string
      const validator = fromClosure(closure, 'Validator', ns, run.spec.validatorRef.name) as unknown as Validator | undefined
      if (!validator) throw new Error(`Validator ${run.spec.validatorRef.name} not in the snapshot`)
      const evaluator = validator.spec.evaluator
      const lei = run.spec.address.logicalExecutionId
      const finishWith = (value: unknown): ReconcileResult => {
        const result = toValidationResult(value)
        return result ? done({ phase: 'Succeeded', result }) : done({ phase: 'Failed', error: err('schema_violation', 'evaluator result is not a ValidationResult') })
      }

      switch (ev.type) {
        case 'Created': {
          let inputs: RuntimeValues
          try {
            inputs = checkInputs(validator.spec.inputs ?? {}, run.spec.inputs)
          } catch (e) {
            if (e instanceof PortError) return done({ phase: 'Failed', error: err('invalid_input', e.message) })
            throw e
          }
          if (evaluator.type === 'cel') {
            const artifacts = artifactsOf(input.engine.token, inputs)
            const site = celSite(validator.spec.inputs ?? {}, (ak) => frozenSchema(closure, ak))
            try {
              return finishWith(site.evaluate(evaluator.expression, { ...celContext({ inputs }), artifacts }))
            } catch (e) {
              if (e instanceof ExpressionError) return done({ phase: 'Failed', error: err('schema_violation', e.message) })
              throw e
            }
          }
          if (evaluator.type === 'task') {
            const name = `${run.metadata.name}-task`
            const resource: Resource = { apiVersion: 'persimmon.ai/v1', kind: 'TaskRun', metadata: { name, namespace: ns }, spec: { taskRef: evaluator.taskRef, address: run.spec.address, deadline: run.spec.deadline, inputs } }
            return { statusPatch: { phase: 'Running', taskRunRef: refOf(resource) }, actions: [{ type: 'createResource', resource, snapshot: 'inherit', owned: true }, { type: 'setTimer', key: 'deadline', at: run.spec.deadline }] }
          }
          const key = `${lei}/1`
          return {
            statusPatch: { phase: 'Running' },
            actions: [
              {
                type: 'callAdapter',
                adapterId: evaluator.adapter,
                op: 'evaluate',
                idempotencyKey: key,
                deadline: run.spec.deadline,
                payload: {
                  validationRun: { ref: { ...refOf(run), uid: run.metadata.uid as string }, logicalExecutionId: lei, idempotencyKey: key },
                  validator: { configuration: evaluator.configuration ?? {} },
                  inputs,
                  artifacts: artifactsOf(input.engine.token, inputs),
                  deadline: run.spec.deadline,
                },
              },
              { type: 'setTimer', key: 'deadline', at: run.spec.deadline },
            ],
          }
        }

        case 'ChildFinished': {
          if (evaluator.type !== 'task') return { actions: [] }
          const child = input.context.children.find((c) => c.ref.name === ev.payload.ref.name)
          const st = child?.status as { outputs?: RuntimeValues; error?: ReconcileError } | undefined
          if (ev.payload.value === 'Succeeded') return finishWith(st?.outputs?.[evaluator.resultOutput]?.kind === 'value' ? (st.outputs[evaluator.resultOutput] as { value: unknown }).value : undefined)
          if (ev.payload.value === 'Cancelled') return done({ phase: 'Failed', error: err('validator_cancelled', 'task cancelled') })
          return done({ phase: 'Failed', error: st?.error ?? err('validator_failed', 'task failed') })
        }

        case 'AdapterFinished': {
          const p = ev.payload
          if (p.state === 'succeeded') return finishWith(p.result)
          if (p.state === 'failed') return done({ phase: 'Failed', error: p.error })
          return done({ phase: 'Failed', error: err('unknown_result', 'no recorded answer') })
        }

        case 'TimerFired':
          return ev.payload.key === 'deadline' ? done({ phase: 'Failed', error: err('timeout', 'validator timeout') }, cancelChild(input, evaluator, lei, ev.sequence)) : { actions: [] }
        case 'CancelRequested':
          return done({ phase: 'Cancelled' }, cancelChild(input, evaluator, lei, ev.sequence))
        default:
          return { actions: [] }
      }
    },
  }
}

function cancelChild(input: ReconcileInput, evaluator: Validator['spec']['evaluator'], lei: string, sequence: number): Action[] {
  if (evaluator.type === 'task') return input.context.children.filter((c) => !c.terminal).map((c) => ({ type: 'cancelResource', ref: c.ref }))
  if (evaluator.type === 'adapter') return [{ type: 'callAdapter', adapterId: evaluator.adapter, op: 'cancel', idempotencyKey: `${lei}/1/cancel/${sequence}`, payload: { logicalExecutionId: lei, idempotencyKey: `${lei}/1` } }]
  return []
}

/** The `cel` evaluator's site: `inputs.<port>` and `artifacts.<port>.{content, provenance}` typed by the frozen kind schema, a list of them for an artifacts port. */
function celSite(inputs: Record<string, InputSpec>, schemaOf: (ak: { apiVersion: string; kind: string }) => Record<string, unknown> | undefined) {
  const artifacts = Object.fromEntries(
    Object.entries(inputs)
      .filter(([, s]) => s.type.kind === 'artifact' || s.type.kind === 'artifacts')
      .map(([port, s]) => {
        const ak = (s.type as { artifactKind: { apiVersion: string; kind: string } }).artifactKind
        const one = { type: 'object', properties: { content: schemaOf(ak) ?? { type: 'object' }, provenance: { type: 'object' } } }
        return [port, s.type.kind === 'artifacts' ? { type: 'array', items: one } : one]
      }),
  )
  return siteOf({ inputs, extra: { artifacts: { type: 'object', properties: artifacts } } })
}

function frozenSchema(closure: Closure, ak: { apiVersion: string; kind: string }): Record<string, unknown> | undefined {
  const kd = closure.resources.find((r: Entry) => r.kind === 'KindDefinition' && (r.spec as { names: { kind: string } }).names.kind === ak.kind)
  const version = ak.apiVersion.split('/')[1]
  return (kd?.spec as { versions?: { name: string; schema: Record<string, unknown> }[] } | undefined)?.versions?.find((v) => v.name === version)?.schema
}

