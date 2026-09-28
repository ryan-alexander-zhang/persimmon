// trigger Handler: turns matching Outbox Signals into ownerless WorkflowRuns (16-trigger.md).
import type { Finding, HandlerImpl, ReconcileInput, ReconcileResult } from '../../handler/types.js'
import type { OutboxEvent } from '../../outbox/event.js'
import type { Action, ReconcileError } from '../../reconcile/types.js'
import type { LocalDefinitionRef, ObjectRef, Resource, RevisionRef } from '../../resource/types.js'
import type { HandlerDeps } from '../deps.js'
import { checkInputs, PortError, sameType } from '../ports/ports.js'
import type { Binding, InputSpec, PortType, RuntimeValue, RuntimeValues } from '../ports/types.js'
import { rfc3339 } from '../task/handler.js'
import type { WorkflowSpec } from '../workflow/types.js'

export type EventSelector =
  | { kind: 'artifactPublished'; artifactKind: { apiVersion: string; kind: string } }
  | { kind: 'workflowRunFinished'; workflowRef: LocalDefinitionRef; phases: string[] }

export interface TriggerSpec {
  event: EventSelector
  run: { workflowRef: LocalDefinitionRef; inputs?: Record<string, Binding>; timeout?: string }
  enabled?: boolean
}
export type Trigger = Resource<TriggerSpec, { lastRun?: { ref: ObjectRef; eventId: string; at: string }; failures?: { eventId: string; at: string; error: ReconcileError }[] }>

type Roots = Record<string, unknown>

/** Does the Signal's event match the selector? Returns the `fromEvent` roots when it does. */
export function matchEvent(selector: EventSelector, event: OutboxEvent, subject: Resource): Roots | undefined {
  if (selector.kind === 'artifactPublished') {
    if (event.type !== 'artifact.published') return undefined
    const s = event.subject as RevisionRef
    if (s.apiVersion !== selector.artifactKind.apiVersion || s.kind !== selector.artifactKind.kind) return undefined
    return { artifact: { kind: 'artifact', ref: s } satisfies RuntimeValue, content: (subject.spec as { content?: unknown }).content ?? {} }
  }
  if (event.type !== 'resource.finished' || subject.kind !== 'WorkflowRun') return undefined
  const spec = subject.spec as { workflowRef: LocalDefinitionRef; origin: { kind: string } }
  const status = subject.status as { phase?: string; outputs?: RuntimeValues } | undefined
  if (spec.workflowRef.name !== selector.workflowRef.name || spec.origin.kind === 'parent') return undefined
  if (!status?.phase || !selector.phases.includes(status.phase)) return undefined
  return { outputs: status.outputs ?? {}, phase: { kind: 'value', value: status.phase } satisfies RuntimeValue }
}

/** Binds `run.inputs`: `fromEvent` roots yield RuntimeValues; `content.<path>` and `phase` wrap as values. */
export function bindTriggerInputs(bindings: Record<string, Binding>, roots: Roots): RuntimeValues {
  const out: RuntimeValues = {}
  for (const [port, b] of Object.entries(bindings)) {
    if ('literal' in b) {
      out[port] = { kind: 'value', value: b.literal }
      continue
    }
    if (!('fromEvent' in b)) throw new PortError(`${port}: only fromEvent and literal in a Trigger`)
    const [root, ...rest] = b.fromEvent.split('.') as [string, ...string[]]
    let v: unknown = roots[root]
    if (root === 'content') v = rest.reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], v)
    else if (root === 'outputs') v = (v as RuntimeValues | undefined)?.[rest[0] ?? '']
    if (v === undefined) {
      if (b.onMissing === 'omit') continue
      throw new PortError(`${port}: ${b.fromEvent} absent`)
    }
    out[port] = root === 'content' ? { kind: 'value', value: v } : (v as RuntimeValue)
  }
  return out
}

export function triggerHandler(deps: HandlerDeps): HandlerImpl {
  const workflowOf = (t: Trigger) => deps.getResource('Workflow', t.metadata.namespace, t.spec.run.workflowRef.name)?.spec as unknown as WorkflowSpec | undefined

  return {
    validate(resource: Resource): { findings: Finding[] } {
      if (resource.kind !== 'Trigger') return { findings: [] }
      const t = resource as unknown as Trigger
      const f: Finding[] = []
      const wf = workflowOf(t)
      if (!wf) return { findings: [{ severity: 'warning', code: 'workflow_missing', path: '/spec/run/workflowRef', message: `Workflow ${t.spec.run.workflowRef.name} not found` }] }
      const bad = (path: string, message: string) => f.push({ severity: 'error', code: 'invalid_trigger', path, message })
      const rootType = (path: string): PortType | 'value' | undefined => {
        const [root, ...rest] = path.split('.') as [string, ...string[]]
        if (t.spec.event.kind === 'artifactPublished') {
          if (root === 'artifact') return { kind: 'artifact', artifactKind: t.spec.event.artifactKind }
          if (root === 'content') return 'value'
        } else {
          if (root === 'phase') return 'value'
          if (root === 'outputs') {
            const src = deps.getResource('Workflow', t.metadata.namespace, t.spec.event.workflowRef.name)?.spec as unknown as WorkflowSpec | undefined
            return src?.outputs?.[rest[0] ?? '']?.type
          }
        }
        return undefined
      }
      for (const [port, b] of Object.entries(t.spec.run.inputs ?? {})) {
        const target = wf.inputs?.[port]
        if (!target) {
          bad(`/spec/run/inputs/${port}`, `unknown Workflow input ${port}`)
          continue
        }
        if ('fromEvent' in b) {
          const ty = rootType(b.fromEvent)
          if (!ty) bad(`/spec/run/inputs/${port}`, `no root ${b.fromEvent} for ${t.spec.event.kind}`)
          else if (ty === 'value' ? target.type.kind !== 'value' : !sameType(ty, target.type)) bad(`/spec/run/inputs/${port}`, 'event root type differs from the port type')
        }
      }
      for (const [port, s] of Object.entries(wf.inputs ?? {})) if (s.required !== false && !t.spec.run.inputs?.[port]) bad('/spec/run/inputs', `required input ${port} unbound`)
      if (t.spec.event.kind === 'artifactPublished') {
        const ak = t.spec.event.artifactKind
        if (Object.values(wf.outputs ?? {}).some((o) => o.type.kind === 'artifact' && sameType(o.type, { kind: 'artifact', artifactKind: ak }))) bad('/spec/run/workflowRef', 'target Workflow outputs the triggering artifact kind')
      } else if (t.spec.event.workflowRef.name === t.spec.run.workflowRef.name) bad('/spec/run/workflowRef', 'a run-finished Trigger must start a different Workflow')
      return { findings: f }
    },

    reconcile(input: ReconcileInput): ReconcileResult {
      const t = input.resource as unknown as Trigger
      const ev = input.event
      if (t.kind !== 'Trigger' || ev.type !== 'Signal' || ev.payload.source !== 'outbox' || t.spec.enabled === false) return { actions: [] }
      const { event, subject } = ev.payload.payload as { event: OutboxEvent; subject: Resource }
      const roots = matchEvent(t.spec.event, event, subject)
      if (!roots) return { actions: [] }
      const now = rfc3339(deps.now())
      const failed = (error: ReconcileError): ReconcileResult => ({
        statusPatch: { failures: [...(t.status?.failures ?? []), { eventId: event.eventId, at: now, error }].slice(-20) },
        actions: [{ type: 'emitEvent', eventType: 'trigger.failed', payload: { eventId: event.eventId, error } }],
      })
      const wf = workflowOf(t)
      if (!wf) throw new Error(`Workflow ${t.spec.run.workflowRef.name} not found`) // the Trigger stalls (16-trigger.md)
      let inputs: RuntimeValues
      try {
        inputs = checkInputs((wf.inputs ?? {}) as Record<string, InputSpec>, bindTriggerInputs(t.spec.run.inputs ?? {}, roots))
      } catch (e) {
        if (e instanceof PortError) return failed({ code: 'invalid_input', message: e.message, retryable: false })
        throw e
      }
      const name = `${t.metadata.name}-${event.eventId.replace(/^sha256:/, '').slice(0, 12)}`
      const causationRef = causationOf(deps, event)
      const resource: Resource = {
        apiVersion: 'persimmon.ai/v1',
        kind: 'WorkflowRun',
        metadata: { name, namespace: t.metadata.namespace as string },
        spec: {
          workflowRef: t.spec.run.workflowRef,
          inputs,
          ...(t.spec.run.timeout ? { timeout: t.spec.run.timeout } : {}), // absent: the Workflow's
          origin: { kind: 'trigger', triggerRef: { apiVersion: t.apiVersion, kind: t.kind, namespace: t.metadata.namespace as string, name: t.metadata.name, uid: t.metadata.uid as string }, eventId: event.eventId, ...(causationRef ? { causationRef } : {}) },
        },
      }
      const create: Action = { type: 'createResource', resource, snapshot: 'new', owned: false }
      return { statusPatch: { lastRun: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: t.metadata.namespace as string, name }, eventId: event.eventId, at: now } }, actions: [create] }
    },
  }
}

/** The WorkflowRun that produced the event: the producer itself, or its owner (16-trigger.md). */
function causationOf(deps: HandlerDeps, event: OutboxEvent): ObjectRef | undefined {
  if (!event.producer) return undefined
  const p = deps.getByUid(event.producer.uid)
  if (!p) return undefined
  const ref = (r: Resource): ObjectRef => ({ apiVersion: r.apiVersion, kind: r.kind, namespace: r.metadata.namespace as string, name: r.metadata.name, uid: r.metadata.uid as string })
  if (p.kind === 'WorkflowRun') return ref(p)
  const owner = p.metadata.ownerReferences?.[0]
  return owner?.kind === 'WorkflowRun' ? owner : undefined
}
