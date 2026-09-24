import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdapterRegistry } from '../../adapter/registry.js'
import type { ReconcileInput, ReconcileResult } from '../../handler/types.js'
import { KindRegistry } from '../../kind-definition/registry.js'
import type { Action, Event } from '../../reconcile/types.js'
import type { Resource } from '../../resource/types.js'
import type { HandlerDeps } from '../deps.js'
import { triggerHandler } from './handler.js'

const example = (n: string) => parse(readFileSync(`docs/design/examples/${n}.yaml`, 'utf8'))
const firing = example('trigger-firing')
const approval = example('workflow-fan-in') as Resource
const producerTask = example('run-taskrun') as Resource
const clean = (x: unknown) => JSON.parse(JSON.stringify(x))

describe('trigger Handler', () => {
  let deps: HandlerDeps
  let handler: ReturnType<typeof triggerHandler>
  beforeEach(() => {
    const store: Record<string, Resource> = { 'Workflow/prd-approval': approval }
    deps = {
      kinds: new KindRegistry(), adapters: new AdapterRegistry({ resolve: () => undefined }), now: () => new Date('2026-09-21T10:30:01Z'), closure: () => ({ version: 1, resources: [], adapters: [] }), callback: () => undefined, random: () => 0,
      getResource: (kind, _ns, name) => store[`${kind}/${name}`],
      getByUid: (uid) => (uid === producerTask.metadata.uid ? producerTask : undefined),
    }
    handler = triggerHandler(deps)
  })
  const trigger = (): Resource => ({ ...example('trigger-on-prd-published'), metadata: { ...example('trigger-on-prd-published').metadata, uid: firing.run.spec.origin.triggerRef.uid } })
  const input = (t: Resource, event: Event = firing.signal): ReconcileInput => ({ resource: t, event, context: { children: [], timers: [] }, engine: { endpoint: 'x', token: 't' } })

  it('reproduces the design firing example', () => {
    const res = handler.reconcile(input(trigger())) as ReconcileResult
    const create = res.actions[0] as Extract<Action, { type: 'createResource' }>
    expect(create).toMatchObject({ type: 'createResource', snapshot: 'new', owned: false })
    expect(clean(create.resource)).toEqual(firing.run)
    expect(clean(res.statusPatch)).toEqual({ lastRun: { ref: { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: firing.run.metadata.name }, eventId: firing.signal.payload.eventId, at: '2026-09-21T10:30:01Z' } })
  })

  it('ignores disabled Triggers, other selectors and non-outbox Signals', () => {
    const off = trigger()
    ;(off.spec as { enabled: boolean }).enabled = false
    expect(handler.reconcile(input(off))).toEqual({ actions: [] })
    const other = trigger()
    ;(other.spec as { event: { artifactKind: { kind: string } } }).event.artifactKind.kind = 'ResearchReport'
    expect(handler.reconcile(input(other))).toEqual({ actions: [] })
    expect(handler.reconcile(input(trigger(), { type: 'Signal', sequence: 1, dedupeKey: 'x', payload: { source: 'api', eventId: 'e' } }))).toEqual({ actions: [] })
    expect(handler.reconcile(input(trigger(), { type: 'Created', sequence: 1, dedupeKey: 'created' }))).toEqual({ actions: [] })
  })

  it('records a binding failure and emits trigger.failed instead of a run', () => {
    const t = trigger()
    ;(t.spec as { run: { inputs: Record<string, unknown> } }).run.inputs = { prd: { fromEvent: 'content.nope' } }
    const res = handler.reconcile(input(t)) as ReconcileResult
    expect(res.actions).toEqual([{ type: 'emitEvent', eventType: 'trigger.failed', payload: { eventId: firing.signal.payload.eventId, error: { code: 'invalid_input', message: 'prd: content.nope absent', retryable: false } } }])
    expect(clean(res.statusPatch).failures).toHaveLength(1)
  })

  it('run-finished Triggers match root runs of the named Workflow in the listed phases', () => {
    const t = example('trigger-on-run-finished') as Resource
    const planning = { ...approval, metadata: { name: 'planning-iteration', namespace: 'demo' }, spec: { ...approval.spec, inputs: { approved: { type: { kind: 'value', schema: { type: 'boolean' } } }, mode: { type: { kind: 'value', schema: { type: 'string' } } } } } }
    const prev = deps.getResource
    deps.getResource = (kind, ns, name) => (name === 'planning-iteration' ? planning : prev(kind, ns, name))
    const done = example('run-workflowrun') as Resource
    const event = { eventId: 'sha256:' + 'a'.repeat(64), type: 'resource.finished', time: 'x', subject: { apiVersion: 'persimmon.ai/v1', kind: 'WorkflowRun', namespace: 'demo', name: done.metadata.name, uid: done.metadata.uid }, ordinal: 0, actor: { kind: 'handler', id: 'workflow' }, causationChain: [], payload: { value: 'Succeeded' } }
    const signal = (subject: Resource): Event => ({ type: 'Signal', sequence: 1, dedupeKey: 'x', payload: { source: 'outbox', eventId: event.eventId, payload: { event, subject } } })
    const finished = { ...done, spec: { ...done.spec, workflowRef: { kind: 'Workflow', name: 'prd-approval' } }, status: { phase: 'Succeeded', outputs: { approved: { kind: 'value', value: true } } } }
    const res = handler.reconcile(input(t, signal(finished))) as ReconcileResult
    const create = res.actions[0] as Extract<Action, { type: 'createResource' }>
    expect(create.resource.spec).toMatchObject({ workflowRef: { kind: 'Workflow', name: 'planning-iteration' }, inputs: { approved: { kind: 'value', value: true }, mode: { kind: 'value', value: 'full' } }, timeout: '24h' })
    expect(create.resource.metadata.name).toBe(`on-prd-approved-${'a'.repeat(12)}`)
    const child = { ...finished, spec: { ...finished.spec, origin: { kind: 'parent' } } }
    expect(handler.reconcile(input(t, signal(child)))).toEqual({ actions: [] })
    const failedRun = { ...finished, status: { phase: 'Failed' } }
    expect(handler.reconcile(input(t, signal(failedRun)))).toEqual({ actions: [] })
  })

  it('validate checks roots, types, required inputs and the two shape rules', () => {
    expect(handler.validate(trigger()).findings).toEqual([])
    const t = trigger()
    ;(t.spec as { run: { inputs: Record<string, unknown> } }).run.inputs = { prd: { fromEvent: 'content.title' }, nope: { literal: 1 } }
    expect(handler.validate(t).findings.map((f) => f.message)).toEqual(['event root type differs from the port type', 'unknown Workflow input nope'])
    const loop = example('trigger-on-run-finished') as Resource
    ;(loop.spec as { run: { workflowRef: { name: string } } }).run.workflowRef.name = 'prd-approval'
    expect(handler.validate(loop).findings.map((f) => f.message)).toContain('a run-finished Trigger must start a different Workflow')
    const missing = trigger()
    ;(missing.spec as { run: { workflowRef: { name: string } } }).run.workflowRef.name = 'gone'
    expect(handler.validate(missing).findings[0]).toMatchObject({ severity: 'warning', code: 'workflow_missing' })
  })
})
