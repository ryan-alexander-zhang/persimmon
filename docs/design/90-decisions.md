# Decisions

status: active · Every deviation from `docs/reference/` and every choice the reference left open, as
recorded in the `## Decisions` section of each design file. This file is the index; the design
file is the source.

```text
docs/design/00–08  Layer 0   ─┐
docs/design/10–19  Layer 1   ─┼─▶ ## Decisions bullets ─▶ this table, in file order
docs/design/20–22  Layer 2   ─┘
```

Reference decisions (`docs/reference/60-decisions.md`) 5, 10, 21, 31 were superseded by the
reference itself; 4 (definition, runtime, data planes) is superseded by the Layer 0–3 split;
every other one is kept or superseded by a row below. A decision restated in a second file
appears twice; the earlier file owns it.

| # | File | Decision |
|---|---|---|
| 1 | `00-resource.md` | `metadata.name` is a DNS subdomain, not a label: KindDefinition names carry dots. `namespace` stays a label. |
| 2 | `00-resource.md` | Envelope and `metadata` are closed sets. |
| 3 | `00-resource.md` | `apiVersion` grammar is `v<n>` only; no alpha or beta. |
| 4 | `00-resource.md` | Audit record gains `namespace` and a closed `change` set with `metadata` for engine-only writes and `signal` for external Signals. |
| 5 | `00-resource.md` | Handlers act as Actor kind `handler`; reference said `service`. |
| 6 | `00-resource.md` | One `ownerReference` at most. |
| 7 | `00-resource.md` | A LocalDefinitionRef inside `spec` counts for the delete rule too, in its Namespaced and its Global resolution; a Workflow keeps its Tasks. Found in implementation. |
| 8 | `01-kind-definition.md` | `scope: Any` added for definition kinds, so a pack ships Global definitions that a Namespace overrides by name (reference decision 26). Reference had `Namespaced \| Global`. |
| 9 | `01-kind-definition.md` | `terminal` optional with `handlerRef`. Definition kinds (Workflow, Task) have a Handler for `validate` and never finish. Reference required `terminal` whenever `handlerRef` was set. |
| 10 | `01-kind-definition.md` | `x-persimmon-ref.kinds` optional. Absent means the ref's own `kind` field decides; this is what keeps step kinds open. |
| 11 | `01-kind-definition.md` | `revisioned: true` ⇒ `Immutable`, `Namespaced`, `snapshot: None`, no `statusSchema`. The schema is frozen through `x-persimmon-kind-ref`, not by making revisions closure members. |
| 12 | `01-kind-definition.md` | `subscriptions.filter` is a CEL expression string. Reference left the shape open. |
| 13 | `01-kind-definition.md` | `versions[].statusSchema` optional; absent means `status` is free-form for that version. |
| 14 | `01-kind-definition.md` | A shipped KindDefinition's `versions[].schema` may be `{$ref: "<design file>#/<pointer>"}` into `docs/design/schemas`; the engine resolves file and local refs and walks only the `oneOf` branch whose `const` discriminators match. Found in implementation. |
| 15 | `01-kind-definition.md` | A `revisioned: true` KindDefinition never changes after registration; committed revisions were validated against it. Found in implementation. |
| 16 | `02-handler.md` | Every Handler, builtin or Adapter, reads other Resources only through the Engine callbacks (`07-adapter.md`); builtin Handlers call them in process. Reference gave builtins nothing. |
| 17 | `02-handler.md` | `implementation.adapter` is `{id}` only. Reference carried `transport` here; the Adapter Resource owns it. |
| 18 | `02-handler.md` | No `events[]` filter. Reference let a Handler list wanted Events; a Handler that ignores an Event costs one no-op call, and a filter could drop AdapterFinished or TimerFired the Handler itself caused. |
| 19 | `02-handler.md` | `statusPatch` in the result is the only Handler way to write `status`; the reference's separate `patchStatus` action is dropped (`03-reconcile.md` follows). The engine itself writes `status` of the kinds it registers (`07-adapter.md`). |
| 20 | `02-handler.md` | `context.actor` absent on engine-originated Events (TimerFired, ChildFinished, AdapterFinished); writes of that reconcile carry the Handler's `handler` Actor. Reference did not say. |
| 21 | `02-handler.md` | Static checker is a write-path stage after schema validation, before Handler `validate`. |
| 22 | `02-handler.md` | KindDefinition, Handler, Adapter are registered by the engine at start with no `handlerRef`. |
| 23 | `03-reconcile.md` | Every Event has a fixed `dedupeKey`; the reference named the field without shapes. |
| 24 | `03-reconcile.md` | Signal always carries an `eventId`; API and adapter callers supply one. |
| 25 | `03-reconcile.md` | `callAdapter.adapterId` is the `Adapter.spec.id` string; the reference wrote `adapterRef`. |
| 26 | `03-reconcile.md` | `idempotencyKey` is single-use per Resource. A `query` after `unknown` takes a new key. |
| 27 | `03-reconcile.md` | CancelRequested is delivered once per Resource; a second request is a no-op. |
| 28 | `03-reconcile.md` | `createResource` accepts `owned: false` for ownerless Resources (Trigger-created runs) and is idempotent on an equal existing Resource. |
| 29 | `03-reconcile.md` | `setTimer` with an existing key replaces it. |
| 30 | `03-reconcile.md` | Stalled recovery is any new Event. Reference had no recovery path. |
| 31 | `03-reconcile.md` | `patchStatus` action removed (`02-handler.md`). |
| 32 | `03-reconcile.md` | The RunLog entry keeps the Signal's Actor and the `log` callback text beside the Event; neither is in the wire `RunLogEntry` shape. `context.actor` is read from the entry. Found in implementation. |
| 33 | `04-snapshot.md` | An expansion member that collides with a member of the same kind and name but a different spec fails the create; an equal one is shared. `expand` errors surface as snapshot errors with the referencing path. Found in implementation. |
| 34 | `04-snapshot.md` | Bytes carry no run identity and no engine metadata: content-addressed, deduplicated. Reference serialized whole Resources. |
| 35 | `04-snapshot.md` | `uri` is `snapshot://<digest hex>`. Reference left it opaque. Sibling examples updated. |
| 36 | `04-snapshot.md` | Two new annotations, `x-persimmon-kind-ref` and `x-persimmon-adapter`, added to `01-kind-definition.md`. Reference reached artifact kinds and adapter digests without a mechanism. |
| 37 | `04-snapshot.md` | Adapter must answer `describe` at resolution and match its cached digest. Local mode adapters are local subprocesses, so offline still works. |
| 38 | `04-snapshot.md` | `stepContract.runKind` KindDefinitions are frozen too, so a child created mid-run validates against the schema the run was admitted with. |
| 39 | `04-snapshot.md` | Every hop resolves in the root's Namespace, so a Namespaced override of a Global pack definition applies through the whole closure. |
| 40 | `04-snapshot.md` | At resolution the walk checks the Adapter is Ready and records its cached `describeDigest`; it does not call `describe` again. Re-describing on every walk is roadmap. Found in implementation. |
| 41 | `05-revisioned-kind.md` | `metadata.name` is `<id>.r<revision>`; the envelope needs a name and the reference gave none. |
| 42 | `05-revisioned-kind.md` | `id` is required and a DNS label. Reference wrote `id?`; a generated id is not replayable across redelivery. |
| 43 | `05-revisioned-kind.md` | Publish carries `inputs[]`, the source of `provenance.inputs`. Reference had no source. |
| 44 | `05-revisioned-kind.md` | Representations are content-addressed blobs, `blob://<digest>`, uploaded by a `putBlob` callback before publish. Reference used `artifact://<ns>/<id>/<rev>/<name>` and left the upload path open. `CONTEXT.md` and `07-adapter.md` carry the callback. |
| 45 | `05-revisioned-kind.md` | Engine-originated commits stamp the owning Handler's `handler` Actor. Reference left the adapter path without an Actor. |
| 46 | `05-revisioned-kind.md` | Revisioned kinds are `Namespaced` with `snapshot: None`; the schema is frozen through `x-persimmon-kind-ref` (`04-snapshot.md`), not by making revisions closure members. Recorded in `01-kind-definition.md`. |
| 47 | `05-revisioned-kind.md` | Engine supplies the status schema for revisioned kinds; `versions[].statusSchema` is forbidden on them. |
| 48 | `05-revisioned-kind.md` | A revision written through the API (`persimmon create spec.yaml`) is stamped like a published one: `spec.identity.revision` must be the next number for its id (checked with `reserveRevision`, rolled back on error), `provenance` is replaced: the revision as its own producer, no inputs, the writer as actor, `status.contentDigest` is computed, `artifact.published` is emitted so Triggers fire. Re-creating the same content is idempotent; provenance is not compared. Found in UAT. |
| 49 | `06-outbox.md` | `resource.statusChanged` renamed `resource.finished` and fires only on reaching a terminal value. Reference did not say which status changes count. |
| 50 | `06-outbox.md` | `eventId` includes `time` and `ordinal`, so two emits of one type in one reconcile stay distinct. Reference hashed `(eventKind, subjectRef)` only. |
| 51 | `06-outbox.md` | Causation propagates through `createResource` and ChildFinished, so a publish → Trigger → run → publish loop is caught by the Layer 0 guard. Reference propagated through Signals only. |
| 52 | `06-outbox.md` | Delivery is Namespace-scoped and skips terminal Resources. Reference fanned out to every Resource of the kind. |
| 53 | `06-outbox.md` | Engine-emitted events carry `{kind: service, id: engine}`. |
| 54 | `06-outbox.md` | A committed revision emits `artifact.published` only, not `resource.created`. |
| 55 | `06-outbox.md` | `timer.fired` dropped; TimerFired is a reconcile Event, not a bus concern. |
| 56 | `07-adapter.md` | `signal` is a Layer 0 callback with a long-lived adapter token; the Actor is asserted by the Adapter over its authenticated channel. Reference put `complete` in Layer 1 with no Layer 0 ingress. |
| 57 | `07-adapter.md` | `putBlob` and `getBlob` replace `getRepresentation`; `log` takes text only, bytes go through `putBlob` (`05-revisioned-kind.md`). |
| 58 | `07-adapter.md` | `describe` must return `protocol`, so a wrong-protocol Adapter fails at apply. |
| 59 | `07-adapter.md` | The engine sets `payload.engine`, overwriting a supplied one. Reference had the Handler forward it. |
| 60 | `07-adapter.md` | `callAdapter` gains an optional `deadline` (`03-reconcile.md`); absent means engine default. |
| 61 | `07-adapter.md` | http long operations complete by POSTing to `engine.endpoint/responses`. |
| 62 | `07-adapter.md` | stdio spawns one process per call; no resident-process liveness in the engine. |
| 63 | `07-adapter.md` | `credentialBindings[0]` is the http bearer token. |
| 64 | `07-adapter.md` | `status.describeDigest` stored beside `describe`. Adapter `status` is engine-written, and `Ready` lives in `status.conditions[]`; the reference kept conditions out of `status` for handled kinds (decision 32), an Adapter has no Handler. |
| 65 | `07-adapter.md` | One process per call, so a resident process with liveness handling is roadmap. |
| 66 | `07-adapter.md` | Conformance suite: the executor Role is `22-conformance.md`; the handler Role is roadmap (`91-roadmap.md`). |
| 67 | `07-adapter.md` | stdio environment is an allowlist: `PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `NODE_PATH`, `NODE_OPTIONS`, then `spec.env`, bound credentials, minus any `PERSIMMON_*` name they carry, then the adapter token. `USER` is needed for macOS keychain logins. Found in implementation. |
| 68 | `07-adapter.md` | Stream `log` lines are appended to the RunLog entry that issued the call, beside the `log` callback; `waiting` lines are not stored, the Handler owns `waitingReason`. Found in implementation. |
| 69 | `07-adapter.md` | A `publishArtifact` the engine refuses (content, blob, shape) answers `400 invalid_input`, not `500`. Found in implementation. |
| 70 | `07-adapter.md` | The callbacks socket moves to the temp directory, keyed by cwd, when the project path is too long for `sun_path`. Found in implementation. |
| 71 | `08-store.md` | Tokens live in a TokenStore, not CredentialStore; `07-adapter.md` updated. CredentialStore stays read-only for the engine. |
| 72 | `08-store.md` | Reads are authorized by the same Namespace grant as writes. Reference §9 covered writes only. |
| 73 | `08-store.md` | Grants and auth key on the full Actor `{kind, id}`. |
| 74 | `08-store.md` | TLS is mandatory in server mode; no upstream termination in v1. |
| 75 | `08-store.md` | Credential names are Global or `<namespace>/<name>`; a Namespaced Resource binds only its Namespace and Global. |
| 76 | `08-store.md` | `persimmon.yaml` is the one config file; `defaultNamespace`, `defaultCallDeadline`, `leaseTtl` added. |
| 77 | `08-store.md` | Local verbs drain before exit, so a Trigger fires in the command that caused it when no Adapter call is pending. |
| 78 | `08-store.md` | `signal` appends an audit record (`change: signal`, `00-resource.md`). |
| 79 | `08-store.md` | `listRevisions`, `reserveRevision` and Publication scope ops live on ResourceStore; the reference's ArtifactStore and RelationStore are Layer 1 views. |
| 80 | `08-store.md` | Server HTTP API is the verb set; a detailed API spec is roadmap. |
| 81 | `08-store.md` | Authentication is bearer tokens only; OIDC is roadmap. Authorization is the grant table; a policy Resource is roadmap (reference decision 36). |
| 82 | `08-store.md` | `env` credential names are upper case with `-` as `_`: `demo/github-token` reads `PERSIMMON_CRED_DEMO__GITHUB_TOKEN`. Found in implementation. |
| 83 | `08-store.md` | `keychain` reads the macOS keychain: `security find-generic-password -s persimmon -a <name> -w`, one lookup per name per process, exit 44 (not found) and a missing binary mean absent, any other failure (locked keychain) is an error. `secretManager` resolves nothing until server mode. Found in implementation. |
| 84 | `08-store.md` | `persimmon complete` has two modes. Interactive, the default at a terminal: prints what the human reads, asks `approve? [y/n]` and findings one per line for a ValidationResult port, an example shaped by the schema for any other port, validates every answer before the Signal. Scripted: `--file <result.yaml>`, no prompts; required when no terminal is attached. Found in UAT. |
| 85 | `08-store.md` | Local mode has one live engine per project: `listen` takes `.persimmon/engine.lock` (pid, stale when the process is gone) and a second write verb fails with the holder's pid. Read verbs (`get`, `describe`, `logs`, `tree`, `validate`) open the store without the socket, without call recovery and without a drain, so they are safe beside a running `--follow`. Found in UAT. |
| 86 | `08-store.md` | `persimmon run` is sugar over `create`: it writes the WorkflowRun the user would have written, nothing more; `--follow` reports owned runs by walking `ownerReferences`. Found in implementation. |
| 87 | `08-store.md` | `defaultNamespace` fills a `Namespaced` kind on the write path; a `scope: Any` Resource written without a Namespace is Global (`00-resource.md`). The CLI places its own docs in `-n` or `defaultNamespace` unless `--global`; `persimmon init` and `apply --global` install a pack as Global (`20-pack.md`). CLI refs resolve Namespace first, then Global. Found in implementation. |
| 88 | `08-store.md` | A WorkflowRun written without `timeout` takes its Workflow's `spec.timeout`; the CLI's old 24h default cut a 52h Workflow short. First filled by the CLI, then moved into the `workflow` Handler so `apply`, `create` and Triggers behave alike (`17-runs.md`). Found in UAT. |
| 89 | `08-store.md` | `--follow` returns, exit 0, when every TaskRun the run owns is finished or waits on a human and at least one waits: the engine has nothing to do until `complete`. It prints `parked on you: persimmon complete <taskRun>` per parked Task. Found in UAT. |
| 90 | `08-store.md` | `persimmon run --input <port>=@<file>` on an `artifact` port takes a revision document (a Resource with `spec.identity` and `spec.content`), stores it in the run's Namespace when absent, and passes its RevisionRef; a second run with the same file reuses the revision. One command instead of `create` then `run`. Found in UAT. |
| 91 | `08-store.md` | `persimmon tree` prints the run tree that `--follow` reports flat; a Gate inside a repeat body makes nine runs for one command, and the flat list hid who owns whom. Found in UAT. |
| 92 | `08-store.md` | `--follow` speaks the tree's language: one line per change, labelled from the root (`rounds-1/implement TaskRun codex/v1 Running`), and the full tree when it stops. Found in UAT, three times. |
| 93 | `08-store.md` | `apply` of an unchanged definition writes nothing and says `unchanged`; it used to say `updated` and bump `resourceVersion`, so a re-applied file hid what had changed. A KindDefinition or Adapter still re-registers or re-describes. Found in UAT. |
| 94 | `08-store.md` | `complete` drains and ends with the `tree` of the run its Task belongs to, whichever mode: the scripted path printed one line and the caller had to go looking. Found in UAT. |
| 95 | `08-store.md` | `tree` measures a finished TaskRun to its last attempt's `finishedAt`, not to the RunLog entry that applied the answer: local mode delivers the answers of one drain together, so two parallel reviewers showed the same duration. Found in UAT. |
| 96 | `08-store.md` | `--follow` prints the lines of one tick in commit order, the latest applied RunLog entry of each run: one drain commits a child's finish and its parent's reaction together, and the walk order printed the parent first. Found in UAT. |
| 97 | `10-ports.md` | The execute payload carries every value port schema with its `$ref`s inlined from the design files, so an Adapter or a human form reads it alone. Found in implementation. |
| 98 | `10-ports.md` | Well-known `ArtifactRef` renamed `RevisionRef` everywhere, including the `$ref` id; `CONTEXT.md` amended. `EntityRef` dropped with entity indexing (`91-roadmap.md`). |
| 99 | `10-ports.md` | Step ids allow `-`. Reference allowed `_` only; every example and `logicalExecutionId` use `-`. |
| 100 | `10-ports.md` | `artifact` PortType carries `artifactKind` with `x-persimmon-kind-ref`, so the snapshot walk freezes the schema. |
| 101 | `10-ports.md` | `fromEvent` reads an engine projection, not the raw Outbox event, because payloads are pointers (`06-outbox.md`). |
| 102 | `10-ports.md` | `Finding.severity` gains `info`. |
| 103 | `10-ports.md` | CEL library: `@marcbachmann/cel-js`. Spike over every expression in `examples/`: it evaluates all of them and its `Environment.check` rejects unknown roots, unknown fields and type errors before any run, which is what static rule 11 needs. `cel-js` lacks the `size()` method form and `startsWith`; `@bufbuild/cel` has no exported checker. Needs `homogeneousAggregateLiterals: false` for the ValidationResult map literal. |
| 104 | `10-ports.md` | Port values bind to CEL by schema type, because a JSON integer bound as `double` makes `inputs.n + 1` a type error in every spec-conformant library. |
| 105 | `10-ports.md` | `inputs` and `outputs` optional on a definition. |
| 106 | `11-workflow.md` | Workflow is `scope: Any` (`01-kind-definition.md`): pack Workflows are Global, overridable by Namespace. |
| 107 | `11-workflow.md` | Mixed `to` lists are legal with `dispatch: first`; the static rule bounds `dispatch: all` only. Reference rule 6 read as a rule on the fired set. |
| 108 | `11-workflow.md` | A Failed outcome is consumed when the step's Transition lists `Failed`; decidable statically, independent of when the Transition fired. |
| 109 | `11-workflow.md` | Every step is `from` of exactly one Transition; the reference allowed none. |
| 110 | `11-workflow.md` | `reason` is snake_case and becomes `error.code` verbatim; optional on Succeeded. |
| 111 | `11-workflow.md` | `join`, `dispatch`, `noMatch` default to `all`, `all`, `fail`. Reference required them. |
| 112 | `11-workflow.md` | Layer 1 codes defined here: `no_match`, `unconsumed_failure`, `output_unbound`, `no_progress`, `iteration_limit`, `timeout` reused from Layer 0. |
| 113 | `11-workflow.md` | `any` and `quorum` never cancel the remaining `from` steps; eager joins are roadmap. |
| 114 | `11-workflow.md` | A Failed Workflow exports no outputs; a business rejection is Succeeded plus a verdict output (reference; kept). No named entrypoints (reference decision 7; kept). |
| 115 | `11-workflow.md` | The `stepContract` names no child `spec` shape, so the `workflow` Handler builds TaskRun, GateRun and WorkflowRun specs itself and gives any other run kind the TaskRun shape with `<kind>Ref`. A contract field for the child shape is roadmap. Found in implementation. |
| 116 | `11-workflow.md` | A Transition counts as fired once any of its `to` steps has a run, even one another Transition started; a step that is `to` of two Transitions therefore fires the second one at most through its own guard. Recording fired Transitions in `status` is roadmap. Found in implementation. |
| 117 | `11-workflow.md` | `logicalExecutionId` is `<runName>/<own iteration>/<stepId>`: the child run of a repeat body is named `<parent>-<step>-<n>`, so repeating the enclosing `iterationPath` doubled it in artifact ids (`...-rounds-1-rounds-1-implement-report`). `address.iterationPath` keeps the full path. Found in UAT. |
| 118 | `11-workflow.md` | `steps.<id>.iterations` is readable in `when` and in later steps' bindings once a `repeat` step finished: a report step wanted the round count. Found in UAT. |
| 119 | `11-workflow.md` | A run whose steps all finished without a terminal fails with the first Failed step's own error (`step implement: skill_digest_mismatch: ...`), not `no_progress`; `no_progress` is reserved for the case with no failure, a routing hole. A body run's error then reaches the repeat step and the outer run unchanged. Found in UAT. |
| 120 | `11-workflow.md` | A `repeat` step's `timeout` bounds the loop: the deadline is computed once at the first iteration and kept in `steps.<id>.deadline`; later iterations reuse it, a body WorkflowRun gets the remaining time as `timeout`. The code had given every iteration a fresh `timeout`, so a `6h` step could run three `4h` rounds. Found in UAT. |
| 121 | `12-task.md` | No `action.kind` and no `resultProtocol` field. Reference decision 25 removed the first; the second was a constant. |
| 122 | `12-task.md` | `timeout` is per attempt; the enclosing deadline bounds the TaskRun. |
| 123 | `12-task.md` | The static checker rules run inside the `task` Handler's `validate`, reading the Executor and the Adapter `describe` live; an unreachable Adapter skips them, the Executor reports it. Found in implementation. |
| 124 | `12-task.md` | `permission_denied`, `invalid_input`, `schema_violation` are hard non-retryable, not only barred from `retryOn`. |
| 125 | `12-task.md` | Resolved `skill` entry carries `format`; `19-adapter-roles.md` publishes that shape. Resolved `prompt` entry carries `mediaType`, `content` and `digest`. |
| 126 | `12-task.md` | No context inheritance; every Task states its own context (reference decision 14; kept). |
| 127 | `12-task.md` | `TaskResult.summary` added; logs go through the `log` callback. |
| 128 | `12-task.md` | Attempt indices and `idempotencyKey` suffixes are 1-based. |
| 129 | `12-task.md` | Codes used: `invalid_input`, `schema_violation`, `timeout`, `unknown_result`, `permission_denied` from Layer 0; `adapter_unavailable` as a warning code. |
| 130 | `12-task.md` | `action.workspace` names where an attempt works. Without it the agent inherited the engine's cwd, so a coder run from a subdirectory of a checkout found that checkout's `.git` and `AGENTS.md` and committed to it. The workspace is the Task's, not the Executor's: it is what the work touches, not who does it; an Executor-level cap is roadmap. Found in UAT. |
| 131 | `12-task.md` | `unknown_result` is retried for `none` and `idempotent`, refused for `nonIdempotent`. The earlier rule (only `none`) made `idempotent` behave like `nonIdempotent`, the one place `sideEffects` is read; and in local mode a killed engine kills its stdio Adapter and agent, so a resumed call with no answer had done nothing, yet an `idempotent` Task failed for good. Found in UAT. |
| 132 | `13-executor.md` | `allowedOperations` and `validateConfig` dropped. Reference listed both; neither had a consumer beyond what `describe.configurationSchema` gives. `CONTEXT.md` updated. |
| 133 | `13-executor.md` | `configuration` and `action.parameters` never merge; a key in both is two keys. |
| 134 | `13-executor.md` | `security` absent means `networkAccess: deny`. |
| 135 | `13-executor.md` | Credentials resolve per attempt, so rotation applies to the next attempt. |
| 136 | `13-executor.md` | Executor is `scope: Any`; a Namespace that wants a pack Executor with its own credentials overrides it by name. |
| 137 | `13-executor.md` | `contextKinds` and `skillFormats` are checked on the Task (`12-task.md`), not here. |
| 138 | `13-executor.md` | `formRenderable` and the human completion contract are owned by `19-adapter-roles.md`. |
| 139 | `13-executor.md` | No unified effort hint; each Adapter defines its own in `parametersSchema`. A cross-adapter hint is roadmap. |
| 140 | `13-executor.md` | A credential that does not resolve at dispatch fails the attempt as AdapterFinished `permission_denied`, not retryable; the engine never throws. Found in implementation. |
| 141 | `14-gate.md` | GateRun exposes its verdict at `status.outputs.result`, like every step kind. Reference had `status.result`. |
| 142 | `14-gate.md` | `any` and `quorum` count after every ValidationRun finishes; eager termination is roadmap. No Gate-level score aggregation; `ValidationResult.score` is informational. |
| 143 | `14-gate.md` | `evaluator.type` is closed: `cel`, `task`, `adapter`; the Adapter Role is always `evaluator`. Reference let `type` name the Role. |
| 144 | `14-gate.md` | Evaluator Adapters get no `credentials` or `security`; they run on Adapter-level bindings. |
| 145 | `14-gate.md` | Validator inputs are bound per Gate, so one Validator serves many Gates. |
| 146 | `14-gate.md` | `cel` sees `{content, provenance}` per artifact and may return a full ValidationResult. |
| 147 | `14-gate.md` | Gate and Validator inputs exclude `externalResource`: a Validator judges produced facts; a repository check is a `task` Validator whose Task reads the repository. |
| 148 | `14-gate.md` | A ValidationRun exists only under a GateRun in v1. |
| 149 | `14-gate.md` | `resultOutput` needs a `value` port; the ValidationResult `$ref` is recommended, the runtime check is what binds (reference rule 14; kept). |
| 150 | `14-gate.md` | Gate and Validator are `scope: Any`. `validateConfig` dropped for the evaluator Role too. |
| 151 | `14-gate.md` | Demo instance names are free text; `CONTEXT.md` governs design prose, not example names. |
| 152 | `15-prompt-skill.md` | No Skill handler and no engine-side digest check. Reference had a `skill` handler that verified when reachable; one verifier, the Adapter, means one algorithm. Reference open question 3 (Git tree digest) is the Adapter's contract. |
| 153 | `15-prompt-skill.md` | Prompt `mediaType` restricted to `text/*`; delivered in the resolved entry. Reference allowed any and did not deliver it. |
| 154 | `15-prompt-skill.md` | Skill `format` grammar is `<name>/v<n>`, like Adapter ids. |
| 155 | `15-prompt-skill.md` | `source.provider` is open. Reference listed `git \| oci \| https \| file`. |
| 156 | `15-prompt-skill.md` | New Layer 1 code: `skill_digest_mismatch`. |
| 157 | `15-prompt-skill.md` | Bundle digest for a directory, as the shipped agent Adapters compute it (fetch moved to `skill install`): sha256 over every regular file in sorted posix-path order, each fed as `<path>\0<bytes>\0`, `.git` excluded. `git` sources are fetched once per (remote, version) into `.persimmon/skills/<hash>`; `file` sources resolve `locator.path` against the engine cwd and, once verified, are copied into `.persimmon/skills/file-<digest16>`, so the agent reads the bytes that matched the digest. A bundle holding anything but regular files and directories is refused; `locator.remote` is an https, ssh, git or file URL, an scp-style address or an absolute path, `version` a commit or ref name, so git never reads an option or an `ext::` transport from a Skill. Closes reference open question 3. Found in implementation. |
| 158 | `15-prompt-skill.md` | A Skill is installed into a workspace once and stays: `persimmon skill install <name> --into <dir>` fetches into the cache, verifies the digest and copies the bundle to `<dir>/.agents/skills/<name>` and `<dir>/.claude/skills/<name>`, where codex and claude discover their own skills. A Task still declares the Skills it needs as context; at attempt start the Adapter finds each declared one in the workspace, hashes it and compares to the declared digest: missing or different fails the attempt and names the install command. Other skills present in the workspace are allowed and logged as unmanaged. Declared in YAML, verified before the run, recorded on the TaskRun; the files persist and every agent in the workspace sees them, humans too. A per-attempt link was tried first and dropped: churn for nothing, and skills are conventions, not secrets. Found in UAT. |
| 159 | `15-prompt-skill.md` | `persimmon digest <dir>` prints the bundle digest, so a Skill can be declared for a local directory without computing sha256 by hand; the CLI and the Adapters share the algorithm by test. Found in UAT. |
| 160 | `15-prompt-skill.md` | A `file` Skill is cached by digest like a `git` one: the source directory is verified, then copied; an edit to the source after the digest was declared fails the next `skill install`, an edit to the installed copy fails the next attempt, instead of reaching the agent unpinned. Found in UAT. |
| 161 | `16-trigger.md` | `spec.on` renamed `spec.event`; bare `on` is a YAML 1.1 boolean. `artifactKind` nested as `{apiVersion, kind}` like a PortType. |
| 162 | `16-trigger.md` | Trigger-created runs are ownerless (`createResource owned: false`, `03-reconcile.md`), so a Trigger stays deletable and receives no ChildFinished. |
| 163 | `16-trigger.md` | `enabled: false` is a Handler check; delivery is kind-level (`06-outbox.md`). Reference had disabled Triggers receive nothing. |
| 164 | `16-trigger.md` | Idempotency by run name `<trigger>-<12 hex>`; a deleted and recreated Trigger does not refire. Reference keyed on `(triggerName, eventId)` without a mechanism. |
| 165 | `16-trigger.md` | `fromEvent: run` dropped; no ObjectRef PortType. Reference had it. |
| 166 | `16-trigger.md` | `workflowRunFinished` matches root runs only. |
| 167 | `16-trigger.md` | Loop guard is the Layer 0 causation chain, per Signal (`06-outbox.md`); the reference's `(triggerName, workflowRef)` count is dropped. |
| 168 | `16-trigger.md` | `trigger.failed` Outbox event replaces the reference's TriggerFailed record. |
| 169 | `16-trigger.md` | No Trigger `terminal`. |
| 170 | `16-trigger.md` | `event.kind` is closed to engine-produced events; external sources and webhooks are roadmap. |
| 171 | `17-runs.md` | Builtin Handlers use the Engine callbacks in process (`02-handler.md`); a Handler needs to read child runs, artifacts and its Executor. |
| 172 | `17-runs.md` | Child runs carry an absolute `spec.deadline` set by the creator; the step deadline is enforced by the child, not by a per-step timer on the parent. |
| 173 | `17-runs.md` | Attempt deadline expiry is an attempt failure `timeout` and follows `retryPolicy`; the enclosing `deadline` fails the run unconditionally. |
| 174 | `17-runs.md` | Cancel is immediate: the run is Cancelled in the reconcile that received CancelRequested; children are cancelled best effort. Reference waited for children. |
| 175 | `17-runs.md` | `address` groups the Invocation address fields on TaskRun, GateRun and ValidationRun. |
| 176 | `17-runs.md` | `steps` is a map keyed by step id without outputs; readers follow `runRef`. |
| 177 | `17-runs.md` | `approvalGroup` dropped; human quorum is Gate `policy`. `loadedArtifacts` dropped; `spec.inputs` already records the exact revisions. |
| 178 | `17-runs.md` | GateRun records `validationRuns: {<name>: ObjectRef}` and exposes the verdict at `status.outputs.result`. ValidationRun `gateRunRef` required. |
| 179 | `17-runs.md` | Run kind refs other than `workflowRef` are unannotated; they resolve against the inherited snapshot. |
| 180 | `17-runs.md` | `query` after `unknown` uses key `<attempt key>/query/<sequence>`; `cancel` uses `<attempt key>/cancel/<sequence>`. |
| 181 | `17-runs.md` | Human completion is a Signal through the `signal` callback; no `complete` op. |
| 182 | `17-runs.md` | `TaskRun.status.actor` from the completing Signal's `context.actor` (reference decision 22). |
| 183 | `17-runs.md` | `WorkflowRun.spec.timeout` and `Trigger.spec.run.timeout` are optional: the `workflow` Handler reads the Workflow's `spec.timeout` when the run carries none, so every writer (CLI, Trigger, API) inherits it the same way. Found in UAT. |
| 184 | `17-runs.md` | An attempt's `finishedAt` is the Adapter's answer time (`AdapterFinished.finishedAt`), not the delivery time: local mode dispatches the calls of one drain together and delivers their answers after the slowest, so a two-second script showed the same end as a one-minute agent. Found in UAT. |
| 185 | `17-runs.md` | The resolved Context lives in `TaskRun.status.context`, not `spec.context`: only the `task` Handler can resolve it (it needs the Task, its inputs and the snapshot), and a Handler writes `status` only; the creating Handlers had written `context: []` and the record was never made. `spec.context` is dropped. Found in UAT. |
| 186 | `18-artifact.md` | No separate ArtifactStore or RelationStore: artifacts and Relations are Resources; queries are `list` with engine-stamped labels. Reference had two stores. |
| 187 | `18-artifact.md` | New Engine callback `list(kind, namespace, labels)` (`07-adapter.md`), so a pack traceability Validator can read Relations. |
| 188 | `18-artifact.md` | `assertedBy` dropped; the audit record of the create carries the Actor. Reference had it as a field. |
| 189 | `18-artifact.md` | The engine writes labels under the reserved `persimmon.ai/` prefix (`00-resource.md`). |
| 190 | `18-artifact.md` | Endpoints are `revision` or `external`; `EntityRef` dropped with entity indexing (`91-roadmap.md`). |
| 191 | `18-artifact.md` | Builtin Handlers assert no Relations in v1; pack kinds and users do. |
| 192 | `18-artifact.md` | Artifact kinds and RelationTypes beyond the examples are pack content (`20-pack.md`). |
| 193 | `18-artifact.md` | No artifact scope (internal versus exported); Workflow output contracts encapsulate, and every revision stays addressable for audit (reference roadmap; kept out). |
| 194 | `19-adapter-roles.md` | `validateConfig` and `complete` removed from the Role op sets; completion is the Layer 0 `signal` callback (`07-adapter.md`, `13-executor.md`). |
| 195 | `19-adapter-roles.md` | Human completion carries content: the Signal body is `{taskResult, publish[]}` and the `task` Handler publishes into its own reconcile. No long-lived call token, and the engine stamps the human Actor because the commit is that reconcile. Reference had the Adapter publish with a call token before `complete`. |
| 196 | `19-adapter-roles.md` | `execute` returns HumanAck for `type: human`; the `task` Handler recognises it and stays Waiting. Layer 0 mapping to AdapterFinished is unchanged. |
| 197 | `19-adapter-roles.md` | `execute` payload reshaped: `task` is `{instructions, parameters, sideEffects, outputs, outputSchemas}`, `taskRun` carries an ObjectRef and the attempt key. Reference nested `action` and sent neither key nor schemas. |
| 198 | `19-adapter-roles.md` | The `query` and `cancel` payloads carry the attempt's `idempotencyKey`; each call itself takes a fresh key (`03-reconcile.md`). `query` `running` re-polls. |
| 199 | `19-adapter-roles.md` | `supports.complete` means "finishes through `signal`" and holds iff `human ∈ executorTypes`. |
| 200 | `19-adapter-roles.md` | `evaluate` receives `artifacts.<port>` as `{content, provenance}`, matching the `cel` environment. |
| 201 | `19-adapter-roles.md` | A standard form-rendering contract for human Adapters is roadmap; v1 renders from `task.outputSchemas` in Adapter-specific ways. Web, chat and email approval clients are Adapters, outside this design. |
| 202 | `19-adapter-roles.md` | A Claude Code Adapter may expose `configuration.agent` to run a repository subagent definition as-is; portable definitions use Prompt and Skill instead. |
| 203 | `19-adapter-roles.md` | Shipped agent Adapters `claude-code/v1` and `codex/v1` share one runner (`adapters/lib/agent.mjs`). One agent process per attempt, prompt is context entries in order, value inputs, `instructions`, then the output schemas; the agent answers one flat JSON object, one key per output port, through the CLI's structured output; the Adapter publishes the artifact outputs itself under identity `<logicalExecutionId>-<port>` as a DNS label, one per logical execution. The agent never sees `engine.token` or the adapter token; task credentials reach it as `<NS>__<NAME>` environment. Found in implementation. |
| 204 | `19-adapter-roles.md` | `agent_failed` (retryable) is the Layer 1 code for an agent process that exits non-zero or answers no JSON; a publish the engine refuses is `schema_violation`, not retryable; a callback refusal is `permission_denied`. Found in implementation. |
| 205 | `19-adapter-roles.md` | Shipped agent Adapters read `claude-code-skill/v1` Skills: a directory with `SKILL.md`, installed into the workspace per `15-prompt-skill.md`, verified against the declared digest at attempt start and named in the prompt; `file` context is a pointer into the working directory, the agent reads it. `codex/v1` maps `security.networkAccess` to `sandbox_workspace_write.network_access`, closed unless `allowlist`, and refuses `deny` with `sandbox: full` since the bypass ignores the switch; `allowedHosts` and the claude sandbox network are not enforced by these Adapters. Found in implementation. |
| 206 | `19-adapter-roles.md` | `subprocess/v1` ships on the same runner: `configuration.program` plus `parameters.args`, the execute payload without `credentials` and `engine` on stdin, credentials as environment, and the answer `{outputs, summary?}` read from `configuration.resultFile` (relative to the workspace) and removed; artifact ports carry content, the Adapter publishes. Found in implementation. |
| 207 | `19-adapter-roles.md` | `codex/v1` sends the output schema in OpenAI strict form: closed objects, every kept property required, optional properties dropped, `format` removed; the prompt states the formats. Found in implementation. |
| 208 | `19-adapter-roles.md` | Agent output streams to the RunLog as `log` lines while the process runs: every whole line of stderr, and of stdout when the driver marks it a transcript (both shipped agent Adapters; `codex/v1` streams raw lines, `claude-code/v1` maps stream-json events). Credentials redacted, at most 5000 lines per stream per attempt (a coding agent's transcript with tool output runs past 500), the last one says so. `persimmon logs` shows what the agent did after a success too. Found in UAT. |
| 209 | `19-adapter-roles.md` | The agent's answer schema is flat: one top-level key per output port, no `outputs` wrapper, no `summary`; the driver wraps it into `{outputs}`. `claude -p --json-schema` is a tool the model fills by hand, validated and re-prompted by the CLI, not constrained decoding (that exists only in the Messages API, which the CLI does not expose). With `{outputs: {prd: {..., summary}}, summary}` claude wrapped `outputs` twice or moved `summary` inside it, one to three rejected answers per step, whatever the prompt said; a small schema never failed. Flat, the reviewer and judge steps answered first time; the large `EarsPrd` answer still got wrapped once (`{"prd":{"prd":...}}`), the known open upstream bug (claude-agent-sdk-python #502), absorbed by the CLI's own retry at the cost of tokens, never an attempt. Headless `claude -p` emits no `thinking` events, so an agent's reasoning reaches the log only as text it writes before answering. Found in UAT. |
| 210 | `19-adapter-roles.md` | The shipped Adapters spawn the agent or program with `cwd: payload.workspace`; `subprocess/v1` resolves `resultFile` against it. `.persimmon/` state (pid files, inbox, the skills cache `skill install` writes) stays under the engine's cwd. Found in UAT. |
| 211 | `19-adapter-roles.md` | `claude-code/v1` answers `permission_denied`, not retryable, when the CLI reports a login or API key failure; retrying a dead login burned attempts. Found in UAT. |
| 212 | `19-adapter-roles.md` | `claude-code/v1` configuration `allowedTools[]` passes `--allowedTools`, so a `workspace-write` Executor can run named commands (`Bash(npm test:*)`) headlessly without the `full` sandbox; `-p` has nobody to answer a permission prompt. Found in UAT. |
| 213 | `19-adapter-roles.md` | `claude-code/v1` runs `--output-format stream-json --verbose` and turns the events into log lines: the agent's text, `> <tool> <input>`, `< <result>`; init, rate limit and result events are dropped; the `result` event is the answer. A driver's `transcript` may be a line mapper. One line logger per stream, so a partial stdout line no longer joins a stderr line. Found in UAT. |
| 214 | `19-adapter-roles.md` | A Skill reaches the agent where its CLI discovers skills, `<workspace>/.claude/skills/<name>` (claude) or `<workspace>/.agents/skills/<name>` (codex), installed there by `persimmon skill install` and left in place. The Adapter neither fetches nor writes: it hashes the installed directory of every declared Skill and fails the attempt on a missing one (`invalid_input`, the install command in the message) or a different digest (`skill_digest_mismatch`); it logs the skills present that no context entry declares. `--add-dir` only granted read access; a native skill can be invoked. Found in UAT. |
| 215 | `20-pack.md` | No pack manifest, version, dependency resolution or `pack` verb: reference roadmap excluded a pack format from v1. A Pack is a directory and `apply`. |
| 216 | `20-pack.md` | Composition kinds `Pipeline`, `ReviewLoop`, `Approval` ship with the engine, not the pack (`21-composition.md`): a pack ships YAML and cannot ship a Handler. The pack's Workflows stay raw Workflows; a Pipeline version is an example, not pack content. |
| 217 | `20-pack.md` | Deployment out of the v1 lifecycle: no `Rollout`, no `sdlc`, `research`, `engineering-iteration` Workflows yet. Roadmap. |
| 218 | `20-pack.md` | Traceability Validator and entity indexing deferred; the `list` Engine callback stays for Relation queries by any Handler or Adapter. |
| 219 | `20-pack.md` | Artifact kinds cut from 14 to the 3 the shipped Workflows touch; `PlanTask`, `ImplementationReport`, `implements-v1`, `verifies-v1` arrive with the engineering Workflows. |
| 220 | `20-pack.md` | No reference `tool` Executor in the pack; the type and `subprocess/v1` support stay. |
| 221 | `20-pack.md` | Local mode human Executor: `cli-human/v1`, terminal prompt when a TTY is attached, file drop in `.persimmon/inbox/<taskRun>.yaml` completed by `persimmon complete <taskRun> --file` otherwise; `review-ui/v1` is server mode (superseded below). |
| 222 | `20-pack.md` | Override port compatibility is checked by the Handler `validate` of Task, Gate, Validator and Workflow against the Global definition of the same name: same port names and types, same required-ness on inputs; code `override_incompatible`. The check runs when the override is written; a later change to the Global definition is not re-checked against its shadows. Found in implementation. |
| 223 | `20-pack.md` | Override must be port-compatible, so a run never breaks at snapshot time on a definition it did not name. |
| 224 | `20-pack.md` | `approve-prd` takes the security and product ReviewReports as optional inputs and context; the `reviews-in` Transition joins with `all` over Succeeded and Failed, so the human reads both reviews, a failed one omitted. The `cli-human/v1` form carries `reading[]`: every context entry with its content, fetched with the call token, so the form stands alone. Found in UAT. |
| 225 | `20-pack.md` | `persimmon init` also applies `namespaced/` into `defaultNamespace`: a user who ran `init` has a working loop without a path into the persimmon checkout. Found in UAT. |
| 226 | `20-pack.md` | `cli-human/v1` is the file drop; the terminal prompt is `persimmon complete <taskRun>` without `--file`, which reads the inbox form and, per output port, asks y/n then findings for a ValidationResult port and edits a YAML example for any other, validated against the port schema. A per-call Adapter process cannot own the terminal, so the prompt lives in the verb. The pack Gate uses `policy: all` over `prd-structure` and `prd-human-review`; `prd-security-scan` joins when `threat-model/v1` ships. Global pack Executors bind Global credential names (`github-token`, `registry-token`). Found in implementation. |
| 227 | `20-pack.md` | `examples/<nn>/` are projects, not packs: hand-written definitions plus a `README.md` the user follows, `persimmon init` run inside the directory, generated state ignored. A pack is installed by `init`; an example is applied by the user, one scenario each. Found in UAT. |
| 228 | `20-pack.md` | Pack content matches the shipped Adapters: `retryOn` names `timeout`, `agent_failed`, `transient_network` (no Adapter emits `rate_limit`); `lint-script` is dropped, its `./scripts/lint.sh` never shipped; `research` declares `workspace: {input: repository}`, else its `file` context read the project's README instead of the repository's. Found in UAT. |
| 229 | `21-composition.md` | Composition kinds are engine-shipped under `persimmon.ai/v1` with builtin Handlers, like Workflow; a pack ships YAML and cannot ship a Handler. The reference placed them in the SDLC pack. |
| 230 | `21-composition.md` | Expansion runs at write (`validate`) and at snapshot; nothing derived is stored as a live Resource. `get Pipeline/x` shows what the user wrote; the run's closure shows what ran. |
| 231 | `21-composition.md` | Pipeline has no `onFailure` routing; the Workflow default (unrouted failure fails the run with the step's error) is the pipeline semantic. Reference listed per-phase failure routing. |
| 232 | `21-composition.md` | `Rollout` stays roadmap (`20-pack.md`). |
| 233 | `21-composition.md` | A composition's KindDefinition may register before its `expansion.kind`; the target is checked at expand time, so shipped and example KindDefinitions load in any order. `stepContract` equality with the target is checked when both are registered. Found in implementation. |
| 234 | `21-composition.md` | The composition Handler validates an expansion with the target kind's schema, a name-taken check against the live store in the same scope, then the target Handler's `validate`; findings are prefixed `<Kind>/<name>: `. `reconcile` is a no-op. Found in implementation. |
| 235 | `21-composition.md` | A live composition used as a step (a Pipeline phase using an Approval) is read through its expansion for the static checker, so `steps.<id>.outputs.result` exists; `HandlerDeps.expand` supplies it. Found in implementation. |
| 236 | `21-composition.md` | A ReviewLoop's expansion reads the `subject` type from `produce`'s definition, live at write and at snapshot: the loop names the port, the definition owns the type. The loop rules (`subject` an output, `previous` and `feedback` optional inputs, `review` a GateRun kind) are checked before expansion, so the finding names the loop field, not a derived Workflow. Found in implementation. |
| 237 | `21-composition.md` | Expansion resolves references in the run's Namespace at snapshot (`expand(resource, namespace)`), the composition's own at write, the same order the walk uses for every hop. A composition that expands through itself is refused by an in-progress guard. Found in UAT (audit). |
| 238 | `21-composition.md` | `GateRun.spec.gateRef` accepts a kind expanding to Gate, as `workflowRef` does: a round whose review was an Approval stalled on `/gateRef/kind must be equal to constant`. The Gate Handler reads the closure by name, so the expansion is found either way. Found in UAT. |
| 239 | `21-composition.md` | `maxRounds` is both the ceiling and an optional loop input the expansion adds: a run that wants one round of a three-round loop asks `maxRounds: 1`; `maxIterations` keeps the ceiling, so a larger value is clamped in `until`, never `iteration_limit`. Found in implementation. |
| 240 | `21-composition.md` | A finding on a ReviewLoop's body is rebased onto `/spec/produce` or `/spec/review`; the outer Workflow's own paths are left as they are and the message names it. Found in implementation. |
| 241 | `22-conformance.md` | The stub replaces the CLI through `configuration.command` under `PERSIMMON_ADAPTER_CONFORMANCE=1`, never by shadowing binaries on `PATH`: a `PATH` the suite writes is a door every process behind it walks through. Found in UAT. |
| 242 | `22-conformance.md` | The suite serves its own callbacks instead of the engine's: a real `publishArtifact` needs a registered artifact kind and a Publication scope owned by a run, and the suite checks the Adapter, not the engine. `putBlob` hashes for real so a digest mismatch would show. |
| 243 | `22-conformance.md` | `command` is absent from every shipped `configurationSchema` on purpose: the engine refuses an Executor that names it at apply, and the runner refuses it without the flag. The suite's flag and cues travel as call options, never as `Adapter.spec.env`, which may not name `PERSIMMON_*` at all. Found in audit. |
| 244 | `22-conformance.md` | Handler and evaluator Roles are not covered: no shipped Adapter has them. Their rules (validate pure, declared Actions only, no-op after terminal; `evaluate` answers a ValidationResult) stay on the roadmap until an Adapter needs them. |
| 245 | `22-conformance.md` | The fixture answer reaches the stub by environment and a live model by the instructions; the live run is one real `execute`, the cheapest proof that the argument mapping works. |
| 246 | `22-conformance.md` | The fixture answer agrees with its context. An answer the context contradicted read as a prompt injection to claude, which answered from the context instead; a value input beside the instructions was copied as `count`. Found in UAT. |
