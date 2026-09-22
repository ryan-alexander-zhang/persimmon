# KindDefinition

status: draft · layer: 0 · schema: [`schemas/kind-definition.yaml`](schemas/kind-definition.yaml)

One Global Resource registers one Kind. Shipped kinds and user kinds use the same object.

```text
KindDefinition workflows.persimmon.ai
  ├─ group, names, versions ─▶ validates every Resource {apiVersion: group/version, kind}
  ├─ scope, mutability ──────▶ where Resources of the kind live; whether spec may change
  ├─ handlerRef ─────────────▶ Handler gives them behaviour (02-handler.md)
  ├─ terminal ───────────────▶ engine watches status.<path>; emits ChildFinished (03-reconcile.md)
  ├─ snapshot, snapshotOnCreate ▶ frozen into closures (04-snapshot.md)
  ├─ revisioned ─────────────▶ immutable revisions (05-revisioned-kind.md)
  ├─ subscriptions ──────────▶ Outbox events arrive as Signal (06-outbox.md)
  └─ stepContract ───────────▶ any composing kind runs them as steps
```

## Spec

| Field | Rule |
|---|---|
| `group` | DNS subdomain |
| `names.kind`, `names.plural` | PascalCase; lowercase plural |
| `scope` | `Namespaced` \| `Global` |
| `versions[]` | `{name: v<n>, schema, statusSchema?}`; JSON Schema 2020-12 for `spec` and `status`; no conversion; Handlers declare accepted versions (`02-handler.md`) |
| `mutability` | `SpecMutable` \| `Immutable`; Immutable freezes `spec` after create |
| `revisioned` | default false; true forces `Immutable` and `snapshot: Definition`; `schema` then validates `spec.content` |
| `snapshot` | `Definition` \| `None`; Definition Resources join snapshot closures |
| `snapshotOnCreate` | default false; true resolves a closure on every create |
| `handlerRef` | `{name}` of a Handler; absent for pure-data kinds |
| `terminal` | `{path, values[]}`; `path` rooted at `status`; reaching a value emits ChildFinished; absent means never finishes |
| `stepContract` | optional; see below |
| `subscriptions[]` | `{eventType, filter?}`; `eventType` open string (`06-outbox.md`); `filter` CEL over the event; needs `handlerRef` |

A matching Outbox event reaches every Resource of the kind as a Signal. `filter` narrows at
kind level; the Handler narrows per Resource.

## Schema annotations

| Annotation | Meaning |
|---|---|
| `x-persimmon-ref: {kinds?: [..]}` | field is a LocalDefinitionRef; engine checks existence and follows it for snapshots; `kinds` absent means any `snapshot: Definition` kind |

## Step contract

Lets a composing kind run a Resource as a step without knowing what it is.

```text
composing Handler                          step kind
  read  <inputsPath>, <outputsPath> ──────▶ typed ports on the definition
  createResource(runKind, bound inputs) ──▶ one run
  wait ChildFinished ◀─────────────────────  run reaches terminal.values
  read  <phasePath>, <outputsValuePath>, <errorPath> on the run
```

| Field | Rule |
|---|---|
| `inputsPath`, `outputsPath` | rooted at `spec`; port maps on the definition |
| `runKind` | `{group, kind}`; registered, has `terminal` |
| `phasePath` | rooted at `status`; by convention `Pending Running Waiting Succeeded Failed Cancelled` |
| `outputsValuePath` | rooted at `status`; value map on Succeeded |
| `errorPath` | rooted at `status`; `{code, message, retryable}` on Failed |

No closed list of step kinds exists anywhere in the engine.

## Rules outside the schema

| Rule | Enforcer |
|---|---|
| `metadata.name` = `<names.plural>.<group>` | static checker |
| `stepContract.runKind` is registered and has `terminal` | static checker |
| `versions[].name` unique; Resources keep the version they were written in | static checker; store |
| Global: no `namespace`; write needs `admin` grant | write path (`00-resource.md`) |

## Decisions

- `terminal` optional with `handlerRef`. Definition kinds (Workflow, Task) have a Handler
  for `validate` and never finish. Reference required `terminal` whenever `handlerRef` was set.
- `x-persimmon-ref.kinds` optional. Absent means the ref's own `kind` field decides; this is
  what keeps step kinds open.
- `revisioned: true` ⇒ `snapshot: Definition`. Publish validates against the frozen schema.
- `subscriptions.filter` is a CEL expression string. Reference left the shape open.
- `versions[].statusSchema` optional; absent means `status` is free-form for that version.

## Examples

- [`examples/kind-definition-workflow.yaml`](examples/kind-definition-workflow.yaml):
  SpecMutable definition kind with handler, stepContract, no terminal
- [`examples/kind-definition-workflowrun.yaml`](examples/kind-definition-workflowrun.yaml):
  Immutable run kind with terminal and `snapshotOnCreate`
- [`examples/kind-definition-productrequirement.yaml`](examples/kind-definition-productrequirement.yaml):
  revisioned artifact kind, no handler
- [`examples/kind-definition-trigger.yaml`](examples/kind-definition-trigger.yaml):
  kind with `subscriptions`
