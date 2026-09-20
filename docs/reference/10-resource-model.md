# Resource Model (design doc §1–4)

## Three planes

- Control plane: Workflow, Step, Transition, Gate. How things execute.
- Execution plane: Task, Executor. What work is and what can run it.
- Knowledge plane: Artifact, Entity, Reference, Relation, Schema, Revision. What was produced and how it relates.

## Twelve core API kinds

All under `apiVersion: persimmon.ai/v1`.

| Kind | Role | Spec mutable in place? |
|---|---|---|
| Workflow | I/O contract, steps, transitions, completion | Yes; runs use the snapshot |
| Task | Work content, I/O, executor ref, retry defaults | Yes; runs use the snapshot |
| Executor | Adapter, capability and security config | Yes; runs use the snapshot |
| Validator | Definition of one fact check | Yes; runs use the snapshot |
| Gate | Aggregates ValidationResults into pass/fail | Yes; runs use the snapshot |
| ArtifactSchema | Content schema for one exact domain type version | Immutable; new type version to evolve |
| RelationType | Directed, endpoint-typed relation definition | Immutable; new name to evolve |
| Relation | Assertion between exact objects/entities | Immutable |
| WorkflowRun | One workflow invocation | Immutable |
| TaskRun | One task attempt | Immutable |
| ValidationRun | One validator execution | Immutable |
| GateRun | One gate evaluation | Immutable |

Domain artifacts are a conceptual base type (`DomainArtifact`), not a `kind: Artifact`.
Each domain type has its own `apiVersion/kind` (example group `engineering.persimmon.ai/v1`).
The schema bars domain artifacts from using `persimmon.ai/v1`.

`DefinitionSnapshot` is an archive format (`persimmon.snapshot/v1`), not an API kind.

## Envelope

`apiVersion / kind / metadata / spec`, optional controller-owned `status`.

`metadata`: `name` and `namespace` required, both DNS-label (max 63 chars,
`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`). Server-managed: `uid`, `resourceVersion`,
`generation`, `creationTimestamp`. `labels`, `annotations` are string maps.
`additionalProperties: false`; no `ownerReferences`, `finalizers`, `deletionTimestamp`.

- `resourceVersion` is an optimistic-concurrency token. Never compare for order. No history guarantee.
- `generation` counts declared-config edits. It is not an artifact revision.

## Three identity families

| Object | Identity |
|---|---|
| API resource | apiVersion, kind, namespace, name; `uid` names the instance |
| Domain artifact (logical) | apiVersion, kind, namespace, `spec.identity.id` |
| Domain artifact (immutable revision) | logical identity + `spec.identity.revision` |
| Entity | exact ArtifactRef + `entityKind` + entity id |
| External resource | provider, type, native id, locator context |

PRD revision 1 and revision 2 are two API objects (`prd-demo-r1`, `prd-demo-r2`) with the same
`identity.id`. Each revision's `spec` is immutable once published.

Revision is a positive integer from 1. The server reserves revisions and enforces uniqueness.
Gaps are allowed; overwrite and double-binding are not. History referenced by Runs, Relations
or lineage must not be silently deleted.

Entity ids are unique within one artifact revision across all kinds and arrays. Publishers
keep ids stable across revisions; the engine can check ids and history but cannot prove
semantic sameness. Old ids are never reassigned.

## References

| Ref | Fields | Rules |
|---|---|---|
| LocalDefinitionRef | `kind`, `name` | Resolves in the current namespace under `persimmon.ai/v1`. No cross-namespace calls in v1. `Workflow/x` and `Task/x` may coexist |
| ObjectRef | apiVersion, kind, namespace, name, optional uid | For recording Run and audit links. Delete-and-recreate under the same name must not be treated as the old object |
| ArtifactRef | apiVersion, kind, namespace, id, revision | `revision` always required. No implicit latest anywhere |
| EntityRef | ArtifactRef + entityKind + id | JSONPath, array index, file path are not identities |
| ExternalResourceRef | provider, type, id, locator; optional version, url | Git source pins a full commit; a PR needs compare-and-set on expected head. URL alone is not replayable |
| SnapshotRef | uri, digest | digest = SHA-256 of the archive's exact bytes |
