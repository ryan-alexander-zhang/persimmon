# KindDefinition

status: active · layer: 0 · schema: [`schemas/kind-definition.yaml`](schemas/kind-definition.yaml)

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
| `scope` | `Namespaced` \| `Global` \| `Any`; Any: a Resource may carry a Namespace or not, and a Namespaced one shadows the Global one by name |
| `versions[]` | `{name: v<n>, schema, statusSchema?}`; JSON Schema 2020-12 for `spec` and `status`; no conversion; Handlers declare accepted versions (`02-handler.md`) |
| `mutability` | `SpecMutable` \| `Immutable`; Immutable freezes `spec` after create |
| `revisioned` | default false; true forces `Immutable`, `Namespaced`, `snapshot: None`, no `statusSchema`; `schema` then validates `spec.content` (`05-revisioned-kind.md`); after registration the definition changes in `versions[].schema` only, and `apply` takes the change only when every committed revision of the kind still validates under it |
| `snapshot` | `Definition` \| `None`; Definition Resources join snapshot closures |
| `snapshotOnCreate` | default false; true resolves a closure on every create |
| `handlerRef` | `{name}` of a Handler; absent for pure-data kinds |
| `terminal` | `{path, values[]}`; `path` rooted at `status`; reaching a value emits ChildFinished; absent means never finishes |
| `stepContract` | optional; see below |
| `expansion` | optional `{kind}`: this kind is sugar for `kind`, a registered Definition kind; needs `handlerRef`; `snapshot: Definition`; `stepContract`, when present, equals the target's (`21-composition.md`) |
| `subscriptions[]` | `{eventType, filter?}`; `eventType` open string (`06-outbox.md`); `filter` CEL over the event; needs `handlerRef` |

A matching Outbox event reaches every Resource of the kind in the subject's Namespace as a
Signal (`06-outbox.md`). `filter` narrows at kind level; the Handler narrows per Resource.

## Schema annotations

| Annotation | Meaning |
|---|---|
| `x-persimmon-ref: {kinds?: [..]}` | field is a LocalDefinitionRef; engine checks existence and follows it for snapshots; `kinds` absent means any `snapshot: Definition` kind |
| `x-persimmon-kind-ref: {}` | field is `{apiVersion, kind}`; engine checks registration and freezes that KindDefinition (`04-snapshot.md`) |
| `x-persimmon-adapter: {roles?: [..]}` | field is an Adapter id; engine checks Ready and the roles, records the `describe` digest (`04-snapshot.md`) |

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

## Expansion

A kind with `expansion` never runs itself. Its Handler's `expand` (`02-handler.md`) turns one
Resource into Resources of the target kind and its helpers; `validate` checks the expansion with
the target's rules, and the snapshot walk stores the expansion in place of the Resource
(`04-snapshot.md`). The composition kinds of `21-composition.md` are the shipped users.

## Rules outside the schema

| Rule | Enforcer |
|---|---|
| `metadata.name` = `<names.plural>.<group>` | static checker |
| `stepContract.runKind` is registered and has `terminal` | static checker |
| `versions[].name` unique; Resources keep the version they were written in | static checker; store |
| Global: no `namespace`; write needs `admin` grant | write path (`00-resource.md`) |

## Decisions

- `scope: Any` added for definition kinds, so a pack ships Global definitions that a
  Namespace overrides by name (reference decision 26). Reference had `Namespaced | Global`.

- `terminal` optional with `handlerRef`. Definition kinds (Workflow, Task) have a Handler
  for `validate` and never finish. Reference required `terminal` whenever `handlerRef` was set.
- `x-persimmon-ref.kinds` optional. Absent means the ref's own `kind` field decides; this is
  what keeps step kinds open.
- `revisioned: true` ⇒ `Immutable`, `Namespaced`, `snapshot: None`, no `statusSchema`. The
  schema is frozen through `x-persimmon-kind-ref`, not by making revisions closure members.
- `subscriptions.filter` is a CEL expression string. Reference left the shape open.
- `versions[].statusSchema` optional; absent means `status` is free-form for that version.
- A shipped KindDefinition's `versions[].schema` may be `{$ref: "<design file>#/<pointer>"}` into
  `docs/design/schemas`; the engine resolves file and local refs and walks only the `oneOf`
  branch whose `const` discriminators match. Found in implementation.
- A `revisioned: true` KindDefinition never changes after registration; committed revisions were
  validated against it. Found in implementation.
- Superseded: it changes in `versions[].schema` alone, and `apply` accepts the new schema when
  every committed revision of the kind, in every Namespace, validates under it; the first that
  does not refuses the apply by name (`Design/x.r1 fails the new schema: ...`). The safety property
  is "what is stored still validates"; a list of allowed edits (an optional property, a wider enum)
  approximates it and misses cases both ways, and checking the revisions is exact and cheap in local
  mode. Nothing is rewritten: a migration stays roadmap. A run in flight keeps the definition its
  snapshot froze (`04-snapshot.md`): its publishes validate against the frozen schema, so it may
  still commit a revision the live one refuses, and the next change to the kind then stops on that
  revision. A revision staged before the apply and committed after it is the same case. The
  definition is found by name, so a renamed kind or version is the same change and refused; a new
  `names.plural` is a new name owning the same kind, refused by the kind it owns, else the prior
  would be missed and the schema swapped unchecked. Two UATs in one week moved to a fresh project because the AI Native pack
  changed the Design kind (`32-ui-design-process.md`). Found in UAT.
- `validate` copies the project's committed revisions into its throwaway engine only when the batch
  holds a KindDefinition: the copy costs every artifact in the project and nothing else in the batch
  reads them. A frozen schema is compiled without its `$id`: the live compile registered it, and ajv
  refuses the same id twice. Found in audit.


## Examples

- [`examples/kind-definition-workflow.yaml`](examples/kind-definition-workflow.yaml):
  SpecMutable definition kind with handler, stepContract, no terminal
- [`examples/kind-definition-workflowrun.yaml`](examples/kind-definition-workflowrun.yaml):
  Immutable run kind with terminal and `snapshotOnCreate`
- [`examples/kind-definition-productrequirement.yaml`](examples/kind-definition-productrequirement.yaml):
  revisioned artifact kind, no handler
- [`examples/kind-definition-trigger.yaml`](examples/kind-definition-trigger.yaml):
  kind with `subscriptions`
