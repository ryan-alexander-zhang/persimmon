# Layer 0: Framework

The kind-agnostic resource runtime. Nothing in this document names a business kind.

## 1. Resource envelope

Every stored object:

```yaml
apiVersion: <group>/<version>       # e.g. persimmon.ai/v1, acme.example/v1
kind: <Kind>
metadata:
  name: <dns-label>                 # unique per (kind, namespace) or per kind if cluster-scoped
  namespace: <dns-label>            # absent for cluster-scoped kinds
  uid: <engine>                     # identity of this object instance
  resourceVersion: <engine>         # optimistic concurrency token; never ordered
  generation: <engine>              # increments on spec change
  creationTimestamp: <engine>
  labels: {string: string}
  annotations: {string: string}
  ownerReferences: [ObjectRef]      # set by the engine on children created via actions
spec: {}                            # written by users (or by handlers via createResource)
status: {}                          # written only by the owning handler
```

Framework guarantees: `spec` and `status` have separate write paths; `uid` never reused;
delete refused while any persistent reference to the object exists; every write appends an
audit record `{actor, time, kind, name, uid, generation, change}`.

## 2. KindDefinition

Registers a kind. Kinds Persimmon ships and kinds users add use the same object.

```yaml
apiVersion: persimmon.ai/v1
kind: KindDefinition
metadata: {name: workflows.persimmon.ai}          # cluster-scoped
spec:
  group: persimmon.ai
  names: {kind: Workflow, plural: workflows}
  scope: Namespaced | Cluster
  versions:
    - name: v1
      schema: <JSON Schema 2020-12>                # validates spec
      statusSchema: <JSON Schema 2020-12>          # validates status
  mutability: SpecMutable | Immutable              # Immutable: spec frozen after create
  revisioned: false                                # true: see §8 (artifact-style kinds)
  snapshot: Definition | None                      # Definition: included in snapshot closures
  handlerRef: {name: <Handler>}                    # who gives instances behaviour
  stepContract:                                    # optional: instances can be used as steps
    inputsPath: spec.inputs                        #   typed input ports (map of InputSpec)
    outputsPath: spec.outputs                      #   typed output ports (map of OutputSpec)
    runKind: {group: ..., kind: ...}               #   resource created per invocation
    phasePath: status.phase                        #   Pending|Running|Waiting|Succeeded|Failed|Cancelled
    outputsValuePath: status.outputs               #   RuntimeValue map on success
    errorPath: status.error                        #   Error on Failed
```

`stepContract` is how a composing kind (a Workflow today, a Pipeline tomorrow) uses another
kind as a step without knowing what it is: create an instance of `runKind` with bound inputs,
wait for `ChildFinished`, read phase and outputs by path. Task, Workflow and Gate declare it
like any user kind; there is no closed list of step kinds anywhere in the engine.

Schema annotations the framework understands inside `schema`:

| Annotation | Meaning |
|---|---|
| `x-persimmon-ref: {kinds: [..]}` | Field is a `LocalDefinitionRef`; framework validates existence and follows it when building snapshot closures |
| `x-persimmon-entity: {kind, idField}` | Object is an addressable entity inside a revisioned resource (see §8) |

Validation order on write: envelope → KindDefinition schema → handler `validate` hook →
store. Rules the schema cannot express (graph shape, cross-field) live in the handler's
`validate`.

Kind versions: a new `versions[]` entry is a new schema; the framework performs no conversion.
Objects keep the version they were written in. Handlers declare which versions they accept.

## 3. Handler

Binds kinds to behaviour.

```yaml
apiVersion: persimmon.ai/v1
kind: Handler
metadata: {name: workflow-controller}               # cluster-scoped
spec:
  kinds: [{group: persimmon.ai, kind: Workflow, versions: [v1]}]
  implementation:                                   # exactly one
    builtin: workflow                               #   engine-internal (Layer 1 kinds)
    adapter: {id: acme-rollout/v1, transport: stdio | http}   # out of process, role: handler
    workflowRef: {namespace: ..., name: ...}        #   declarative: run this Workflow per reconcile
  events: [Created, SpecUpdated, ChildFinished, TimerFired, Signal, CancelRequested]
```

Handler contract (identical for all three implementations; §4 describes how the engine
drives it):

```text
validate(resource) -> findings[]                       admission hook, pure
reconcile(resource, event, context) -> {statusPatch, actions[]}
```

`context` carries: the resource's children summary, the snapshot (if any), the actor of the
triggering event, and a monotonically increasing `sequence` for idempotency.

Handlers are stateless between calls. Everything they need to remember goes in `status` or
in child resources. The engine may call `reconcile` more than once for the same event; the
handler must produce the same result.

## 4. Reconcile loop

```text
event arrives (RunLog append)
  └─ dispatcher picks the owning Handler for (kind, version)
       └─ acquires the per-resource lease
            └─ reconcile(resource, event, context)
                 └─ engine applies {statusPatch, actions[]} + emitted events
                    in ONE store transaction, keyed by (uid, event.sequence)
```

Events the framework produces:

| Event | When |
|---|---|
| Created | resource stored |
| SpecUpdated | spec changed on a SpecMutable kind |
| ChildFinished | a child (ownerReference) reached a terminal status |
| TimerFired | a timer set by this resource's handler elapsed |
| Signal | external completion delivered through an adapter (`complete`) or the API |
| CancelRequested | user or parent asked to cancel |
| AdapterFinished | a `callAdapter` action returned or failed |

Delivery: at-least-once, in per-resource order. Duplicate `(uid, sequence)` applications are
no-ops. Handler error → retry with backoff; after `maxReconcileAttempts` the resource status
gets condition `Stalled` and an operator event is emitted.

## 5. Actions

The only way a handler changes the world.

| Action | Effect |
|---|---|
| `patchStatus(patch)` | merge into `status`; validated against `statusSchema` |
| `createResource(resource)` | store a child with `ownerReferences` = this resource |
| `cancelResource(ref)` | deliver CancelRequested to a child |
| `publishArtifact(kind, id?, content, representations[])` | see §8; staged until this reconcile commits |
| `emitEvent(type, payload)` | append to the outbox (§6) |
| `setTimer(key, at)` / `clearTimer(key)` | schedule TimerFired |
| `callAdapter(adapterRef, op, payload, idempotencyKey)` | invoke an executor/evaluator adapter; result returns as AdapterFinished |

All actions of one reconcile commit atomically with the status patch. A failed commit
discards everything and the event is redelivered.

## 6. Events and subscriptions

The outbox is the framework's event bus, stored in the same database as resources. Event
types are open strings; the framework emits `resource.created`, `resource.statusChanged`,
`artifact.published`, `timer.fired`; handlers may emit their own.

A kind may subscribe: `KindDefinition.spec.subscriptions: [{eventType, filter}]`. Matching
events are delivered to every instance's handler as `Signal` with the event as payload. This
is how a Layer 1 `Trigger` kind works without the framework knowing what a trigger is.

Delivery guarantees: at-least-once, idempotent on `eventId`; consumers dedupe on it.
Loop guard: an event carries `causationChain: [eventId...]`; the framework refuses to deliver
when the chain length exceeds `maxCausationDepth` (default 32) and emits `event.suppressed`.

## 7. References and snapshots

Reference types the framework validates:

| Ref | Shape | Rule |
|---|---|---|
| ObjectRef | apiVersion, kind, namespace?, name, uid? | must exist at write time; delete of the target refused while referenced |
| LocalDefinitionRef | kind, name | resolves in the writer's namespace, then cluster scope |
| RevisionRef | apiVersion, kind, namespace, id, revision | for revisioned kinds; revision mandatory |
| ExternalResourceRef | provider, type, id, locator, version?, url? | opaque to the framework |

Snapshot: for any resource whose handler asks (`context.snapshot` requested via
`createResource` with `snapshot: true`), the framework walks `x-persimmon-ref` fields
transitively over kinds marked `snapshot: Definition`, serializes the closure canonically
(JSON, sorted keys, UTF-8, no insignificant whitespace), stores the bytes, and records
`{uri, digest: sha256}` on the new resource. The digest is verified on every read. A child
created by a snapshotted resource inherits the same snapshot unless the handler asks for a new
one. Missing or mismatched snapshot bytes fail the read; there is no fallback to live definitions.

## 8. Revisioned kinds

`revisioned: true` turns a kind into an append-only series of immutable revisions with a
stable logical identity. This is how artifacts work; the framework does not call them that.

Framework adds to every instance:

```yaml
spec:
  identity: {id: <string>, revision: <int ≥ 1>}    # engine assigns/reserves revision
  content: {}                                      # validated by the kind's schema
  provenance:
    producerRef: ObjectRef?                        # the resource whose action published it
    inputs: [RevisionRef]
    actor: Actor?                                  # engine-set from the publishing actor
status:
  contentDigest: sha256
  representations: [{name, uri, mediaType, digest}]
```

Rules: revision uniqueness enforced by the store; gaps allowed, reuse never; `content` and
`provenance` immutable after publish; `x-persimmon-entity` ids unique within a revision.
Publication is staged to the publishing reconcile and becomes visible only when it commits.
Read of a deleted revision fails; no fallback.

## 9. Actor and authorization

`Actor = {kind: user | service | handler, id, display?}`. Every API write and every adapter
`complete` carries an Actor from the authenticated channel. The framework records it in the
audit log and passes it to handlers in `context.actor`. Handlers write `status` under their
own service Actor; they cannot impersonate users. Authorization policy (who may write which
kinds in which namespace) is a framework concern; it is enforced before validation.

## 10. Adapters

Out-of-process code the engine talks to through `persimmon.adapter/v1` (see
`40-plugin-protocol.md`). Roles: `executor`, `evaluator`, `handler`, `eventSource`. The
framework knows the protocol and the transport; it does not know what any adapter does.
Credentials are resolved by the framework's CredentialStore and injected per call.

Adapters are registered as resources so an adapter id resolves to something runnable:

```yaml
apiVersion: persimmon.ai/v1
kind: Adapter                                   # cluster-scoped
metadata: {name: acme-canary-v1}
spec:
  id: acme-canary/v1                            # referenced by Executor.spec.adapter,
                                                #   Handler.spec.implementation.adapter.id,
                                                #   Validator evaluator type
  roles: [handler]                              # subset of executor | evaluator | handler | eventSource
  transport: stdio | http
  command: [python3, /opt/persimmon/adapters/canary_handler.py]   # stdio
  url: https://adapters.acme.example/canary                       # http
  env: {string: string}                         # non-secret process environment (stdio)
  credentialBindings: [string]                  # secrets injected into the process env (stdio)
status:
  describe: {...}                               # cached result of the last describe call
  conditions: [{type: Ready, ...}]
```

On `apply` the framework runs `describe`, checks that `spec.roles` ⊆ the adapter's reported
roles, stores the result in `status.describe`, and sets `Ready`. Every reference to an adapter
id is validated against the registry at admission; snapshot closures record the adapter id and
the `describe` digest so a run can prove which adapter version it was validated against.
Local mode: `persimmon adapter install <manifest.yaml>` is `apply` for this kind.

## 11. Storage interface

One interface, two implementations (see `50-modes.md`):

```text
ResourceStore   put/get/list/delete with CAS; revision reservation for revisioned kinds
RunLog          append(uid, event) idempotent on (uid, dedupeKey); read; listOpen
SnapshotStore   put(bytes) -> {uri, digest}; get(uri)
BlobStore       put(bytes, mediaType) -> {uri, digest}; get(uri)
Outbox          enqueue in-transaction; poll; ack
TimerStore      set/clear/due
CredentialStore resolve(name) -> secret
AuditLog        append(actor, change)
LeaseStore      acquire(uid, holder, ttl) / renew / release
```

## 12. Lifecycle and deletion

Delete is refused while `ownerReferences`, `ObjectRef`s in stored resources, snapshots or
`RevisionRef`s point at the object. There is no cascading delete and no garbage collection in
this version. Cancellation is a `CancelRequested` event; the handler decides what it means.

## 13. What the framework does not do

Interpret `spec` of any kind. Schedule "steps". Know about gates, humans, agents, models.
Convert between kind versions. Retry business operations. Collect garbage. Each of these is a
handler's job or a later roadmap item.
