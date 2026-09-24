# Trigger

status: draft · layer: 1 · schema: [`schemas/trigger.yaml`](schemas/trigger.yaml)

A kind that creates a WorkflowRun from an Outbox event. Not referenceable, not in
snapshots.

```text
Outbox event ─▶ Trigger kind subscription ─▶ Signal {event, subject} to every Trigger in the Namespace
                                                  │ trigger Handler
                                                  ├─ enabled? spec.event selectors match?
                                                  ├─ roots from subject ─▶ bind spec.run.inputs (fromEvent)
                                                  └─ createResource(WorkflowRun {origin: trigger}, owned: false, snapshot: new)
```

## Spec

| Field | Rule |
|---|---|
| `event.kind` | `artifactPublished` \| `workflowRunFinished` |
| `event` selectors | per kind, below |
| `run.workflowRef` | LocalDefinitionRef to a Workflow; resolved at run creation in the Trigger's Namespace, then Global |
| `run.inputs` | optional; `{<port>: Binding}`; `fromEvent` and `literal` only |
| `run.timeout` | required; Duration for the created run |
| `enabled` | default true; false: Signals arrive and are ignored |

| `event.kind` | Selectors | Outbox type | Roots for `fromEvent` (from the Signal's `subject`) |
|---|---|---|---|
| `artifactPublished` | `artifactKind: {apiVersion, kind}` (`x-persimmon-kind-ref`) | `artifact.published` | `artifact` → RevisionRef; `content.<path>` → `spec.content.<path>` |
| `workflowRunFinished` | `workflowRef`, `phases ⊆ [Succeeded, Failed, Cancelled]`; root runs only (`origin.kind != parent`) | `resource.finished`, `subject.kind == WorkflowRun` | `outputs.<port>` → `status.outputs.<port>`; `phase` → `status.phase` |

The Signal carries the subject Resource as stored (`06-outbox.md`); no read callback is
needed. A chained Workflow learns its cause from `spec.origin`, not from a port.

## Handler

| Signal | Behaviour |
|---|---|
| `enabled: false`, or selectors do not match | ignored |
| a binding fails: missing `content.<path>`, type mismatch | `status.failures[]` appended; `trigger.failed` emitted with `{eventId, error}`; no run |
| otherwise | `createResource(WorkflowRun)` in the Trigger's Namespace, `owned: false`, `snapshot: new`, name `<trigger>-<first 12 hex of eventId>`, `origin: {kind: trigger, triggerRef, eventId, causationRef?}`; `status.lastRun` set |
| SpecUpdated, ChildFinished | no-op |

Idempotency: the run name repeats for a repeated `eventId`; `createResource` of an existing
name with equal `spec` is a no-op (`03-reconcile.md`). `causationRef` is the WorkflowRun
that produced the event, when the event's `producer` resolves to one or to its child. An
unresolved `workflowRef` fails the create; the Trigger stalls (`03-reconcile.md`).

## Status

| Field | Rule |
|---|---|
| `lastRun` | `{ref: ObjectRef, eventId, at}` |
| `failures[]` | `{eventId, at, error}`; last 20 |

## Rules

| Rule | Enforcer |
|---|---|
| target Workflow resolves at admission | static checker warns `workflow_missing`; the create fails at run time |
| every required input of the target Workflow bound | static checker |
| `fromEvent` root exists for `event.kind`; its type equals the port type | static checker |
| `content.<path>` resolves in the artifact kind's schema | static checker |
| `artifactPublished`: the target Workflow's outputs do not include `artifactKind` | static checker |
| `workflowRunFinished`: `event.workflowRef` differs from `run.workflowRef` | static checker |
| a Trigger is `Namespaced`, `snapshot: None`, no `terminal`, not referenceable | KindDefinition |

## Decisions

- `spec.on` renamed `spec.event`; bare `on` is a YAML 1.1 boolean. `artifactKind` nested as
  `{apiVersion, kind}` like a PortType.
- Trigger-created runs are ownerless (`createResource owned: false`, `03-reconcile.md`), so a
  Trigger stays deletable and receives no ChildFinished.
- `enabled: false` is a Handler check; delivery is kind-level (`06-outbox.md`). Reference had
  disabled Triggers receive nothing.
- Idempotency by run name `<trigger>-<12 hex>`; a deleted and recreated Trigger does not
  refire. Reference keyed on `(triggerName, eventId)` without a mechanism.
- `fromEvent: run` dropped; no ObjectRef PortType. Reference had it.
- `workflowRunFinished` matches root runs only.
- Loop guard is the Layer 0 causation chain, per Signal (`06-outbox.md`); the reference's
  `(triggerName, workflowRef)` count is dropped.
- `trigger.failed` Outbox event replaces the reference's TriggerFailed record.
- No Trigger `terminal`.
- `event.kind` is closed to engine-produced events; external sources and webhooks are roadmap.

## Examples

- [`examples/trigger-on-prd-published.yaml`](examples/trigger-on-prd-published.yaml):
  `artifactPublished`
- [`examples/trigger-on-run-finished.yaml`](examples/trigger-on-run-finished.yaml):
  `workflowRunFinished` chaining a follow-up Workflow
- [`examples/trigger-firing.yaml`](examples/trigger-firing.yaml): one Firing: Signal,
  bound inputs, created run; validates against `#/$defs/Firing`
- [`examples/kind-definition-trigger.yaml`](examples/kind-definition-trigger.yaml),
  [`examples/handler-trigger.yaml`](examples/handler-trigger.yaml)
