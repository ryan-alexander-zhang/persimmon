# Layer 1: Artifact Kinds

Versioned facts produced by runs. Independent of any workflow's lifetime.

An artifact kind is a `KindDefinition` with `revisioned: true` (framework §8). The framework
supplies identity, revision, provenance, digest and representations; the KindDefinition's
`schema` validates `spec.content`. The baseline's `ArtifactSchema` kind is retired; its
`contentSchema` is that schema (decision 27).

```yaml
apiVersion: persimmon.ai/v1
kind: KindDefinition
metadata: {name: researchreports.demo.ai}
spec:
  group: demo.ai
  names: {kind: ResearchReport, plural: researchreports}
  scope: Namespaced
  revisioned: true
  mutability: Immutable
  snapshot: Definition            # the schema is part of any snapshot that references the kind
  versions:
    - name: v1
      schema: {type: object, properties: {...}, required: [...]}   # validates spec.content
```

## Objects

- Artifact instance: `spec.identity {id, revision}`, `spec.content`, `spec.provenance
  {producerRef?, inputs[], actor?}`, `status.representations[]`, `status.contentDigest`.
  `provenance.actor` is engine-set from the publishing Actor; a publisher cannot supply it.
- Relation: immutable assertion between two endpoints (ArtifactRef, EntityRef,
  ExternalResourceRef) typed by a RelationType, with `evidence[]` and `assertedBy`.

Identity, revision, entity and reference rules are unchanged (see `docs/reference/10`, `60`).

## Storage

Canonical content is the schema-validated structured object, stored by the engine.
Representations (Markdown, HTML, bundles) are bytes in a blob store, referenced by URI and
digest. Git is an optional export target, never the source of truth.

```text
ArtifactStore
  publish(kind, id?, content, provenance, representations[]) -> ArtifactRef
      validates content against the revisioned KindDefinition's schema
      reserves the next revision (gaps allowed, never reuse)
      writes content + contentDigest atomically
      emits artifactPublished event to the outbox
  get(ArtifactRef) -> DomainArtifact          permission-checked
  listRevisions(kind, id) -> [revision...]
  putRepresentation(ArtifactRef, name, bytes, mediaType) -> Representation
  getRepresentation(ArtifactRef, name) -> bytes

RelationStore
  assert(Relation) -> ObjectRef               validates endpoint types against RelationType
  query(endpoint, predicate?, direction) -> [Relation]
```

| Mode | Canonical store | Blob store |
|---|---|---|
| Local | SQLite table, JSON column | `.persimmon/blobs/<sha256>` |
| Cloud | Postgres, JSONB | Object storage bucket |

Both modes use the same integer revision and the same `artifact://<namespace>/<id>/<revision>/<name>`
URI scheme for representations, so refs are portable between modes.

## Publication protocol

Adapters never write the store directly. During an attempt the adapter calls the engine's
`publishArtifact` operation (see `40-plugin-protocol.md`). The engine validates, reserves the
revision and stages the artifact against the attempt. When the attempt commits, staged
artifacts become visible and the `artifactPublished` event is emitted. When the attempt fails,
staged artifacts are retained for audit under the failed TaskRun but are not visible as
published revisions and are not referenced by workflow outputs.

## Retention

Any artifact revision referenced by a Run, Relation, snapshot or another artifact's
provenance is retained. Deletion of unreferenced revisions is a policy decision outside this
design. An ArtifactRef that resolves to deleted content fails the read; there is no fallback
to another revision.

## Deferred

Entity indexing (`x-persimmon-entity`), the SDLC relation types and the 14 SDLC artifact kinds
are next-phase work. This layer only needs to store them; nothing here depends on their shape.
