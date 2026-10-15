# Snapshot

status: active · layer: 0 · schema: [`schemas/snapshot.yaml`](schemas/snapshot.yaml)

A run reads definitions from a frozen closure, never from the live store.

```text
store WorkflowRun ─▶ walk ─▶ closure ─▶ canonical JSON ─▶ sha256 ─▶ SnapshotStore ─▶ metadata.snapshot
  (snapshotOnCreate)  │                                                                    │
                      │  Workflow prd-create ─▶ Task research ─▶ Executor claude-agent ─▶ Adapter claude-code/v1
                      │                     └▶ Task write-prd ─▶ Prompt write-prd-template
                      │                                       └▶ KindDefinition ProductRequirement
                      │                                                                    │
                      └─ + KindDefinition of every member        children inherit {uri, digest} ◀┘
```

## When

| Trigger | Result |
|---|---|
| `createResource(…, snapshot: new)` | closure resolved from the child's `spec` |
| `createResource(…, snapshot: inherit)` (default) | child gets the parent's `metadata.snapshot`; parent without one fails the action |
| any other store of a `snapshotOnCreate: true` kind | closure resolved from that Resource's `spec` |

`createResource.snapshot` wins over `snapshotOnCreate`. `metadata.snapshot` is set before
Created is delivered.

## Walk

One store transaction; every hop resolves in the root Resource's Namespace, then Global.

1. Start at the root Resource's `spec`.
2. Field `x-persimmon-ref` (LocalDefinitionRef): add the target if its kind has
   `snapshot: Definition`; recurse into its `spec`.
3. Field `x-persimmon-kind-ref` (`{apiVersion, kind}`): add that KindDefinition.
4. Field `x-persimmon-adapter` (Adapter id): the Adapter must be Ready; add `{id, describeDigest}`
   with the digest recorded in its status.
5. Add the KindDefinition of every member and of every member's `stepContract.runKind`.
6. Unresolved ref: fail the create.
7. Adapter not Ready: fail the create.
8. Target of a kind with `expansion` (`01-kind-definition.md`): call its Handler's `expand`; add the
   expanded Resources as members under their own kinds and names, and the composition's
   KindDefinition; the composition itself is not a member; recurse into each expansion after all
   of them are members, so a helper (an Approval's Validator) resolves among members before the
   store, a Global member yielding to a root-Namespace definition as the store would. A reference to
   the composition kind resolves in the closure to the expansion of the same name.

## Bytes

| Rule | Value |
|---|---|
| Shape | `{version: 1, resources[], adapters[]}`; no run identity inside |
| Entry | `apiVersion, kind, metadata.{name, namespace?}, spec`; nothing else survives |
| Order | `resources` by `(apiVersion, kind, namespace or "", name)`; `adapters` by `id` |
| Encoding | JSON, keys sorted, UTF-8, no insignificant whitespace |
| Digest | `sha256:` over the bytes; `describeDigest` is the same over the encoded `describe` |
| URI | `snapshot://<digest hex>`; identical closures share one copy |

## Read

Handlers see `context.snapshot`; Adapters read through `getKindSchema` and `getResource`
against it (`07-adapter.md`). Every read re-hashes the bytes. Missing bytes or digest mismatch
fail the read. No fallback to live definitions.

## Rules

| Rule | Enforcer |
|---|---|
| members enter only through the three annotations and step 5 | walk |
| a hop never crosses into another Namespace | walk |
| `metadata.snapshot` is immutable | engine: metadata write path |
| a snapshot is deleted only when no Resource points at it | `00-resource.md` delete rule |

## Decisions

- An expansion member that collides with a member of the same kind and name but a different
  spec fails the create; an equal one is shared. `expand` errors surface as snapshot errors with
  the referencing path. Found in implementation.

- Bytes carry no run identity and no engine metadata: content-addressed, deduplicated.
  Reference serialized whole Resources.
- `uri` is `snapshot://<digest hex>`. Reference left it opaque. Sibling examples updated.
- Two new annotations, `x-persimmon-kind-ref` and `x-persimmon-adapter`, added to
  `01-kind-definition.md`. Reference reached artifact kinds and adapter digests without a
  mechanism.
- Adapter must answer `describe` at resolution and match its cached digest. Local mode
  adapters are local subprocesses, so offline still works.
- `stepContract.runKind` KindDefinitions are frozen too, so a child created mid-run validates
  against the schema the run was admitted with. The same holds for a revisioned kind whose live
  definition changed on `apply` (`01-kind-definition.md`): the run publishes under the schema it
  started with.
- Every hop resolves in the root's Namespace, so a Namespaced override of a Global pack
  definition applies through the whole closure.
- At resolution the walk checks the Adapter is Ready and records its cached `describeDigest`; it
  does not call `describe` again. Re-describing on every walk is roadmap. Found in implementation.


## Examples

- [`examples/snapshot-closure.yaml`](examples/snapshot-closure.yaml): closure of
  `prd-create` before canonical encoding
- [`examples/snapshot-new.yaml`](examples/snapshot-new.yaml): `createResource` with
  `snapshot: new` and the resulting child; the child validates against `resource.yaml`
