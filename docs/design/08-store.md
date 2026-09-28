# Store and Mode

status: active · layer: 0 · schema: [`schemas/store.yaml`](schemas/store.yaml) (engine config; the Store interface is prose)

One engine library, one Store interface, two implementations. Anything that works only in
server mode is a design error.

```text
              definition YAML, CLI verbs, adapter protocol   (identical)
                                  │
                           engine library
        reconcile · snapshot · Outbox poller · adapter client · authorization
                                  │
                           Store interface
                 ┌────────────────┴────────────────┐
              local                              server
   persimmon CLI, engine in-process     persimmon serve daemon(s), CLI/API over https
   SQLite .persimmon/persimmon.db       Postgres (SQLite on one machine)
   blobs .persimmon/blobs/<sha256>      directory or s3:// bucket
   Adapters: stdio subprocesses         stdio on the host, http elsewhere
   one Actor, defaultNamespace          many Actors, authentication, grants
   poller runs while a command runs     poller always on; claims serialize daemons
```

## Store interface

| Component | Operations | Guarantee |
|---|---|---|
| ResourceStore | `put(resource)` CAS on `resourceVersion` · `get` · `list(kind, namespace, labels?)` · `delete` · `reserveRevision` · `listRevisions` · `stage(revision, scope)` · `commitScope(uid, key)` · `abandonScope(uid, key)` · `staged(uid)` | delete refused while referenced (`00-resource.md`); abandoned revisions excluded from `get` and `list` |
| RunLog | `append(uid, event)` → sequence · `ack(uid, sequence, result)` · `read(uid, from?)` · `listOpen()` · `outstandingCalls()` | idempotent on `(uid, dedupeKey)` (`03-reconcile.md`) |
| SnapshotStore | `put(bytes)` → `{uri, digest}` · `get(uri)` | digest verified by the caller (`04-snapshot.md`) |
| BlobStore | `put(bytes, mediaType)` → `{uri, digest}` · `get(uri)` | content-addressed (`05-revisioned-kind.md`) |
| Outbox | `enqueue(event)` in-transaction · `claim(limit, holder, ttl)` · `ack(eventId)` | a claimed event is invisible to other holders until `ttl` (`06-outbox.md`) |
| TimerStore | `set(uid, key, at)` · `clear(uid, key)` · `due(now)` | same key replaces |
| LeaseStore | `acquire(uid, holder, ttl)` · `renew` · `release` | one holder per `uid` |
| TokenStore | `issue(scope, expiry?)` → token · `verify(token)` → scope · `revoke(scope)` | reconcile, call and adapter tokens (`07-adapter.md`) |
| AuditLog | `append(record)` | one record per write and per `signal` (`00-resource.md`) |
| CredentialStore | `resolve(name)` → secret | read-only for the engine; never persisted in Resources, snapshots, RunLog, logs |

Every reconcile commit is one transaction over ResourceStore, RunLog, Outbox, TimerStore,
SnapshotStore and AuditLog.

## Engine config

`persimmon.yaml` in the working directory (local) or given to `persimmon serve` (server).

| Field | Default | Used by |
|---|---|---|
| `mode` | `local` | |
| `store.sqlite` \| `store.postgres` | `.persimmon/persimmon.db` | every component but BlobStore and CredentialStore |
| `blobs` | `.persimmon/blobs` | BlobStore; a path or `s3://bucket/prefix` |
| `defaultNamespace` | `default` | Namespace of a Namespaced Resource written without one |
| `credentials[]` | `[{source: env}]` | CredentialStore; sources tried in order, first match wins |
| `maxReconcileAttempts` | 10 | `03-reconcile.md` |
| `maxCausationDepth` | 32 | `06-outbox.md` |
| `defaultCallDeadline` | `1h` | `callAdapter` without `deadline` |
| `leaseTtl` | `30s` | LeaseStore, Outbox claims |
| `server.listen`, `server.tls` | | server only; TLS mandatory |
| `server.auth.tokens[]` | | `{actor: {kind, id}, tokenHash}`; bearer tokens the API accepts |
| `server.grants[]` | | `{actor: {kind, id}, namespaces: [..] \| "*", admin?}` |

Local `engine.endpoint` is `unix://.persimmon/engine.sock`, derived.

| Credential source | Modes | Fields |
|---|---|---|
| `env` | both | `prefix` (default `PERSIMMON_CRED_`); `<ns>/<name>` maps to `<PREFIX><NS>__<NAME>` |
| `file` | both | `path`; server mode: encrypted at rest, key in `PERSIMMON_CRED_KEY` |
| `keychain` | local | OS keychain |
| `secretManager` | server | `url` |

## Authentication and authorization

Checked first in the write order (`00-resource.md`); reads use the same grant.

| Mode | Actor | Rule |
|---|---|---|
| local | `{kind: user, id: local}` | reads and writes everything |
| server | bearer token → `server.auth.tokens[].actor` | Namespace in the grant's `namespaces` for read and write; Global kinds: read by any authenticated Actor, write needs `admin` |

Handlers write `status` as `{kind: handler, id: <handler name>}`; no grant, never `spec`.
Adapters act through tokens (`07-adapter.md`), never through grants.

## Credentials

| Name | Scope | Bound from |
|---|---|---|
| `<name>` | Global | `Adapter.spec.credentialBindings`; any Executor |
| `<namespace>/<name>` | one Namespace | kind fields in that Namespace (Layer 1: `Executor.spec.security.credentialBindings`) |

A Namespaced Resource may bind only its own Namespace's names and Global names.

## CLI verbs (Layer 0)

| Verb | Effect |
|---|---|
| `persimmon validate <files>` | schema plus static rules; non-zero exit on `error` findings |
| `persimmon apply <files> [--skip-adapter-validation]` | write definitions; fails on an unreachable Adapter unless skipped (`13-executor.md`) |
| `persimmon adapter install <manifest>` · `adapter list` | apply an Adapter, run `describe`, Ready |
| `persimmon create <file> [--follow]` | store any Resource; `--follow` runs the engine until it reaches a `terminal.values` value or waits only on human Tasks, prints every phase change of the runs it owns and the `complete` command for each parked Task; Ctrl-C leaves it resumable |
| `persimmon run <Workflow> [--input <port>=<yaml \| @file>]... [--timeout <d>] [--follow]` | a manual WorkflowRun named `<workflow>-<hex6>` without writing its YAML; a scalar becomes `{kind: value, value}`, a RuntimeValue object passes through, a path on an `externalResource` port becomes a git ref, a revision document (`@spec.yaml`) on an `artifact` port is stored once and referenced; `timeout` absent means the Workflow's |
| `persimmon signal <kind>/<name> --payload <file> [--event-id <id>]` | Signal `{source: api}` as the local Actor; id generated when absent |
| `persimmon resume` | redeliver unacked Events and outstanding calls, drain the Outbox |
| `persimmon get` · `describe` · `logs` | read Resources, status, RunLog |
| `persimmon tree <kind>/<name>` | a run and every run it owns, nested by `ownerReferences`, oldest first; a child is labelled by its name minus its owner's, then its kind, then a TaskRun's Adapter; right column: phase (`passed` \| `rejected` for a Gate or Validator verdict) and elapsed time; under a run: its error, the `complete` command it waits for, a rejected Validator's findings, the artifacts a TaskRun published as `<Kind>/<id>.r<n>`; a footer lists the root's outputs |
| `persimmon init` | local mode: create `.persimmon/`, apply the SDLC pack (`20-pack.md`) |
| `persimmon complete <taskRun> --file <result.yaml>` | local mode: `signal` for a `cli-human/v1` attempt as the local Actor |
| `persimmon delete <kind>/<name>` | refused while referenced (`00-resource.md`) |
| `persimmon serve` | server mode daemon; the API is these verbs over https |

Every verb accepts `--server <url>`. In local mode every verb drains due timers and the
Outbox before exit; work waiting on an Adapter or a timer continues on the next verb.

## Invariants

Same schemas, static rules, snapshot bytes and digests, revision numbers, `blob://` and
`snapshot://` URIs, adapter protocol. State is committed after every Event; resume is exact
in both modes. The engine test suite runs against both implementations. An export from local
imports into a server unchanged.

## Decisions

- Tokens live in a TokenStore, not CredentialStore; `07-adapter.md` updated. CredentialStore
  stays read-only for the engine.
- Reads are authorized by the same Namespace grant as writes. Reference §9 covered writes only.
- Grants and auth key on the full Actor `{kind, id}`.
- TLS is mandatory in server mode; no upstream termination in v1.
- Credential names are Global or `<namespace>/<name>`; a Namespaced Resource binds only its
  Namespace and Global.
- `persimmon.yaml` is the one config file; `defaultNamespace`, `defaultCallDeadline`,
  `leaseTtl` added.
- Local verbs drain before exit, so a Trigger fires in the command that caused it when no
  Adapter call is pending.
- `signal` appends an audit record (`change: signal`, `00-resource.md`).
- `listRevisions`, `reserveRevision` and Publication scope ops live on ResourceStore; the
  reference's ArtifactStore and RelationStore are Layer 1 views.
- Server HTTP API is the verb set; a detailed API spec is roadmap.
- Authentication is bearer tokens only; OIDC is roadmap. Authorization is the grant table;
  a policy Resource is roadmap (reference decision 36).
- `env` credential names are upper case with `-` as `_`: `demo/github-token` reads
  `PERSIMMON_CRED_DEMO__GITHUB_TOKEN`. Found in implementation.
- `keychain` reads the macOS keychain: `security find-generic-password -s persimmon -a <name> -w`,
  one lookup per name per process, exit 44 (not found) and a missing binary mean absent, any
  other failure (locked keychain) is an error. `secretManager` resolves nothing
  until server mode. Found in implementation.
- `persimmon complete` has two modes. Interactive, the default at a terminal: prints what the
  human reads, asks `approve? [y/n]` and findings one per line for a ValidationResult port, an
  example shaped by the schema for any other port, validates every answer before the Signal.
  Scripted: `--file <result.yaml>`, no prompts; required when no terminal is attached. Found in
  UAT.
- Local mode has one live engine per project: `listen` takes `.persimmon/engine.lock` (pid, stale
  when the process is gone) and a second write verb fails with the holder's pid. Read verbs
  (`get`, `describe`, `logs`, `tree`, `validate`) open the store without the socket, without call
  recovery and without a drain, so they are safe beside a running `--follow`. Found in UAT.
- `persimmon run` is sugar over `create`: it writes the WorkflowRun the user would have written,
  nothing more; `--follow` reports owned runs by walking `ownerReferences`. Found in
  implementation.
- `defaultNamespace` fills a `Namespaced` kind on the write path; a `scope: Any` Resource written
  without a Namespace is Global (`00-resource.md`). The CLI places its own docs in `-n` or
  `defaultNamespace` unless `--global`; `persimmon init` and `apply --global` install a pack as
  Global (`20-pack.md`). CLI refs resolve Namespace first, then Global. Found in implementation.
- A WorkflowRun written without `timeout` takes its Workflow's `spec.timeout`; the CLI's old 24h
  default cut a 52h Workflow short. First filled by the CLI, then moved into the `workflow`
  Handler so `apply`, `create` and Triggers behave alike (`17-runs.md`). Found in UAT.
- `--follow` returns, exit 0, when every TaskRun the run owns is finished or waits on a human and
  at least one waits: the engine has nothing to do until `complete`. It prints
  `parked on you: persimmon complete <taskRun>` per parked Task. Found in UAT.
- `persimmon run --input <port>=@<file>` on an `artifact` port takes a revision document (a
  Resource with `spec.identity` and `spec.content`), stores it in the run's Namespace when absent,
  and passes its RevisionRef; a second run with the same file reuses the revision. One command
  instead of `create` then `run`. Found in UAT.
- `persimmon tree` prints the run tree that `--follow` reports flat; a Gate inside a repeat body
  makes nine runs for one command, and the flat list hid who owns whom. Found in UAT.

## Examples

- [`examples/store-config-local.yaml`](examples/store-config-local.yaml): default local
  config, every field explicit
- [`examples/store-config-server.yaml`](examples/store-config-server.yaml): server config
  with auth and grants
- [`examples/store-credentials-local.yaml`](examples/store-credentials-local.yaml):
  `.persimmon/credentials.yaml` with Global and Namespaced names; validates against
  `#/$defs/CredentialsFile`
