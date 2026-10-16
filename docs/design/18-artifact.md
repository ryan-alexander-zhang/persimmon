# Artifact, Relation, RelationType

status: active · layer: 1 · schema: [`schemas/relation.yaml`](schemas/relation.yaml) (Relation, RelationType; the artifact instance is `schemas/revisioned.yaml`)

An Artifact is a Resource of an artifact kind (`05-revisioned-kind.md`). Layer 1 adds how
artifact kinds are registered, how Relations connect revisions, and what is retained.

```text
KindDefinition {revisioned: true, schema} ──▶ artifact kind ──▶ Artifact revisions  <id>.r1, <id>.r2, …
                                                                       ▲        ▲
Relation {type, from, to, evidence[]} ─────────── RelationType ────────┴────────┘   immutable assertion between endpoints
```

## Artifact kind

A KindDefinition with `revisioned: true` (`01-kind-definition.md`). Nothing else to register.

| Producer | How |
|---|---|
| a Task output port `{kind: artifact, artifactKind}` | the Adapter publishes into the attempt's Publication scope; `task` Handler commits (`17-runs.md`) |
| a Handler | `publishArtifact` action, staged to the reconcile (`03-reconcile.md`) |
| a human | the human Adapter sends content in the `signal` body; the `task` Handler publishes it (`19-adapter-roles.md`) |
| a user | `persimmon create` of a revision, or `persimmon run --input <port>=@file` on an `artifact` port; stamped by the engine (`05-revisioned-kind.md`) |

Storage: canonical content in the ResourceStore, representations in the BlobStore
(`08-store.md`). Git is an export target, never the source of truth.

Representations: the content as JSON, named `json`, on every revision an Adapter publishes; and
every file an agent leaves under `<files>/<port>/` in its workspace (`19-adapter-roles.md`), named by
its stem, typed by its extension. `persimmon get <Kind>/<name> --files <dir>` writes them out as
`<name>.<ext>`; the UI does not serve them yet (`91-roadmap.md`).

## RelationType

An Immutable Definition kind, `scope: Any`, `snapshot: Definition`, no handler.

| Field | Rule |
|---|---|
| `from[]`, `to[]` | one or more endpoint kinds: `{revisionKind: {apiVersion, kind}}` (`x-persimmon-kind-ref`) or `{external: true}` |
| `description` | text |

## Relation

An Immutable Namespaced kind, `snapshot: None`, no handler.

| Field | Writer | Rule |
|---|---|---|
| `spec.type` | asserter | LocalDefinitionRef to a RelationType (`x-persimmon-ref`) |
| `spec.from`, `spec.to` | asserter | Endpoint: `{revision: RevisionRef}` \| `{external: ExternalResourceRef}`; kinds ∈ the RelationType's lists |
| `spec.evidence[]` | asserter | RevisionRefs; required, may be empty |
| `metadata.labels` | engine | `persimmon.ai/type`: the RelationType name; `persimmon.ai/from`, `persimmon.ai/to`: `sha256:` of the canonically encoded bare ref (`04-snapshot.md`) |

| Asserter | How |
|---|---|
| user or API | `persimmon create`; the Actor is in the audit record |
| a Handler | `createResource(owned: false)`, name `<type>-<first 12 hex of sha256(from label + to label)>`; an equal Relation twice is a no-op |
| an Adapter | none in v1 |

Query: `list` by the three labels, from the CLI, the API, or the `list` Engine callback
(`07-adapter.md`).

## Retention

| Rule | Enforcer |
|---|---|
| a revision referenced by a run, a Relation, a snapshot, or another revision's `provenance.inputs` is retained | `00-resource.md` delete rule |
| deletion of unreferenced revisions is a policy outside v1 | `91-roadmap.md` |
| a RevisionRef to a deleted or abandoned revision fails the read | `05-revisioned-kind.md` |

## Rules

| Rule | Enforcer |
|---|---|
| endpoint kinds ∈ RelationType `from` / `to` | static checker (write path) |
| endpoints and `evidence` are committed, or committed by the same transaction | write path |
| RelationType `revisionKind`s and `spec.type` resolve | `x-persimmon-kind-ref`, `x-persimmon-ref` |
| Relation `spec` immutable | KindDefinition |

## Decisions

- No separate ArtifactStore or RelationStore: artifacts and Relations are Resources; queries
  are `list` with engine-stamped labels. Reference had two stores.
- New Engine callback `list(kind, namespace, labels)` (`07-adapter.md`), so a pack traceability
  Validator can read Relations.
- `assertedBy` dropped; the audit record of the create carries the Actor. Reference had it
  as a field.
- The engine writes labels under the reserved `persimmon.ai/` prefix (`00-resource.md`).
- Endpoints are `revision` or `external`; `EntityRef` dropped with entity indexing
  (`91-roadmap.md`).
- Builtin Handlers assert no Relations in v1; pack kinds and users do.
- Artifact kinds and RelationTypes beyond the examples are pack content (`20-pack.md`).
- No artifact scope (internal versus exported); Workflow output contracts encapsulate, and
  every revision stays addressable for audit (reference roadmap; kept out).
- A file the agent draws beside an output is a representation of the revision, not a path in
  its content. `examples/example02` had the agent write `reports/test-report.html` into the
  workspace and the TestReport hold the path: unversioned, undigested, overwritten by the next
  run. Now the agent runner names a fresh directory in the workspace, reads `<files>/<port>/`
  after the answer and puts each file as a blob beside the content's `json`; the revision pins
  them by digest, and `get --files` writes the exact bytes of the revision under review.
  The name is the file's stem made a DNS label, the media type from a short extension table
  (unknown: `application/octet-stream`), one flat directory per port, 8 MiB per file; a nested
  directory or a dotfile is not read, the former logged. Proven live on `claude-sonnet-5`: an Adr published with `json`, `adr`
  (`text/html`, 2544 bytes) and `decision` (`text/vnd.mermaid`), exported as `adr.html` and
  `decision.mmd`, the files directory gone from the workspace. Found in UAT.

## Examples

- [`examples/kind-definition-researchreport.yaml`](examples/kind-definition-researchreport.yaml):
  the artifact kind consumed by `write-prd`; frozen in `snapshot-closure.yaml`
- [`examples/kind-definition-relation.yaml`](examples/kind-definition-relation.yaml): Relation
  KindDefinition
- [`examples/relation-type-derived-from.yaml`](examples/relation-type-derived-from.yaml):
  RelationType with a revision kind and an external endpoint; validates against `#/$defs/RelationType`
- [`examples/relation-prd-derived-from.yaml`](examples/relation-prd-derived-from.yaml): PRD
  revision derived from a ResearchReport revision, asserted by a user; validates against `#/$defs/Relation`
- committed revision: [`examples/revisioned-instance.yaml`](examples/revisioned-instance.yaml)
