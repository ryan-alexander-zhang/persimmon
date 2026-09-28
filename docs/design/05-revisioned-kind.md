# Revisioned kind

status: active · layer: 0 · schema: [`schemas/revisioned.yaml`](schemas/revisioned.yaml)

`revisioned: true` makes a kind an append-only series of immutable revisions under one id.

```text
callAdapter(execute, idempotencyKey: K) ─▶ adapter ─putBlob(bytes)─▶ blob://<digest>
                                                   ─publishArtifact(call token)─▶ staged in Publication scope (uid, K); revision 3 reserved; returns RevisionRef
Handler reconcile ─ publishArtifact action ──────────────────────▶ staged to this reconcile
                                                                               │
                 commitScope(K) / reconcile commits ─▶ visible: RevisionRef {id, revision: 3} resolves; artifact.published; audit create
                 abandonScope(K) / owner terminal   ─▶ retained, unreadable, revision 3 is a gap
```

## Shape

Framework adds to every Resource of the kind; the kind is `Immutable`, `Namespaced`,
`snapshot: None`, and declares no `statusSchema` (`01-kind-definition.md`).

| Field | Writer | Rule |
|---|---|---|
| `metadata.name` | engine | `<id>.r<revision>` |
| `spec.identity` | engine | `{id, revision ≥ 1}`; `id` is a DNS label from the publisher; revision reserved at staging |
| `spec.content` | publisher | validated by the kind's `schema` frozen in the caller's snapshot; live registration when the caller has none |
| `spec.provenance` | engine | `{producerRef, inputs: [RevisionRef], actor}`; `producerRef` is the Resource owning the reconcile or Publication scope, or the revision itself when written by hand (`persimmon create`); `actor` is `context.actor` of the committing reconcile, else the owning Handler's `handler` Actor |
| `status.contentDigest` | engine | `sha256:` over canonically encoded `content` (`04-snapshot.md` encoding) |
| `status.representations[]` | engine | `{name, mediaType, digest}`; bytes in BlobStore at `blob://<digest hex>` |

`spec` and `status` are immutable after commit.

## Publish

| Field | Rule |
|---|---|
| `kind` | `{apiVersion, kind}` of a registered revisioned kind |
| `id` | DNS label; new or existing identity |
| `content` | object |
| `inputs[]` | RevisionRefs the content was derived from; become `provenance.inputs` |
| `representations[]` | `{name, mediaType, digest}`; every `digest` already in BlobStore via `putBlob` |

Returns the reserved RevisionRef at staging time.

| Path | Staged to | Reservation | Visible when |
|---|---|---|---|
| `publishArtifact` action in a reconcile | that reconcile | inside the reconcile transaction; rolls back with it | the reconcile commits |
| engine callback with a reconcile token (`07-adapter.md`) | that reconcile | same | same |
| engine callback with a call token | Publication scope `(owner uid, idempotencyKey)` | own store write; persists | owning Handler issues `commitScope(key)` |

The owning Handler sees uncommitted refs in `context.staged[]` (`02-handler.md`). Abandon:
`abandonScope(key)`, or the owner reaching a terminal value (`03-reconcile.md`). Abandoned
revisions are retained flagged, excluded from get and list, and leave a gap.

## Rules

| Rule | Enforcer |
|---|---|
| revision unique per `(kind, namespace, id)`; gaps allowed, reuse never | store reservation |
| `content` validated and every representation digest present before staging | engine |
| `provenance` never supplied by the publisher beyond `inputs` | engine strips and re-stamps |
| read of an abandoned or deleted revision fails; no fallback | RevisionRef resolution |
| delete per `00-resource.md`; listing revisions per `08-store.md` | store |
| commit writes one audit record `change: create` and emits `artifact.published` once | engine, committing transaction |

## Decisions

- `metadata.name` is `<id>.r<revision>`; the envelope needs a name and the reference gave none.
- `id` is required and a DNS label. Reference wrote `id?`; a generated id is not replayable
  across redelivery.
- Publish carries `inputs[]`, the source of `provenance.inputs`. Reference had no source.
- Representations are content-addressed blobs, `blob://<digest>`, uploaded by a `putBlob`
  callback before publish. Reference used `artifact://<ns>/<id>/<rev>/<name>` and left the
  upload path open. `CONTEXT.md` and `07-adapter.md` carry the callback.
- Engine-originated commits stamp the owning Handler's `handler` Actor. Reference left the
  adapter path without an Actor.
- Revisioned kinds are `Namespaced` with `snapshot: None`; the schema is frozen through
  `x-persimmon-kind-ref` (`04-snapshot.md`), not by making revisions closure members.
  Recorded in `01-kind-definition.md`.
- Engine supplies the status schema for revisioned kinds; `versions[].statusSchema` is
  forbidden on them.
- A revision written through the API (`persimmon create spec.yaml`) is stamped like a published
  one: `spec.identity.revision` must be the next number for its id (checked with
  `reserveRevision`, rolled back on error), `provenance` defaults to the revision as its own
  producer with the writer as actor, `status.contentDigest` is computed, `artifact.published` is
  emitted so Triggers fire. Re-creating the same content is idempotent; provenance is not
  compared. Found in UAT.

## Examples

- [`examples/revisioned-instance.yaml`](examples/revisioned-instance.yaml): a committed
  ProductRequirement revision; validates against `#/$defs/Instance`
- [`examples/revisioned-publish-flow.yaml`](examples/revisioned-publish-flow.yaml):
  staging, commit and abandon across two attempts; validates against `#/$defs/Flow`
