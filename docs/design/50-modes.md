# Local Mode and Server Mode

One binary, one model, two ways to run it. Local: the CLI runs the engine in-process on a
developer's machine. Server: the same engine runs as a long-lived daemon on a machine you
operate, and clients (the same CLI, an API client, a UI) talk to it over HTTP. Server mode is
not Kubernetes and not a hosted service; Kubernetes is only an analogy for the resource model.
Anything that works only in server mode is a design error.

```text
                 Definition YAML (identical in both modes)
                               |
                        Engine library
   framework (05): store, reconcile loop, snapshot, outbox, adapter client
   + built-in handlers (10/20/30)
                               |
                      Storage interface
        /                                              \
   Local                                              Server
   `persimmon` CLI, engine in-process                 `persimmon serve` daemon; CLI/API/UI over HTTP
   starts per command, exits after                    always on
   SQLite file (.persimmon/persimmon.db)              Postgres (SQLite acceptable on one machine)
   blobs in .persimmon/blobs/                         object storage or a directory on the server
   adapters: stdio subprocesses                       adapters: stdio subprocesses on the server, or http elsewhere
   human: CLI prompt / file drop adapter              human: web, chat or email adapter
   one user, namespace `default`                      many users, namespaces, authorization
   events: in-process outbox poller                   events: outbox poller in the daemon
   one process                                        one or more daemon processes sharing one database (leases)
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
| Server | a secret manager or an encrypted file on the server, scoped per namespace |

Local and server implement the same interface. Tests run the engine against both.

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

## Server mode

- `persimmon serve` starts the daemon: HTTP API for all resource kinds (users write `spec`,
  handlers write `status`), the reconcile loop, the outbox poller, timers.
- The CLI gains `--server <url>`; every local command works unchanged against a server.
- More than one daemon may share one database; per-resource leases serialize reconciles.
- Adapters run as subprocesses on the server host (stdio) or as services on other hosts (http).
- Authentication is required; actors come from the authenticated channel.

## Invariants across modes

- Same schema, same static validator, same snapshot format and digest.
- Same integer artifact revisions and `artifact://` URIs; an export from local can be imported
  into a server without rewriting refs.
- Same adapter protocol; an adapter tested locally runs unchanged on a server.
