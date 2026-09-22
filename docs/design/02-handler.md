# Handler

status: draft · layer: 0 · schema: [`schemas/handler.yaml`](schemas/handler.yaml)

One Global Resource binds kinds to behaviour. Built in or an Adapter; same contract.

```text
KindDefinition ── handlerRef ──▶ Handler ── implementation ──▶ builtin code
                                    │                       └▶ Adapter (role: handler, 07-adapter.md)
                                    │
   admission ──── validate(resource) ──────────────────▶ {findings[]}
   Event ──────── reconcile(resource, event, context) ─▶ {statusPatch?, actions[]}
```

## Spec

| Field | Rule |
|---|---|
| `kinds[]` | `{group, kind, versions[]}`; versions accepted; `versions` ⊆ the KindDefinition's; one Handler per (kind, version) |
| `implementation` | exactly one of `builtin: <dns-label>` or `adapter: {id}`; Adapter Ready, role `handler`, its `describe.kinds` ⊇ `kinds` |

## Contract

```text
validate(resource)                          -> {findings[]}
reconcile(resource, event, context, engine?) -> {statusPatch?, actions[]}   applied atomically (03-reconcile.md)
```

| Finding field | Rule |
|---|---|
| `severity` | `error` rejects the write; `warning` is recorded |
| `code`, `path`, `message` | `path` is a JSON pointer into the Resource |

| Reconcile input | Content |
|---|---|
| `resource` | full Resource |
| `event` | `{type, sequence, payload?}`; `sequence` per Resource, monotonic |
| `context.children[]` | `{ref: ObjectRef, terminal: bool, status}` per child |
| `context.snapshot` | `{uri, digest}` or absent |
| `context.actor` | Actor of the triggering Event; absent for engine-originated Events |
| `context.timers[]` | keys of pending timers |
| `engine` | `{endpoint, token}`; Adapter implementations only; token scoped to this reconcile |

Every Event is delivered; an Event the Handler does not use returns `{actions: []}`.

## Rules

| Rule | Enforcer |
|---|---|
| Stateless between calls; memory lives in `status` or children | Handler author; conformance suite (`07-adapter.md`) |
| Idempotent on `(metadata.uid, event.sequence)`; a redelivered Event yields the same result | Handler author; conformance suite |
| Writes only its own Resource's `status`, under its `handler` Actor; reaches other Resources only by `createResource`, `cancelResource` | engine: no other action exists |
| `validate` holds rules the schema cannot express | Handler author |
| `kinds[]` names registered kinds whose `handlerRef` points back; every registered version of a kind with `handlerRef` has one accepting Handler | static checker |
| Adapter implementation: `Adapter.status.describe.kinds` ⊇ `kinds` | write path |
| Global: no `namespace`; write needs `admin` grant | write path (`00-resource.md`) |

## Decisions

- `implementation.adapter` is `{id}` only. Reference carried `transport` here; the Adapter
  Resource owns it.
- No `events[]` filter. Reference let a Handler list wanted Events; a Handler that ignores
  an Event costs one no-op call, and a filter could drop AdapterFinished or TimerFired the
  Handler itself caused.
- `statusPatch` in the result is the only way to write `status`; the reference's separate
  `patchStatus` action is dropped (`03-reconcile.md` follows).
- `context.actor` absent on engine-originated Events (TimerFired, ChildFinished,
  AdapterFinished). Reference did not say.
- Static checker is a write-path stage after schema validation, before Handler `validate`.
- KindDefinition, Handler, Adapter are registered by the engine at start with no
  `handlerRef`.

## Examples

- [`examples/handler-workflow.yaml`](examples/handler-workflow.yaml): builtin handler for
  Workflow and WorkflowRun
- [`examples/handler-adapter.yaml`](examples/handler-adapter.yaml): out-of-process handler
- [`examples/handler-reconcile-io.yaml`](examples/handler-reconcile-io.yaml): one
  `reconcile` input and output; validates against `#/$defs/ReconcileInput` and
  `#/$defs/ReconcileResult`; RuntimeValue shape per `10-ports.md`
