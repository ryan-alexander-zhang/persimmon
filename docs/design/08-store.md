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
| LeaseStore | `acquire(uid, holder, ttl)` · `renew` · `release` · `holder(uid)` | one holder per `uid`; `holder` names the live one |
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
| `store.sqlite` \| `store.postgres` | `.persimmon/persimmon.db` | every component but BlobStore and CredentialStore; a relative path is under the project directory, an absolute or `~/` one may be shared by several |
| `blobs` | `.persimmon/blobs` | BlobStore; a path, read as `store.sqlite`'s, or `s3://bucket/prefix` |
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
| `persimmon validate <files>` | schema plus static rules against the batch and the stored definitions; the batch is applied to a throwaway engine in kind order, and a document that failed on a reference gets a second pass once the rest is in; non-zero exit on `error` findings |
| `persimmon apply <files> [--skip-adapter-validation]` | write definitions: `created`, `updated`, or `unchanged` (equal spec, labels and annotations: no write, no version bump); fails on an unreachable Adapter unless skipped (`13-executor.md`) |
| `persimmon adapter install <manifest>` · `adapter list` · `adapter test <id> [--config <file>] [--live]` | apply an Adapter, run `describe`, Ready; `test` runs the conformance suite (`22-conformance.md`) |
| `persimmon create <file> [--follow]` | store any Resource; a revisioned one is stamped like a publish (`05-revisioned-kind.md`); `--follow` runs the engine until it reaches a `terminal.values` value or waits only on human Tasks, prints every phase change as `<labels from the root>   <Kind>   <Adapter>   <state>` (the root line is `<Kind>   <name>`), then the `tree` and the `complete` command for each parked Task; Ctrl-C leaves it resumable |
| `persimmon run <Workflow \| Pipeline \| ReviewLoop> [--input <port>=<yaml \| @file>]... [--timeout <d>] [--follow]` | a manual WorkflowRun named `<workflow>-<hex6>` without writing its YAML; `workflowRef.kind` is the kind found (`21-composition.md`); a scalar becomes `{kind: value, value}`, a RuntimeValue object passes through, `@file` on a `value` port of `type: string` is the file's text as is (less one final newline; a RuntimeValue document still passes through), a path on an `externalResource` port becomes a git ref, a revision document (`@spec.yaml`) on an `artifact` port is stored once and referenced, a list of documents or RevisionRefs on an `artifacts` port likewise; a ref without a Namespace is in the run's, one in another Namespace is refused (a Namespaced Resource binds its own, `00-resource.md`), one not in the store is refused before the run exists; `timeout` absent means the Workflow's |
| `persimmon signal <kind>/<name> --payload <file> [--event-id <id>]` | Signal `{source: api}` as the local Actor; id generated when absent |
| `persimmon resume [--follow]` | redeliver unacked Events and outstanding calls, drain the Outbox; `--follow` keeps the engine draining until no run of this project has a timer pending, so the open runs end or park |
| `persimmon cancel <kind>/<name>` | CancelRequested on a run as the local Actor; a Workflow cancels its children, a Task its attempt's call, and the drain delivers it |
| `persimmon get` · `describe` · `logs` | read Resources, status, RunLog; `get <Kind>/<id>` with no `.r<n>` is the id's latest committed revision, revisioned kinds only, never for `delete` |
| `persimmon get <Kind> --behind [-n ns \| --global]` | revisioned kinds only, one Namespace or with `--global` every one: the latest revision of each id with an input in `provenance.inputs` that has a newer revision, one line per input (`<Kind>/<name>  -n <ns>  behind <Kind>/<id> [-n <ns>] r<pinned> → r<current>`, the input's Namespace shown when it differs); per input id the highest revision pinned counts, and a newer revision whose `producerRef` is the document's own run (by uid, else Namespace, kind and name) does not; a hand-loaded revision pins nothing; a name beside `--behind` is refused |
| `persimmon get <Kind>[/<id>] --passed [-n ns \| --global]` | revisioned kinds only: per id the highest revision a WorkflowRun put out beside an output `passed` of `true`, a ReviewLoop's round or the loop itself (`21-composition.md`); with a Kind one line per id (`<Kind>/<id>.r<n>  -n <ns>`), `--global` over every Namespace; with an id that revision's document, refused when none passed, `--global` refused; a draft a rejected, cancelled or failed round left is never picked |
| `persimmon get <Kind>/<name> --files <dir> [-n ns \| --global]` | writes every representation of the revision into `<dir>` as `<name>.<ext>`, the extension from the media type (`text/html` `html`, `image/svg+xml` `svg`, `text/markdown` `md`, `text/vnd.mermaid` `mmd`), one `wrote <path>  <mediaType>  <bytes>` line each; a revision with none is refused (`18-artifact.md`) |
| `persimmon skill install <name> --into <dir> [--for claude \| codex]` | fetch and verify a Skill, copy its bundle into the workspace's native skill directories (`15-prompt-skill.md`); replaces an earlier install, refuses a hand-made directory under that name unless `--force` |
| `persimmon digest <dir>` | the Skill bundle digest of a directory (`15-prompt-skill.md`), to paste into `spec.digest` |
| `persimmon tree <kind>/<name>` | a run and every run it owns, nested by `ownerReferences`, oldest first; a child is labelled by its name minus its owner's, then its kind, then a TaskRun's Adapter; right column: phase (`passed` \| `rejected` for a Gate or Validator verdict) and elapsed time (creation to the last attempt's `finishedAt` for a TaskRun, else to the last RunLog entry; to now while live); under a run: its error, the `complete` command it waits for, the `exclusive` name a call waits for and the directory holding it (`13-executor.md`), a rejected Validator's findings, the artifacts a TaskRun published as `<Kind>/<id>.r<n>`; a footer lists the root's outputs |
| `persimmon init` | local mode: create `.persimmon/` and `.persimmon/inbox/`, write `persimmon.yaml`, install the shipped Adapters, apply the SDLC pack's `global/`, and `namespaced/` when the pack has one, then copy the pack's `files/` when absent or written by `init` and unedited, link `CLAUDE.md` to an `AGENTS.md` it wrote and ignore `.persimmon/` in `.gitignore` (`20-pack.md`) |
| `persimmon complete <taskRun> [--file <result.yaml>]` | local mode: `signal` for a `cli-human/v1` attempt as the local Actor, from the TaskRun's project directory only; `--file` holds `{outputs}`, an artifact port's value its content, or the `{taskResult, publish}` envelope; drains, then prints the `tree` of the run the Task belongs to, in both modes |
| `persimmon delete <kind>/<name>` | refused while referenced (`00-resource.md`) |
| `persimmon serve` | roadmap: server mode daemon; the API is these verbs over https |

Every verb will accept `--server <url>` with server mode (roadmap; refused now). In local mode every verb drains due timers and the
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
- `complete --file` takes `{outputs}` with an artifact port's content as its value, published under
  the form's `outputIds` as an interactive answer is; the `{taskResult, publish}` envelope still
  passes as is. A coding agent answering a build task writes the content it made, not the engine's
  envelope (`35-build-process.md`). Every answer is checked against its port's schema before the
  Signal, so a bad one keeps the form; a value port is `{kind: value, value}`, and without the form
  only RuntimeValues pass. A publish the engine still refuses fails the attempt with
  `schema_violation`; before, it stalled the TaskRun in Waiting. Found in audit.
- Local mode has one live engine per project directory: `listen` takes `.persimmon/engine.lock`
  (pid, stale when the process is gone) in one create-or-fail write, so two engines starting in the
  same instant cannot both pass a check-then-write (three `run`s started together once gave two
  engines and a third dying on the socket's `EEXIST`, found in UAT), and a second write verb fails
  with the holder's pid; a socket path already taken fails `listen` with a message, never an
  unhandled error. Read verbs
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
- `--input <port>=kind:<Kind>` on an `artifacts` port lists every artifact of that kind in the
  run's Namespace at its latest committed revision, by id: a local project is one product, so the
  list is the product's (`33-multi-context-product.md`). Refused on any other port and when the
  Namespace has none. Found in design review.
- `--input <port>=@<file>` on a `value` port of `type: string` takes the file's text as is: a
  brief in prose holds colons and dashes that YAML reads as a mapping or a list, or refuses
  (`Nested mappings are not allowed in compact mappings`); the port type, not the file, decides.
  Found in UAT.
- `persimmon tree` prints the run tree that `--follow` reports flat; a Gate inside a repeat body
  makes nine runs for one command, and the flat list hid who owns whom. Found in UAT.
- `--follow` speaks the tree's language: one line per change, labelled from the root
  (`rounds-1/implement   TaskRun   codex/v1   Running`), and the full tree when it stops. Found in
  UAT, three times.
- `apply` of an unchanged definition writes nothing and says `unchanged`; it used to say `updated`
  and bump `resourceVersion`, so a re-applied file hid what had changed. A KindDefinition or
  Adapter still re-registers or re-describes. Found in UAT.
- `complete` drains and ends with the `tree` of the run its Task belongs to, whichever mode: the
  scripted path printed one line and the caller had to go looking. Found in UAT.
- `tree` measures a finished TaskRun to its last attempt's `finishedAt`, not to the RunLog entry
  that applied the answer: local mode once delivered the answers of one drain together, so two
  parallel reviewers showed the same duration. Found in UAT.
- A drain delivers each call's answer as that call ends, not when every call it started has
  ended. The dispatcher awaited all its calls before reconciling any, so three capabilities
  written side by side waited for the slowest at every step, a barrier the Autopilot retest
  measured as identical durations for every loop; now the drain races the calls in flight,
  reconciles the first to end and starts what that unblocks while the others run. The race
  also wakes for the next due timer, so a retry backoff or a query timer fires on time while a
  sibling's call runs on for minutes. Found in UAT.
- `resume --follow` and `cancel`: an orchestrator that restarted on new definitions found the old
  run could neither be followed to its end (`resume` drained once and exited, its retry backoff
  waiting for the next engine) nor abandoned (`delete` refuses a referenced run, no verb sent
  CancelRequested), so it had to let the old run finish beside the new one. Found in the
  Autopilot retest.
- `--follow` prints the lines of one tick in commit order, the latest applied RunLog entry of each
  run: one drain commits a child's finish and its parent's reaction together, and the walk order
  printed the parent first. Found in UAT.
- `persimmon get <Kind>/<id>` with no `.r<n>` answers the id's latest committed revision: a human
  reviewing a run's output knows the id from the tree and the chosen-id scheme, not the revision
  number. Found in UAT.
- `persimmon run --input <port>=<RevisionRef>` refuses a ref that is not in the store before the
  run exists; the run used to be created and fail inside its first Task with `getArtifact`. Found
  in UAT.
- `validate` gives a document that failed on a reference a second pass after the whole batch is
  applied: the kind order (Task before Workflow before ReviewLoop before Pipeline) cannot settle a
  Workflow that steps into a ReviewLoop of the same files, so the AI Native pack validated only
  after it was applied. Found in UAT.
- `get --passed` reads runs, not revisions: a revision says who produced it and from what, never
  whether a Gate passed it, and every round publishes its draft before the Gate judges it, so the
  latest revision of an id is the latest draft. The verdict sits where the loop put it, a round's
  `passed` beside its subject (`21-composition.md`), so the query is over WorkflowRuns and needs no
  field on the revision. The Autopilot read "latest passed" as `get <Kind>/<id>` and based four
  revisions on drafts a cancelled chain had left. Found in the Autopilot retest.
- `get <Kind> --behind` is a read verb over provenance, not a Gate finding: at gate time inside
  a loop the revision bound is the one the document pins, so a document behind is never seen
  there; `design-check` (`29-design-process.md`) is the deliberate exception, a Gate run by hand
  against the revisions the caller names, newer than the pins. It reads every
  revisioned kind the same way, so a Spec behind its BusinessRules, a Plan behind a redesigned
  Design and a DomainModel behind the Prd it was derived from are one query. Two traps from a live
  project: a Prd pinned `rules` r3 and `previousRules` r1, and the run that read r3 wrote r4; the
  highest revision pinned per input id counts, and a newer revision from the document's own
  producer does not. Proven on the car pool: both DomainModels behind Prd r4 and rules r4, every
  Plan behind the two Designs revised after it, the Prd not behind the rules its own round wrote.
  Found in UAT.
- The local store waits up to 5s for a write lock (`busy_timeout`) instead of failing. One engine
  drives a project (`engine.lock`), but a read verb in a second terminal opens the same file, and
  without the wait it failed at once with `database is locked` whenever the run was mid-commit.
  A run's every transaction is short. Found in UAT: `persimmon get` beside a following run.
- Several project directories may share one Store: `store.sqlite` and `blobs` take an absolute
  path or one starting `~/`, so the git worktrees of one repository point at
  `~/.persimmon/projects/<name>/` and each runs its own engine. A Run belongs to the project
  directory whose engine created its tree: a Run written without an owner is stamped
  `persimmon.ai/project-directory` with that directory, a child Run inherits its owner's, and an
  engine reconciles, dispatches, fires timers for and recovers only Runs of its own directory or
  without the annotation (a Trigger's). Without the stamp, a second engine would mark the first one's
  live calls `unknown` at start and dispatch them again in its own worktree. Documents need no merge:
  every directory reads and publishes into the one Store, while code merges through git. The lock
  and the socket stay per directory, so two runs at once take two directories. A Run whose
  directory moved or was removed stays where it stopped. Found in use: two PRDs at once in two
  worktrees, whose separate stores could not be merged back.
- A Trigger belongs to its project directory as a Run does: stamped when written without an owner,
  so the Runs it fires inherit the directory and only that engine fires it. Unstamped, a Trigger's
  run had no directory, any engine drove it, and its agent built in whichever worktree drained
  first. Found in review.
- `complete` refuses a TaskRun of another project directory and names it: the answer would wait
  there unseen, and the inbox form it reads lives in that directory. Found in review.

## Examples

- [`examples/store-config-local.yaml`](examples/store-config-local.yaml): default local
  config, every field explicit
- [`examples/store-config-server.yaml`](examples/store-config-server.yaml): server config
  with auth and grants
- [`examples/store-credentials-local.yaml`](examples/store-credentials-local.yaml):
  `.persimmon/credentials.yaml` with Global and Namespaced names; validates against
  `#/$defs/CredentialsFile`
