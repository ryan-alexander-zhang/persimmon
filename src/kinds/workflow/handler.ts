// workflow Handler: validates Workflows, drives WorkflowRuns (17-runs.md; Transition semantics from 11-workflow.md).
import { durationMs } from '../../config.js'
import type { Finding, HandlerImpl, ReconcileInput, ReconcileResult } from '../../handler/types.js'
import { readPath } from '../../reconcile/merge-patch.js'
import { canonicalJson } from '../../snapshot/canonical.js'
import type { Action, ReconcileError } from '../../reconcile/types.js'
import type { ObjectRef, Resource } from '../../resource/types.js'
import type { Closure, Entry } from '../../snapshot/walk.js'
import { fromClosure, type HandlerDeps } from '../deps.js'
import { bind, celContext, checkInputs, checkOutputs, overrideFindings, PortError, siteOf, type Sources, unwrap } from '../ports/ports.js'
import type { InputSpec, OutputSpec, RuntimeValues } from '../ports/types.js'
import { rfc3339 } from '../task/handler.js'
import { checkWorkflow, contractPorts, type Used } from './check.js'
import type { Outcome, Step, StepContract, StepStatus, Transition, Workflow, WorkflowRun, WorkflowRunStatus, WorkflowSpec } from './types.js'

/** A parallel repeat's `iteration`: the index alone, no outputs to wait for (11-workflow.md). */
const indexOnly = { type: 'object', properties: { index: { type: 'integer' } } }

const err = (code: string, message: string, retryable = false): ReconcileError => ({ code, message, retryable })
const terminalPhases = new Set(['Succeeded', 'Failed', 'Cancelled'])
const finished = new Set(['Succeeded', 'Failed', 'Cancelled', 'Skipped'])
/** Started and not finished: the child exists (runRef) and no terminal phase was reported; a parallel repeat, while any iteration runs. */
const isActive = (st: StepStatus): boolean => (st.runRef !== undefined || (st.active?.length ?? 0) > 0) && !finished.has(st.phase)

interface Loaded {
  workflow: Workflow
  closure: Closure
  used: Map<string, Used & { definition: Entry }>
}

export function workflowHandler(deps: HandlerDeps): HandlerImpl {
  /** Definition and stepContract of a Step's `uses`, from a closure or the live store. */
  const resolveUsed = (ref: { kind: string; name: string }, ns: string | undefined, closure?: Closure): (Used & { definition: Entry }) | undefined => {
    const kd = deps.kinds.byKind(ref.kind)?.definition
    const contract = kd?.spec.stepContract as StepContract | undefined
    if (!contract) return undefined
    const live = closure ? undefined : deps.getResource(ref.kind, ns, ref.name)
    const def = closure ? fromClosure(closure, ref.kind, ns, ref.name) : ((live && kd?.spec.expansion && deps.expand ? deps.expand(live, ns)[0] : live) as Entry | undefined) // a live composition is read through its expansion
    if (!def) return undefined
    const spec = def.spec as Record<string, unknown>
    return { contract, definition: def, inputs: contractPorts(spec, contract.inputsPath.replace(/^spec\./, '')) as Record<string, InputSpec>, outputs: contractPorts(spec, contract.outputsPath.replace(/^spec\./, '')) as Record<string, OutputSpec> }
  }

  const load = (run: WorkflowRun): Loaded => {
    if (!run.metadata.snapshot) throw new Error(`${run.metadata.name}: no snapshot`)
    const closure = deps.closure(run.metadata.snapshot)
    const ns = run.metadata.namespace
    const workflow = fromClosure(closure, 'Workflow', ns, run.spec.workflowRef.name) as unknown as Workflow | undefined
    if (!workflow) throw new Error(`Workflow ${run.spec.workflowRef.name} not in the snapshot`)
    const used = new Map<string, Used & { definition: Entry }>()
    for (const s of workflow.spec.steps) {
      const u = resolveUsed(s.uses, ns, closure)
      if (!u) throw new Error(`step ${s.id}: ${s.uses.kind} ${s.uses.name} not in the snapshot`)
      used.set(s.id, u)
    }
    return { workflow, closure, used }
  }

  return {
    validate(resource: Resource): { findings: Finding[] } {
      if (resource.kind !== 'Workflow') return { findings: [] }
      return { findings: [...overrideFindings(deps.getResource, resource), ...checkWorkflow(resource.spec as unknown as WorkflowSpec, (ref) => resolveUsed(ref, resource.metadata.namespace))] }
    },

    reconcile(input: ReconcileInput): ReconcileResult {
      const run = input.resource as unknown as WorkflowRun
      if (run.kind !== 'WorkflowRun') return { actions: [] }
      const status: WorkflowRunStatus = run.status ?? { phase: 'Pending', steps: {} }
      if (terminalPhases.has(status.phase)) return { actions: [] }
      const ev = input.event
      const now = deps.now()
      const { workflow, used } = load(run)
      const spec = workflow.spec
      const ns = run.metadata.namespace as string
      const runDeadline = new Date(Date.parse(run.metadata.creationTimestamp as string) + durationMs(run.spec.timeout ?? spec.timeout)) // the run's own, else the Workflow's (17-runs.md)
      const stepsById = new Map(spec.steps.map((s) => [s.id, s]))
      const steps: Record<string, StepStatus> = structuredClone(status.steps)
      for (const s of spec.steps) steps[s.id] ??= { phase: 'Pending' }
      const actions: Action[] = []
      const childByName = new Map(input.context.children.map((c) => [c.ref.name, c]))
      let runInputs: RuntimeValues
      try {
        runInputs = checkInputs(spec.inputs ?? {}, run.spec.inputs) // defaults applied (10-ports.md)
      } catch (e) {
        if (e instanceof PortError) return { statusPatch: { steps, phase: 'Failed', error: err('invalid_input', e.message) }, actions: [{ type: 'clearTimer', key: 'deadline' }] }
        throw e
      }

      /** Outputs of a finished step, read at its used kind's stepContract paths on the child run. */
      const stepOutputs = (id: string): { phase: string; outputs?: RuntimeValues; error?: ReconcileError; iterations?: number } | undefined => {
        const st = steps[id]!
        if (!finished.has(st.phase) || st.phase === 'Skipped') return undefined
        const child = st.runRef && childByName.get(st.runRef.name)
        const contract = used.get(id)!.contract
        const outputs = st.outputs ?? (child ? (readPath({ status: child.status }, contract.outputsValuePath) as RuntimeValues | undefined) : undefined) // a reused run is no child; its outputs sit on the step
        return { phase: st.phase, ...(outputs ? { outputs } : {}), ...(st.error ? { error: st.error } : {}), ...(st.iteration ? { iterations: st.iteration } : {}), ...(st.results ? { results: st.results } : {}) } // iterations: how many rounds a repeat step ran; results: each round's outputs
      }
      const sources = (extra: Partial<Sources> = {}): Sources => ({
        inputs: runInputs,
        steps: Object.fromEntries(spec.steps.flatMap((s) => (stepOutputs(s.id) ? [[s.id, stepOutputs(s.id)!]] : []))),
        latest: (kind, id) => deps.latestRevision?.(kind, ns, id),
        ...(deps.latestRevisions ? { query: (kind) => deps.latestRevisions!(kind, ns) } : {}),
        ...extra,
      })
      const site = (step?: Step, withState = true) =>
        siteOf({
          inputs: spec.inputs ?? {},
          steps: Object.fromEntries(spec.steps.map((s) => [s.id, used.get(s.id)!.outputs])),
          ...(step?.repeat ? { ...(withState ? { state: step.repeat.state } : {}), ...(step.repeat.parallel !== undefined ? { extra: { iteration: indexOnly } } : { iterationOutputs: used.get(step.id)!.outputs }) } : {}), // `until` reads iteration and inputs, not state; a parallel repeat reads no iteration outputs (11-workflow.md)
        })

      const cancelActivated = () => {
        for (const [id, st] of Object.entries(steps))
          if (isActive(st)) {
            for (const ref of st.active ? st.active.map((a) => a.runRef) : [st.runRef as ObjectRef]) actions.push({ type: 'cancelResource', ref })
            steps[id] = { ...st, phase: 'Cancelled', active: [] }
          }
      }
      const finish = (patch: Partial<WorkflowRunStatus>): ReconcileResult => ({
        statusPatch: { steps, waitingReason: null, ...patch },
        actions: [...actions, { type: 'clearTimer', key: 'deadline' }],
      })
      const fail = (error: ReconcileError) => {
        cancelActivated()
        return finish({ phase: 'Failed', error, ...(error.code && spec.transitions.some((t) => t.to.some((x) => 'reason' in x && x.reason === error.code)) ? { reason: error.code } : {}) })
      }

      /** A repeat's `initial` or `next` binding, then that iteration; a binding that fails fails the step, as `start` does with its inputs. */
      const iterate = (step: Step, iteration: number, bindings: Parameters<typeof bind>[0], src: Sources): void => {
        let state: RuntimeValues
        try {
          state = bind(bindings, src, site(step))
        } catch (e) {
          if (e instanceof PortError) {
            steps[step.id] = { ...steps[step.id], phase: 'Failed', error: err('invalid_input', `step ${step.id}: ${e.message}`) }
            return
          }
          throw e
        }
        start(step, iteration, state)
      }

      /** Starts a step (or a repeat iteration): one child run with inherited snapshot and bound inputs. */
      const start = (step: Step, iteration?: number, state?: RuntimeValues): void => {
        const u = used.get(step.id)!
        const own = iteration ? `${step.id}[${iteration}]` : ''
        const iterationPath = [run.spec.parent?.iterationPath, own].filter(Boolean).join('/')
        let inputs: RuntimeValues
        try {
          inputs = checkInputs(u.inputs, bind(step.inputs ?? {}, sources(state ? { state } : {}), site(step)))
        } catch (e) {
          if (e instanceof PortError) {
            steps[step.id] = { phase: 'Failed', error: err('invalid_input', `step ${step.id}: ${e.message}`) }
            return
          }
          throw e
        }
        const held = steps[step.id]?.deadline
        const deadline = held ? new Date(Date.parse(held)) : new Date(Math.min(runDeadline.getTime(), now.getTime() + durationMs(step.timeout))) // step timeout bounds the whole loop, not one iteration
        const name = iteration ? `${run.metadata.name}-${step.id}-${iteration}` : `${run.metadata.name}-${step.id}`
        const runRef: ObjectRef = { apiVersion: `${u.contract.runKind.group}/v1`, kind: u.contract.runKind.kind, namespace: ns, name }
        const parallel = step.repeat?.parallel !== undefined
        const earlier = step.memo ? reusable(step, u, inputs) : undefined
        if (earlier) {
          // the work was done: the step is Succeeded with that run's outputs and no child starts (11-workflow.md memo)
          const { uid: _e, ...ref } = refOf(earlier.run)
          const reused = [...(steps[step.id]?.reused ?? []), { ...(iteration ? { iteration } : {}), runRef: ref }]
          steps[step.id] = { ...(parallel ? steps[step.id]! : steps[step.id]?.results ? { results: steps[step.id]!.results! } : {}), phase: parallel ? (steps[step.id]!.phase === 'Pending' ? 'Running' : steps[step.id]!.phase) : 'Succeeded', runRef: ref, reusedFrom: ref, reused, ...(parallel ? {} : { outputs: earlier.outputs }), deadline: rfc3339(deadline), ...(iteration ? { iteration } : {}), ...(state ? { state } : {}) }
          succeeded(step.id, earlier.outputs, iteration)
          return
        }
        const { uid: _u, ...workflowRunRef } = refOf(run)
        const address = { workflowRunRef, stepRef: step.id, iterationPath, logicalExecutionId: `${run.metadata.name}/${own}/${step.id}` } // the run name already carries the enclosing iterations
        const resource: Resource = { apiVersion: runRef.apiVersion, kind: runRef.kind, metadata: { name, namespace: ns }, spec: childSpec(u.contract.runKind.kind, step, inputs, address, deadline, now, run) }
        actions.push({ type: 'createResource', resource, snapshot: 'inherit', owned: true })
        if (parallel) steps[step.id] = { ...steps[step.id]!, phase: 'Running', runRef, deadline: rfc3339(deadline), iteration: iteration!, ...(state ? { state } : {}), active: [...(steps[step.id]!.active ?? []), { iteration: iteration!, runRef }] } // iteration and state: the last started, so `next` goes on from it
        else steps[step.id] = { phase: 'Pending', runRef, deadline: rfc3339(deadline), ...(iteration ? { iteration } : {}), ...(state ? { state } : {}), ...(steps[step.id]?.results ? { results: steps[step.id]!.results! } : {}), ...(steps[step.id]?.reused ? { reused: steps[step.id]!.reused! } : {}) } // the child reports its phase through ChildFinished; the state is kept for `next`, the earlier rounds' results and reuses too
      }

      /** A repeat step starts: round one, and a parallel one as many as it may run at once. */
      const activate = (step: Step): void => {
        if (step.repeat!.parallel !== undefined) {
          steps[step.id] = { phase: 'Pending', active: [], results: [] }
          fill(step)
        } else iterate(step, 1, step.repeat!.initial, sources())
      }

      /** A parallel repeat: start iterations until `parallel` run at once or `until` says the last one started (11-workflow.md). */
      const fill = (step: Step): void => {
        const r = step.repeat!
        for (;;) {
          const st = steps[step.id]!
          if (finished.has(st.phase) || (st.active?.length ?? 0) >= r.parallel!) return
          const last = st.iteration ?? 0
          const done = last > 0 && site(step, false).evaluate(r.until, { ...celContext(sources()), iteration: { index: last } }) === true
          if (done || last >= r.maxIterations) {
            if (!st.active?.length) {
              const limit = last >= r.maxIterations && !done
              steps[step.id] = st.error || limit ? { ...st, phase: 'Failed', error: st.error ?? err('iteration_limit', `${r.maxIterations} iterations`) } : { ...st, phase: 'Succeeded', outputs: st.results?.[last - 1] ?? {} } // every iteration ended: the first failure fails the step, else the last one's outputs are its
            }
            return
          }
          const before = st.active?.length ?? 0
          iterate(step, last + 1, last ? r.next : r.initial, sources(st.state ? { state: st.state } : {}))
          if (steps[step.id]!.phase === 'Failed') return
          if ((steps[step.id]!.active?.length ?? 0) === before && (steps[step.id]!.results?.length ?? 0) <= last) return // nothing started and nothing reused: stop rather than spin
        }
      }

      /** An earlier Succeeded run of the step's definition, same snapshot, same inputs on the step's ports but `memo.ignore`, outputs passing `memo.when`; the newest (11-workflow.md). */
      const reusable = (step: Step, u: Used & { definition: Entry }, inputs: RuntimeValues): { run: Resource; outputs: RuntimeValues } | undefined => {
        const memo = step.memo!
        const ignore = new Set(memo.ignore ?? [])
        const ports = new Set(Object.keys(inputs)) // a candidate with more inputs (a loop continued by hand, a -one revision with base and changes) still matches
        const key = (v: RuntimeValues) => canonicalJson(Object.fromEntries(Object.entries(v).filter(([k]) => ports.has(k) && !ignore.has(k))))
        const want = key(inputs)
        const refField = u.contract.runKind.kind === 'WorkflowRun' ? 'workflowRef' : `${step.uses.kind[0]!.toLowerCase()}${step.uses.kind.slice(1)}Ref`
        const site = memo.when ? siteOf({ outputs: u.outputs }) : undefined
        const hits = (deps.listResources?.(u.contract.runKind.kind, ns) ?? [])
          .filter((r) => r.metadata.snapshot?.digest === run.metadata.snapshot?.digest && readPath(r as unknown as Record<string, unknown>, u.contract.phasePath) === 'Succeeded')
          .filter((r) => {
            const ref = (r.spec as Record<string, { kind: string; name: string } | undefined>)[refField]
            return ref?.kind === step.uses.kind && ref.name === step.uses.name && key(((r.spec as { inputs?: RuntimeValues }).inputs ?? {}) as RuntimeValues) === want
          })
          .map((r) => ({ run: r, outputs: (readPath(r as unknown as Record<string, unknown>, u.contract.outputsValuePath) ?? {}) as RuntimeValues }))
          .filter(({ outputs }) => !site || site.evaluate(memo.when!, { outputs: unwrap(outputs) }) === true)
          .sort((a, b) => String(b.run.metadata.creationTimestamp).localeCompare(String(a.run.metadata.creationTimestamp)))
        return hits[0]
      }

      /** A step's child (or reused run) Succeeded with `outputs`: a repeat records the round and evaluates `until` to go on or end; a parallel one fills up; a plain step is done. */
      const succeeded = (id: string, outputs: RuntimeValues, which?: number): void => {
        const step = stepsById.get(id)!
        if (!step.repeat) {
          steps[id] = { ...steps[id]!, phase: 'Succeeded' }
          return
        }
        const iteration = which ?? steps[id]!.iteration ?? 1
        const results: (RuntimeValues | null)[] = [...(steps[id]!.results ?? [])]
        while (results.length < iteration - 1) results.push(null) // a parallel sibling may end first: its slot waits
        results[iteration - 1] = outputs
        steps[id] = { ...steps[id]!, results }
        if (step.repeat.parallel !== undefined) {
          steps[id] = { ...steps[id]!, active: (steps[id]!.active ?? []).filter((a) => a.iteration !== iteration) }
          return fill(step)
        }
        const done = site(step).evaluate(step.repeat.until, { ...celContext(sources(steps[id]!.state ? { state: steps[id]!.state } : {})), iteration: { index: iteration, outputs: unwrap(outputs) } }) === true // `state` is the one this round ran with (11-workflow.md)
        if (done) steps[id] = { ...steps[id]!, phase: 'Succeeded' }
        else if (iteration >= step.repeat.maxIterations) steps[id] = { ...steps[id]!, phase: 'Failed', error: err('iteration_limit', `${step.repeat.maxIterations} iterations`) }
        else iterate(step, iteration + 1, step.repeat.next, sources({ ...(steps[id]!.state ? { state: steps[id]!.state } : {}), iteration: { index: iteration, outputs } }))
      }

      /** Transition semantics (11-workflow.md), to a fixpoint. Returns the selected terminal, if any. */
      const settle = (): { terminal: Outcome; reason?: string } | undefined => {
        let selected: { terminal: Outcome; reason?: string } | undefined
        let changed = true
        while (changed) {
          changed = false
          for (const t of spec.transitions) {
            const need = (t.join?.strategy ?? 'all') === 'all' ? t.from.length : (t.join?.strategy ?? 'all') === 'any' ? 1 : (t.join?.count ?? 1)
            const counted = t.from.filter((fr) => t.from && fr.outcomes.includes(steps[fr.stepRef]!.phase as Outcome)).length
            const dead = t.from.filter((fr) => finished.has(steps[fr.stepRef]!.phase) && !fr.outcomes.includes(steps[fr.stepRef]!.phase as Outcome)).length
            const toSteps = t.to.filter((x): x is { stepRef: string; when?: string } => 'stepRef' in x)
            const applied = toSteps.some((x) => steps[x.stepRef]!.runRef !== undefined || steps[x.stepRef]!.phase !== 'Pending') || selected !== undefined
            if (applied) continue
            if (counted >= need) {
              // ponytail: a to-step already activated by another Transition counts as this one applied
              const matches = t.to.filter((x) => !x.when || site().evaluate(x.when, celContext(sources())) === true)
              const chosen = (t.dispatch ?? 'all') === 'first' ? matches.slice(0, 1) : matches
              if (chosen.length === 0) {
                if ((t.noMatch ?? 'fail') === 'fail') {
                  selected = { terminal: 'Failed', reason: 'no_match' }
                } else for (const x of toSteps) steps[x.stepRef] = { phase: 'Skipped' }
              } else {
                for (const x of chosen) {
                  if ('stepRef' in x) {
                    const step = stepsById.get(x.stepRef)!
                    if (step.repeat) activate(step)
                    else start(step)
                  } else if (!selected) selected = { terminal: x.terminal, ...(x.reason ? { reason: x.reason } : {}) }
                }
                // a step passed over here that another Transition can still start waits for that one; its death skips the step
                const elsewhere = (id: string) => spec.transitions.some((o) => o !== t && o.to.some((y) => 'stepRef' in y && y.stepRef === id))
                for (const x of toSteps) if (!steps[x.stepRef]!.runRef && steps[x.stepRef]!.phase === 'Pending' && !chosen.includes(x) && !elsewhere(x.stepRef)) steps[x.stepRef] = { phase: 'Skipped' }
              }
              changed = true
            } else if (t.from.length - dead < need) {
              for (const x of toSteps) if (!steps[x.stepRef]!.runRef && steps[x.stepRef]!.phase === 'Pending') {
                steps[x.stepRef] = { phase: 'Skipped' }
                changed = true
              }
            }
          }
        }
        return selected
      }

      /** After settling: terminal handling and progress checks. */
      const conclude = (): ReconcileResult => {
        const selected = settle()
        const stillActive = Object.values(steps).some(isActive)
        if (selected?.terminal === 'Failed') return fail(err(selected.reason ?? 'no_match', `terminal Failed: ${selected.reason ?? 'no_match'}`))
        if (selected?.terminal === 'Succeeded') {
          if (stillActive) return { statusPatch: { steps, phase: 'Running' }, actions }
          for (const t of spec.transitions)
            for (const fr of t.from)
              if (steps[fr.stepRef]!.phase === 'Failed' && !fr.outcomes.includes('Failed')) return fail(err('unconsumed_failure', `step ${fr.stepRef} failed`))
          try {
            const outputs = bind(spec.outputBindings ?? {}, sources(), site())
            checkOutputs(spec.outputs ?? {}, outputs)
            return finish({ phase: 'Succeeded', outputs })
          } catch (e) {
            if (e instanceof PortError) return fail(err('output_unbound', e.message))
            throw e
          }
        }
        if (!stillActive) {
          const failed = spec.steps.map((s) => [s.id, steps[s.id]!] as const).find(([, st]) => st.phase === 'Failed' && st.error)
          if (failed) return fail({ ...failed[1].error!, message: `step ${failed[0]}: ${failed[1].error!.message}` }) // the unrouted failure is the cause; no_progress would hide it
          return fail(err('no_progress', 'every activated step finished and no terminal was selected'))
        }
        return { statusPatch: { steps, phase: 'Running', waitingReason: null }, actions }
      }

      switch (ev.type) {
        case 'Created': {
          for (const id of spec.entry) {
            const step = stepsById.get(id)!
            if (step.repeat) activate(step)
            else start(step)
          }
          actions.push({ type: 'setTimer', key: 'deadline', at: rfc3339(runDeadline) })
          const r = conclude()
          return { ...r, statusPatch: { ...r.statusPatch, phase: r.statusPatch?.phase ?? 'Running' } }
        }

        case 'ChildFinished': {
          const child = childByName.get(ev.payload.ref.name)
          const name = ev.payload.ref.name
          const id = Object.entries(steps).find(([, st]) => st.runRef?.name === name || st.active?.some((a) => a.runRef.name === name))?.[0]
          if (!id || !child) return { actions: [] }
          const contract = used.get(id)!.contract
          const phase = ev.payload.value as StepStatus['phase']
          const error = readPath({ status: child.status }, contract.errorPath) as ReconcileError | undefined
          const which = steps[id]!.active?.find((a) => a.runRef.name === name)?.iteration
          if (phase === 'Succeeded') succeeded(id, (readPath({ status: child.status }, contract.outputsValuePath) ?? {}) as RuntimeValues, which)
          else if (which !== undefined && phase === 'Failed') {
            // a parallel iteration failed: its siblings are independent and go on; the step fails once they have all ended, with the first error (11-workflow.md)
            steps[id] = { ...steps[id]!, active: (steps[id]!.active ?? []).filter((a) => a.iteration !== which), ...(steps[id]!.error ? {} : error ? { error } : {}) }
            fill(stepsById.get(id)!)
          } else steps[id] = { ...steps[id]!, phase, active: [], ...(error && phase === 'Failed' ? { error } : {}) }
          return conclude()
        }

        case 'TimerFired':
          if (ev.payload.key !== 'deadline') return { actions: [] }
          return fail(err('timeout', 'run timeout'))

        case 'CancelRequested':
          cancelActivated()
          return finish({ phase: 'Cancelled' })

        default:
          return { actions: [] }
      }
    },
  }
}

/** Spec of the child run per core runKind. Other kinds follow the TaskRun shape with `<kind>Ref`. */
function childSpec(runKind: string, step: Step, inputs: RuntimeValues, address: Record<string, unknown>, deadline: Date, now: Date, run: WorkflowRun): Record<string, unknown> {
  const dl = rfc3339(deadline)
  switch (runKind) {
    case 'TaskRun':
      return { taskRef: step.uses, address, deadline: dl, inputs }
    case 'GateRun':
      return { gateRef: step.uses, address, deadline: dl, inputs }
    case 'WorkflowRun': {
      const a = address as { workflowRunRef: ObjectRef; stepRef: string; iterationPath: string }
      return { workflowRef: step.uses, inputs, timeout: `${Math.max(0, deadline.getTime() - now.getTime())}ms`, origin: { kind: 'parent' }, parent: { workflowRunRef: a.workflowRunRef, stepRef: a.stepRef, iterationPath: a.iterationPath } }
    }
    default: {
      // ponytail: the stepContract names no child spec shape; user kinds get the TaskRun shape until the design adds one
      const refField = `${step.uses.kind[0]!.toLowerCase()}${step.uses.kind.slice(1)}Ref`
      return { [refField]: step.uses, address, deadline: dl, inputs }
    }
  }
}

function refOf(r: { apiVersion: string; kind: string; metadata: { namespace?: string | undefined; name: string; uid?: string | undefined } }): ObjectRef {
  return { apiVersion: r.apiVersion, kind: r.kind, namespace: r.metadata.namespace as string, name: r.metadata.name, ...(r.metadata.uid ? { uid: r.metadata.uid } : {}) }
}

export type { Transition }
