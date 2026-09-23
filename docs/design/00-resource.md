# Resource

status: draft · layer: 0 · schema: [`schemas/resource.yaml`](schemas/resource.yaml)

Every stored Resource has one envelope and three write paths.

```text
 user ──── apply / createResource ────▶ spec      ┐
 Handler ─ patchStatus ───────────────▶ status    ├─ Resource {apiVersion, kind, metadata, spec, status}
 engine ─────────────────────────────▶ metadata  ┘
                                          │
                                          ▼ every write
             AuditLog {actor, time, kind, namespace?, name, uid, generation, change}
```

## Envelope

Closed: no top-level key beyond the five, no `metadata` key beyond the table.

| Field | Writer | Rule |
|---|---|---|
| `apiVersion` | user | `<group>/v<n>`; group is a DNS subdomain |
| `kind` | user | PascalCase; registered by a KindDefinition |
| `metadata.name` | user | DNS subdomain, ≤ 253 (`workflows.persimmon.ai`); unique per (kind, namespace), or per kind when Global |
| `metadata.namespace` | user | DNS label, ≤ 63; required for Namespaced kinds, absent for Global |
| `metadata.labels`, `annotations` | user | string maps; keys under `persimmon.ai/` are engine-written |
| `metadata.uid` | engine | never reused |
| `metadata.resourceVersion` | engine | CAS token; never ordered |
| `metadata.generation` | engine | starts at 1; +1 per `spec` change |
| `metadata.creationTimestamp` | engine | RFC 3339 |
| `metadata.ownerReferences` | engine | at most one; set on children made by `createResource` |
| `metadata.snapshot` | engine | `{uri: snapshot://<digest hex>, digest: sha256:<64 hex>}`; see `04-snapshot.md` |
| `metadata.stalled` | engine | `{attempts, lastError?}`; see `03-reconcile.md` |
| `spec` | user or `createResource` | required, may be `{}`; validated by the kind's `schema` |
| `status` | owning Handler | validated by `statusSchema`; engine-set fields of revisioned kinds excepted (`05-revisioned-kind.md`) |

The engine never writes `status` and reads one field of it: the kind's `terminal.path`.
The write path, not the schema, rejects a user-supplied `status` or a Global name with a
namespace.

## Scope

`Namespaced` kinds live in a Namespace. `Global` kinds have none: KindDefinition, Handler,
Adapter, pack definitions, any kind declaring `scope: Global`. Writing a Global kind needs the
`admin` grant (`08-store.md`). A Namespaced name shadows a Global name on LocalDefinitionRef
resolution.

## Actor

`{kind: user | service | handler, id, display?}` from the authenticated channel. Every API
write and every adapter `complete` carries one. The engine records it in the AuditLog and
hands it to `reconcile` as `context.actor`. Handlers write `status` as their own `handler`
Actor; `service` is any other non-human channel. No impersonation.

## References

| Ref | Shape | Rule |
|---|---|---|
| ObjectRef | `apiVersion, kind, namespace?, name, uid?` | target exists at write; target delete refused while referenced |
| LocalDefinitionRef | `kind, name` | writer's Namespace first, then Global |
| RevisionRef | `apiVersion, kind, namespace, id, revision` | revisioned kinds only; `revision` mandatory |
| ExternalResourceRef | `provider, type, id, locator, version?, url?` | `locator` is an object; otherwise opaque to the engine |

A schema field annotated `x-persimmon-ref: {kinds: [...]}` is a LocalDefinitionRef the
engine validates and follows for snapshots.

## Write order

```text
authorization ─▶ envelope ─▶ KindDefinition schema ─▶ Handler validate ─▶ store + audit
```

Authorization: `08-store.md`. Handler `validate` holds rules the schema cannot express: graph
shape, cross-field. Fail at any stage: nothing stored.

## Audit

One record per write and per external Signal, appended in the same transaction.

| Field | Rule |
|---|---|
| `actor` | Actor of the write |
| `time` | RFC 3339 |
| `kind`, `namespace?`, `name`, `uid` | the Resource |
| `generation` | after the write |
| `change` | `create` \| `spec` \| `status` \| `metadata` \| `delete` \| `signal` |

## Lifecycle

Delete is refused while any `ownerReferences`, ObjectRef, snapshot or RevisionRef points at
the Resource. No cascade, no garbage collection. Cancel is a `CancelRequested` Event; the
Handler decides what it means (`03-reconcile.md`).

## Decisions

Deviations from `docs/reference/05-framework.md`, taken here:

- `metadata.name` is a DNS subdomain, not a label: KindDefinition names carry dots.
  `namespace` stays a label.
- Envelope and `metadata` are closed sets.
- `apiVersion` grammar is `v<n>` only; no alpha or beta.
- Audit record gains `namespace` and a closed `change` set with `metadata` for engine-only
  writes and `signal` for external Signals.
- Handlers act as Actor kind `handler`; reference said `service`.
- One `ownerReference` at most.

## Examples

- [`examples/resource-namespaced.yaml`](examples/resource-namespaced.yaml): root WorkflowRun
  with snapshot
- [`examples/resource-child.yaml`](examples/resource-child.yaml): TaskRun child with
  `ownerReferences` and `stalled`
- [`examples/resource-global.yaml`](examples/resource-global.yaml): Global KindDefinition,
  dotted name
- [`examples/resource-refs.yaml`](examples/resource-refs.yaml): all four Reference shapes;
  validates per `#/$defs/<Name>`, not the root
- [`examples/resource-audit.yaml`](examples/resource-audit.yaml): one audit record;
  validates against `#/$defs/AuditRecord`
