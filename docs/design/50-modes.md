# Local Mode and Cloud Mode

One engine library, one model, two frontends. Anything that works only in cloud mode is a
design error.

```text
                 Definition YAML (identical in both modes)
                               |
                        Engine library
   scheduler, binding resolver, CEL profile, gate logic, snapshot,
   static validator, trigger dispatcher, adapter client
                               |
                      Storage interface
        /                                              \
   Local                                              Cloud
   CLI process                                        API server + controller(s)
   SQLite file (.persimmon/persimmon.db)              Postgres
   blobs in .persimmon/blobs/                         object storage
   adapters: stdio subprocesses                       adapters: stdio in sandboxes or http
   human: CLI prompt / file drop adapter              human: web or chat adapter
   single namespace `default`                         multi-tenant namespaces, RBAC
   events: in-process outbox poller                   events: outbox poller per controller
```

## Storage interface

```text
ResourceStore
  put(resource) -> resource            CAS on resourceVersion; assigns uid/generation
  get(kind, namespace, name)
  list(kind, namespace, labelSelector?)
  delete(kind, namespace, name)        refused while referenced (design doc rule)

RunLog
  append(runRef, event) -> seq          idempotent on (runRef, dedupeKey)
  read(runRef, fromSeq?)
  listOpenRuns()

SnapshotStore
  put(bytes) -> {uri, digest}
  get(uri) -> bytes                     digest verified by caller

BlobStore
  put(bytes, mediaType) -> {uri, digest}
  get(uri) -> bytes                     representations of revisioned kinds

Outbox
  enqueue(event)                        in the same transaction as the producing write
  poll(limit) / ack(eventId)

TimerStore
  set(uid, key, at) / clear(uid, key) / due(now) -> [(uid, key)]

LeaseStore
  acquire(uid, holder, ttl) / renew / release      per-resource reconcile serialization

AuditLog
  append(actor, change)                 every spec/status write, every complete

CredentialStore
  resolve(name) -> secret               never persisted in run records or snapshots
```

Revisioned kinds (artifacts) and relations live in ResourceStore; see `30-artifact-kinds.md`
for the publish/reserve semantics layered on it. This list matches framework §11.

| Mode | CredentialStore |
|---|---|
| Local | environment variables, `.persimmon/credentials.yaml` (gitignored), or OS keychain |
| Cloud | the platform secret manager, scoped per namespace |

Local and cloud implement the same interface. Tests run the engine against both.

## Local mode

- `persimmon validate <files>`: schema plus static rules; exit code non-zero on findings.
- `persimmon apply <files>`: writes definitions into the local store.
- `persimmon adapter install <manifest.yaml>`: applies an `Adapter` resource, runs `describe`,
  marks it Ready. `persimmon adapter list` shows ids, roles, readiness.
- `persimmon run <workflow> --input k=v ...`: creates a WorkflowRun and drives it in the
  foreground; Ctrl-C leaves the run resumable.
- `persimmon resume <run>`: rebuilds state from the log and continues.
- `persimmon complete <taskRun> [--input k=v | --file result.json]`: completes a Waiting
  `human` attempt as the local user; the `cli-prompt/v1` adapter is a thin wrapper over it.
- `persimmon get / describe / logs`: read status and run history.

Crash safety is required: state is checkpointed after every event; resume is exact.

## Cloud mode

- API server exposes the resource kinds with the k8s-style envelope; user writes `spec`,
  controllers write `status`.
- Controllers claim open runs with leases; more than one controller may run.
- Adapters run either as sandboxed subprocesses inside worker pods (stdio) or as remote
  services (http).
- Approval actors come from the authenticated adapter channel.

## Invariants across modes

- Same schema, same static validator, same snapshot format and digest.
- Same integer artifact revisions and `artifact://` URIs; an export from local can be imported
  into cloud without rewriting refs.
- Same adapter protocol; an adapter tested locally runs unchanged in cloud.
