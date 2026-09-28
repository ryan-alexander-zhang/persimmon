# Decisions

status: active · Every deviation from `docs/reference/` and every choice the reference left open, as
recorded in the `## Decisions` section of each design file. This file is the index; the design
file is the source.

```text
docs/design/00–08  Layer 0   ─┐
docs/design/10–19  Layer 1   ─┼─▶ ## Decisions bullets ─▶ this table, in file order
docs/design/20     Layer 2   ─┘
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
| 33 | `04-snapshot.md` | Bytes carry no run identity and no engine metadata: content-addressed, deduplicated. Reference serialized whole Resources. |
| 34 | `04-snapshot.md` | `uri` is `snapshot://<digest hex>`. Reference left it opaque. Sibling examples updated. |
| 35 | `04-snapshot.md` | Two new annotations, `x-persimmon-kind-ref` and `x-persimmon-adapter`, added to `01-kind-definition.md`. Reference reached artifact kinds and adapter digests without a mechanism. |
| 36 | `04-snapshot.md` | Adapter must answer `describe` at resolution and match its cached digest. Local mode adapters are local subprocesses, so offline still works. |
| 37 | `04-snapshot.md` | `stepContract.runKind` KindDefinitions are frozen too, so a child created mid-run validates against the schema the run was admitted with. |
| 38 | `04-snapshot.md` | Every hop resolves in the root's Namespace, so a Namespaced override of a Global pack definition applies through the whole closure. |
| 39 | `04-snapshot.md` | At resolution the walk checks the Adapter is Ready and records its cached `describeDigest`; it does not call `describe` again. Re-describing on every walk is roadmap. Found in implementation. |
| 40 | `05-revisioned-kind.md` | `metadata.name` is `<id>.r<revision>`; the envelope needs a name and the reference gave none. |
| 41 | `05-revisioned-kind.md` | `id` is required and a DNS label. Reference wrote `id?`; a generated id is not replayable across redelivery. |
| 42 | `05-revisioned-kind.md` | Publish carries `inputs[]`, the source of `provenance.inputs`. Reference had no source. |
| 43 | `05-revisioned-kind.md` | Representations are content-addressed blobs, `blob://<digest>`, uploaded by a `putBlob` callback before publish. Reference used `artifact://<ns>/<id>/<rev>/<name>` and left the upload path open. `CONTEXT.md` and `07-adapter.md` carry the callback. |
| 44 | `05-revisioned-kind.md` | Engine-originated commits stamp the owning Handler's `handler` Actor. Reference left the adapter path without an Actor. |
| 45 | `05-revisioned-kind.md` | Revisioned kinds are `Namespaced` with `snapshot: None`; the schema is frozen through `x-persimmon-kind-ref` (`04-snapshot.md`), not by making revisions closure members. Recorded in `01-kind-definition.md`. |
| 46 | `05-revisioned-kind.md` | Engine supplies the status schema for revisioned kinds; `versions[].statusSchema` is forbidden on them. |
| 47 | `06-outbox.md` | `resource.statusChanged` renamed `resource.finished` and fires only on reaching a terminal value. Reference did not say which status changes count. |
| 48 | `06-outbox.md` | `eventId` includes `time` and `ordinal`, so two emits of one type in one reconcile stay distinct. Reference hashed `(eventKind, subjectRef)` only. |
| 49 | `06-outbox.md` | Causation propagates through `createResource` and ChildFinished, so a publish → Trigger → run → publish loop is caught by the Layer 0 guard. Reference propagated through Signals only. |
| 50 | `06-outbox.md` | Delivery is Namespace-scoped and skips terminal Resources. Reference fanned out to every Resource of the kind. |
| 51 | `06-outbox.md` | Engine-emitted events carry `{kind: service, id: engine}`. |
| 52 | `06-outbox.md` | A committed revision emits `artifact.published` only, not `resource.created`. |
| 53 | `06-outbox.md` | `timer.fired` dropped; TimerFired is a reconcile Event, not a bus concern. |
| 54 | `07-adapter.md` | `signal` is a Layer 0 callback with a long-lived adapter token; the Actor is asserted by the Adapter over its authenticated channel. Reference put `complete` in Layer 1 with no Layer 0 ingress. |
| 55 | `07-adapter.md` | `putBlob` and `getBlob` replace `getRepresentation`; `log` takes text only, bytes go through `putBlob` (`05-revisioned-kind.md`). |
| 56 | `07-adapter.md` | `describe` must return `protocol`, so a wrong-protocol Adapter fails at apply. |
| 57 | `07-adapter.md` | The engine sets `payload.engine`, overwriting a supplied one. Reference had the Handler forward it. |
| 58 | `07-adapter.md` | `callAdapter` gains an optional `deadline` (`03-reconcile.md`); absent means engine default. |
| 59 | `07-adapter.md` | http long operations complete by POSTing to `engine.endpoint/responses`. |
| 60 | `07-adapter.md` | stdio spawns one process per call; no resident-process liveness in the engine. |
| 61 | `07-adapter.md` | `credentialBindings[0]` is the http bearer token. |
| 62 | `07-adapter.md` | `status.describeDigest` stored beside `describe`. Adapter `status` is engine-written, and `Ready` lives in `status.conditions[]`; the reference kept conditions out of `status` for handled kinds (decision 32), an Adapter has no Handler. |
| 63 | `07-adapter.md` | One process per call, so a resident process with liveness handling is roadmap. |
| 64 | `07-adapter.md` | Conformance suite for Adapters and Handlers is roadmap (`91-roadmap.md`). |
| 65 | `07-adapter.md` | stdio environment is an allowlist: `PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`, `NODE_PATH`, `NODE_OPTIONS`, then `spec.env`, bound credentials and the adapter token. `USER` is needed for macOS keychain logins. Found in implementation. |
| 66 | `07-adapter.md` | Stream `log` lines are appended to the RunLog entry that issued the call, beside the `log` callback; `waiting` lines are not stored, the Handler owns `waitingReason`. Found in implementation. |
| 67 | `07-adapter.md` | A `publishArtifact` the engine refuses (content, blob, shape) answers `400 invalid_input`, not `500`. Found in implementation. |
| 68 | `07-adapter.md` | The callbacks socket moves to the temp directory, keyed by cwd, when the project path is too long for `sun_path`. Found in implementation. |
| 69 | `08-store.md` | Tokens live in a TokenStore, not CredentialStore; `07-adapter.md` updated. CredentialStore stays read-only for the engine. |
| 70 | `08-store.md` | Reads are authorized by the same Namespace grant as writes. Reference §9 covered writes only. |
| 71 | `08-store.md` | Grants and auth key on the full Actor `{kind, id}`. |
| 72 | `08-store.md` | TLS is mandatory in server mode; no upstream termination in v1. |
| 73 | `08-store.md` | Credential names are Global or `<namespace>/<name>`; a Namespaced Resource binds only its Namespace and Global. |
| 74 | `08-store.md` | `persimmon.yaml` is the one config file; `defaultNamespace`, `defaultCallDeadline`, `leaseTtl` added. |
| 75 | `08-store.md` | Local verbs drain before exit, so a Trigger fires in the command that caused it when no Adapter call is pending. |
| 76 | `08-store.md` | `signal` appends an audit record (`change: signal`, `00-resource.md`). |
| 77 | `08-store.md` | `listRevisions`, `reserveRevision` and Publication scope ops live on ResourceStore; the reference's ArtifactStore and RelationStore are Layer 1 views. |
| 78 | `08-store.md` | Server HTTP API is the verb set; a detailed API spec is roadmap. |
| 79 | `08-store.md` | Authentication is bearer tokens only; OIDC is roadmap. Authorization is the grant table; a policy Resource is roadmap (reference decision 36). |
| 80 | `08-store.md` | `env` credential names are upper case with `-` as `_`: `demo/github-token` reads `PERSIMMON_CRED_DEMO__GITHUB_TOKEN`. Found in implementation. |
| 81 | `08-store.md` | `keychain` reads the macOS keychain: `security find-generic-password -s persimmon -a <name> -w`, one lookup per name per process, exit 44 (not found) and a missing binary mean absent, any other failure (locked keychain) is an error. `secretManager` resolves nothing until server mode. Found in implementation. |
| 82 | `08-store.md` | `persimmon complete` has two modes. Interactive, the default at a terminal: prints what the human reads, asks `approve? [y/n]` and findings one per line for a ValidationResult port, an example shaped by the schema for any other port, validates every answer before the Signal. Scripted: `--file <result.yaml>`, no prompts; required when no terminal is attached. Found in UAT. |
| 83 | `08-store.md` | Local mode has one live engine per project: `listen` takes `.persimmon/engine.lock` (pid, stale when the process is gone) and a second write verb fails with the holder's pid. Read verbs (`get`, `describe`, `logs`, `validate`) open the store without the socket, without call recovery and without a drain, so they are safe beside a running `--follow`. Found in UAT. |
| 84 | `08-store.md` | `persimmon run` is sugar over `create`: it writes the WorkflowRun the user would have written, nothing more; `--follow` reports owned runs by walking `ownerReferences`. Found in implementation. |
| 85 | `08-store.md` | `defaultNamespace` fills a `Namespaced` kind on the write path; a `scope: Any` Resource written without a Namespace is Global (`00-resource.md`). The CLI places its own docs in `-n` or `defaultNamespace` unless `--global`; `persimmon init` and `apply --global` install a pack as Global (`20-pack.md`). CLI refs resolve Namespace first, then Global. Found in implementation. |
| 86 | `08-store.md` | A WorkflowRun written without `timeout` takes its Workflow's `spec.timeout`; the CLI's old 24h default cut a 52h Workflow short. Found in UAT. |
| 87 | `08-store.md` | `--follow` returns, exit 0, when every TaskRun the run owns is finished or waits on a human and at least one waits: the engine has nothing to do until `complete`. It prints `parked on you: persimmon complete <taskRun>` per parked Task. Found in UAT. |
| 88 | `10-ports.md` | The execute payload carries every value port schema with its `$ref`s inlined from the design files, so an Adapter or a human form reads it alone. Found in implementation. |
| 89 | `10-ports.md` | Well-known `ArtifactRef` renamed `RevisionRef` everywhere, including the `$ref` id; `CONTEXT.md` amended. `EntityRef` dropped with entity indexing (`91-roadmap.md`). |
| 90 | `10-ports.md` | Step ids allow `-`. Reference allowed `_` only; every example and `logicalExecutionId` use `-`. |
| 91 | `10-ports.md` | `artifact` PortType carries `artifactKind` with `x-persimmon-kind-ref`, so the snapshot walk freezes the schema. |
| 92 | `10-ports.md` | `fromEvent` reads an engine projection, not the raw Outbox event, because payloads are pointers (`06-outbox.md`). |
| 93 | `10-ports.md` | `Finding.severity` gains `info`. |
| 94 | `10-ports.md` | CEL library: `@marcbachmann/cel-js`. Spike over every expression in `examples/`: it evaluates all of them and its `Environment.check` rejects unknown roots, unknown fields and type errors before any run, which is what static rule 11 needs. `cel-js` lacks the `size()` method form and `startsWith`; `@bufbuild/cel` has no exported checker. Needs `homogeneousAggregateLiterals: false` for the ValidationResult map literal. |
| 95 | `10-ports.md` | Port values bind to CEL by schema type, because a JSON integer bound as `double` makes `inputs.n + 1` a type error in every spec-conformant library. |
| 96 | `10-ports.md` | `inputs` and `outputs` optional on a definition. |
| 97 | `11-workflow.md` | Workflow is `scope: Any` (`01-kind-definition.md`): pack Workflows are Global, overridable by Namespace. |
| 98 | `11-workflow.md` | Mixed `to` lists are legal with `dispatch: first`; the static rule bounds `dispatch: all` only. Reference rule 6 read as a rule on the fired set. |
| 99 | `11-workflow.md` | A Failed outcome is consumed when the step's Transition lists `Failed`; decidable statically, independent of when the Transition fired. |
| 100 | `11-workflow.md` | Every step is `from` of exactly one Transition; the reference allowed none. |
| 101 | `11-workflow.md` | `reason` is snake_case and becomes `error.code` verbatim; optional on Succeeded. |
| 102 | `11-workflow.md` | `join`, `dispatch`, `noMatch` default to `all`, `all`, `fail`. Reference required them. |
| 103 | `11-workflow.md` | Layer 1 codes defined here: `no_match`, `unconsumed_failure`, `output_unbound`, `no_progress`, `iteration_limit`, `timeout` reused from Layer 0. |
| 104 | `11-workflow.md` | `any` and `quorum` never cancel the remaining `from` steps; eager joins are roadmap. |
| 105 | `11-workflow.md` | A Failed Workflow exports no outputs; a business rejection is Succeeded plus a verdict output (reference; kept). No named entrypoints (reference decision 7; kept). |
| 106 | `11-workflow.md` | The `stepContract` names no child `spec` shape, so the `workflow` Handler builds TaskRun, GateRun and WorkflowRun specs itself and gives any other run kind the TaskRun shape with `<kind>Ref`. A contract field for the child shape is roadmap. Found in implementation. |
| 107 | `11-workflow.md` | A Transition counts as fired once any of its `to` steps has a run, even one another Transition started; a step that is `to` of two Transitions therefore fires the second one at most through its own guard. Recording fired Transitions in `status` is roadmap. Found in implementation. |
| 108 | `11-workflow.md` | `logicalExecutionId` is `<runName>/<own iteration>/<stepId>`: the child run of a repeat body is named `<parent>-<step>-<n>`, so repeating the enclosing `iterationPath` doubled it in artifact ids (`...-rounds-1-rounds-1-implement-report`). `address.iterationPath` keeps the full path. Found in UAT. |
| 109 | `12-task.md` | No `action.kind` and no `resultProtocol` field. Reference decision 25 removed the first; the second was a constant. |
| 110 | `12-task.md` | `timeout` is per attempt; the enclosing deadline bounds the TaskRun. |
| 111 | `12-task.md` | The static checker rules run inside the `task` Handler's `validate`, reading the Executor and the Adapter `describe` live; an unreachable Adapter skips them, the Executor reports it. Found in implementation. |
| 112 | `12-task.md` | `permission_denied`, `invalid_input`, `schema_violation` are hard non-retryable, not only barred from `retryOn`. |
| 113 | `12-task.md` | Resolved `skill` entry carries `format`; `19-adapter-roles.md` publishes that shape. Resolved `prompt` entry carries `mediaType`, `content` and `digest`. |
| 114 | `12-task.md` | No context inheritance; every Task states its own context (reference decision 14; kept). |
| 115 | `12-task.md` | `TaskResult.summary` added; logs go through the `log` callback. |
| 116 | `12-task.md` | Attempt indices and `idempotencyKey` suffixes are 1-based. |
| 117 | `12-task.md` | Codes used: `invalid_input`, `schema_violation`, `timeout`, `unknown_result`, `permission_denied` from Layer 0; `adapter_unavailable` as a warning code. |
| 118 | `13-executor.md` | `allowedOperations` and `validateConfig` dropped. Reference listed both; neither had a consumer beyond what `describe.configurationSchema` gives. `CONTEXT.md` updated. |
| 119 | `13-executor.md` | `configuration` and `action.parameters` never merge; a key in both is two keys. |
| 120 | `13-executor.md` | `security` absent means `networkAccess: deny`. |
| 121 | `13-executor.md` | Credentials resolve per attempt, so rotation applies to the next attempt. |
| 122 | `13-executor.md` | Executor is `scope: Any`; a Namespace that wants a pack Executor with its own credentials overrides it by name. |
| 123 | `13-executor.md` | `contextKinds` and `skillFormats` are checked on the Task (`12-task.md`), not here. |
| 124 | `13-executor.md` | `formRenderable` and the human completion contract are owned by `19-adapter-roles.md`. |
| 125 | `13-executor.md` | No unified effort hint; each Adapter defines its own in `configurationSchema`. A cross-adapter hint is roadmap. |
| 126 | `13-executor.md` | A credential that does not resolve at dispatch fails the attempt as AdapterFinished `permission_denied`, not retryable; the engine never throws. Found in implementation. |
| 127 | `14-gate.md` | GateRun exposes its verdict at `status.outputs.result`, like every step kind. Reference had `status.result`. |
| 128 | `14-gate.md` | `any` and `quorum` count after every ValidationRun finishes; eager termination is roadmap. No Gate-level score aggregation; `ValidationResult.score` is informational. |
| 129 | `14-gate.md` | `evaluator.type` is closed: `cel`, `task`, `adapter`; the Adapter Role is always `evaluator`. Reference let `type` name the Role. |
| 130 | `14-gate.md` | Evaluator Adapters get no `credentials` or `security`; they run on Adapter-level bindings. |
| 131 | `14-gate.md` | Validator inputs are bound per Gate, so one Validator serves many Gates. |
| 132 | `14-gate.md` | `cel` sees `{content, provenance}` per artifact and may return a full ValidationResult. |
| 133 | `14-gate.md` | Gate and Validator inputs exclude `externalResource`: a Validator judges produced facts; a repository check is a `task` Validator whose Task reads the repository. |
| 134 | `14-gate.md` | A ValidationRun exists only under a GateRun in v1. |
| 135 | `14-gate.md` | `resultOutput` needs a `value` port; the ValidationResult `$ref` is recommended, the runtime check is what binds (reference rule 14; kept). |
| 136 | `14-gate.md` | Gate and Validator are `scope: Any`. `validateConfig` dropped for the evaluator Role too. |
| 137 | `14-gate.md` | Demo instance names are free text; `CONTEXT.md` governs design prose, not example names. |
| 138 | `15-prompt-skill.md` | No Skill handler and no engine-side digest check. Reference had a `skill` handler that verified when reachable; one verifier, the Adapter, means one algorithm. Reference open question 3 (Git tree digest) is the Adapter's contract. |
| 139 | `15-prompt-skill.md` | Prompt `mediaType` restricted to `text/*`; delivered in the resolved entry. Reference allowed any and did not deliver it. |
| 140 | `15-prompt-skill.md` | Skill `format` grammar is `<name>/v<n>`, like Adapter ids. |
| 141 | `15-prompt-skill.md` | `source.provider` is open. Reference listed `git \| oci \| https \| file`. |
| 142 | `15-prompt-skill.md` | New Layer 1 code: `skill_digest_mismatch`. |
| 143 | `15-prompt-skill.md` | Bundle digest for a directory, as the shipped agent Adapters compute it: sha256 over every regular file in sorted posix-path order, each fed as `<path>\0<bytes>\0`, `.git` excluded. `git` sources are fetched once per (remote, version) into `.persimmon/skills/<hash>`; `file` sources resolve `locator.path` against the engine cwd. A bundle holding anything but regular files and directories is refused; `locator.remote` is an https, ssh, git or file URL, an scp-style address or an absolute path, `version` a commit or ref name, so git never reads an option or an `ext::` transport from a Skill. Closes reference open question 3. Found in implementation. |
| 144 | `16-trigger.md` | `spec.on` renamed `spec.event`; bare `on` is a YAML 1.1 boolean. `artifactKind` nested as `{apiVersion, kind}` like a PortType. |
| 145 | `16-trigger.md` | Trigger-created runs are ownerless (`createResource owned: false`, `03-reconcile.md`), so a Trigger stays deletable and receives no ChildFinished. |
| 146 | `16-trigger.md` | `enabled: false` is a Handler check; delivery is kind-level (`06-outbox.md`). Reference had disabled Triggers receive nothing. |
| 147 | `16-trigger.md` | Idempotency by run name `<trigger>-<12 hex>`; a deleted and recreated Trigger does not refire. Reference keyed on `(triggerName, eventId)` without a mechanism. |
| 148 | `16-trigger.md` | `fromEvent: run` dropped; no ObjectRef PortType. Reference had it. |
| 149 | `16-trigger.md` | `workflowRunFinished` matches root runs only. |
| 150 | `16-trigger.md` | Loop guard is the Layer 0 causation chain, per Signal (`06-outbox.md`); the reference's `(triggerName, workflowRef)` count is dropped. |
| 151 | `16-trigger.md` | `trigger.failed` Outbox event replaces the reference's TriggerFailed record. |
| 152 | `16-trigger.md` | No Trigger `terminal`. |
| 153 | `16-trigger.md` | `event.kind` is closed to engine-produced events; external sources and webhooks are roadmap. |
| 154 | `17-runs.md` | Builtin Handlers use the Engine callbacks in process (`02-handler.md`); a Handler needs to read child runs, artifacts and its Executor. |
| 155 | `17-runs.md` | Child runs carry an absolute `spec.deadline` set by the creator; the step deadline is enforced by the child, not by a per-step timer on the parent. |
| 156 | `17-runs.md` | Attempt deadline expiry is an attempt failure `timeout` and follows `retryPolicy`; the enclosing `deadline` fails the run unconditionally. |
| 157 | `17-runs.md` | Cancel is immediate: the run is Cancelled in the reconcile that received CancelRequested; children are cancelled best effort. Reference waited for children. |
| 158 | `17-runs.md` | `address` groups the Invocation address fields on TaskRun, GateRun and ValidationRun. |
| 159 | `17-runs.md` | `steps` is a map keyed by step id without outputs; readers follow `runRef`. |
| 160 | `17-runs.md` | `approvalGroup` dropped; human quorum is Gate `policy`. `loadedArtifacts` dropped; `spec.inputs` already records the exact revisions. |
| 161 | `17-runs.md` | GateRun records `validationRuns: {<name>: ObjectRef}` and exposes the verdict at `status.outputs.result`. ValidationRun `gateRunRef` required. |
| 162 | `17-runs.md` | Run kind refs other than `workflowRef` are unannotated; they resolve against the inherited snapshot. |
| 163 | `17-runs.md` | `query` after `unknown` uses key `<logicalExecutionId>/<n>/query`. |
| 164 | `17-runs.md` | Human completion is a Signal through the `signal` callback; no `complete` op. |
| 165 | `17-runs.md` | `TaskRun.status.actor` from the completing Signal's `context.actor` (reference decision 22). |
| 166 | `18-artifact.md` | No separate ArtifactStore or RelationStore: artifacts and Relations are Resources; queries are `list` with engine-stamped labels. Reference had two stores. |
| 167 | `18-artifact.md` | New Engine callback `list(kind, namespace, labels)` (`07-adapter.md`), so a pack traceability Validator can read Relations. |
| 168 | `18-artifact.md` | `assertedBy` dropped; the audit record of the create carries the Actor. Reference had it as a field. |
| 169 | `18-artifact.md` | The engine writes labels under the reserved `persimmon.ai/` prefix (`00-resource.md`). |
| 170 | `18-artifact.md` | Endpoints are `revision` or `external`; `EntityRef` dropped with entity indexing (`91-roadmap.md`). |
| 171 | `18-artifact.md` | Builtin Handlers assert no Relations in v1; pack kinds and users do. |
| 172 | `18-artifact.md` | Artifact kinds and RelationTypes beyond the examples are pack content (`20-pack.md`). |
| 173 | `18-artifact.md` | No artifact scope (internal versus exported); Workflow output contracts encapsulate, and every revision stays addressable for audit (reference roadmap; kept out). |
| 174 | `19-adapter-roles.md` | `validateConfig` and `complete` removed from the Role op sets; completion is the Layer 0 `signal` callback (`07-adapter.md`, `13-executor.md`). |
| 175 | `19-adapter-roles.md` | Human completion carries content: the Signal body is `{taskResult, publish[]}` and the `task` Handler publishes into its own reconcile. No long-lived call token, and the engine stamps the human Actor because the commit is that reconcile. Reference had the Adapter publish with a call token before `complete`. |
| 176 | `19-adapter-roles.md` | `execute` returns HumanAck for `type: human`; the `task` Handler recognises it and stays Waiting. Layer 0 mapping to AdapterFinished is unchanged. |
| 177 | `19-adapter-roles.md` | `execute` payload reshaped: `task` is `{instructions, parameters, sideEffects, outputs, outputSchemas}`, `taskRun` carries an ObjectRef and the attempt key. Reference nested `action` and sent neither key nor schemas. |
| 178 | `19-adapter-roles.md` | The `query` and `cancel` payloads carry the attempt's `idempotencyKey`; each call itself takes a fresh key (`03-reconcile.md`). `query` `running` re-polls. |
| 179 | `19-adapter-roles.md` | `supports.complete` means "finishes through `signal`" and holds iff `human ∈ executorTypes`. |
| 180 | `19-adapter-roles.md` | `evaluate` receives `artifacts.<port>` as `{content, provenance}`, matching the `cel` environment. |
| 181 | `19-adapter-roles.md` | A standard form-rendering contract for human Adapters is roadmap; v1 renders from `task.outputSchemas` in Adapter-specific ways. Web, chat and email approval clients are Adapters, outside this design. |
| 182 | `19-adapter-roles.md` | A Claude Code Adapter may expose `configuration.agent` to run a repository subagent definition as-is; portable definitions use Prompt and Skill instead. |
| 183 | `19-adapter-roles.md` | Shipped agent Adapters `claude-code/v1` and `codex/v1` share one runner (`adapters/lib/agent.mjs`). One agent process per attempt, prompt is context entries in order, value inputs, `instructions`, then the output schemas; the agent answers one JSON object `{outputs, summary}` through the CLI's structured output; the Adapter publishes the artifact outputs itself under identity `<logicalExecutionId>-<port>` as a DNS label, one per logical execution. The agent never sees `engine.token` or the adapter token; task credentials reach it as `<NS>__<NAME>` environment. Found in implementation. |
| 184 | `19-adapter-roles.md` | `agent_failed` (retryable) is the Layer 1 code for an agent process that exits non-zero or answers no JSON; a publish the engine refuses is `schema_violation`, not retryable; a callback refusal is `permission_denied`. Found in implementation. |
| 185 | `19-adapter-roles.md` | Shipped agent Adapters read `claude-code-skill/v1` Skills: a directory with `SKILL.md`, fetched and verified per `15-prompt-skill.md`, handed to `claude` with `--add-dir` and named in the prompt; `file` context is a pointer into the working directory, the agent reads it. `codex/v1` maps `security.networkAccess` to `sandbox_workspace_write.network_access`, closed unless `allowlist`, and refuses `deny` with `sandbox: full` since the bypass ignores the switch; `allowedHosts` and the claude sandbox network are not enforced by these Adapters. Found in implementation. |
| 186 | `19-adapter-roles.md` | `subprocess/v1` ships on the same runner: `configuration.program` plus `parameters.args`, the execute payload without `credentials` and `engine` on stdin, credentials as environment, and the answer `{outputs, summary?}` read from `configuration.resultFile` (relative to the engine cwd) and removed; artifact ports carry content, the Adapter publishes. Found in implementation. |
| 187 | `19-adapter-roles.md` | `codex/v1` sends the output schema in OpenAI strict form: closed objects, every kept property required, optional properties dropped, `format` removed; the prompt states the formats. Found in implementation. |
| 188 | `19-adapter-roles.md` | Agent output streams to the RunLog as `log` lines while the process runs: every whole line of stderr, and of stdout when the driver marks it a transcript (`codex/v1`, whose answer is a file; `claude-code/v1` answers on stdout, so only its stderr streams). Credentials redacted, at most 5000 lines per attempt (a coding agent's transcript with tool output runs past 500), the last one says so. `persimmon logs` shows what the agent did after a success too. Found in UAT. |
| 189 | `20-pack.md` | No pack manifest, version, dependency resolution or `pack` verb: reference roadmap excluded a pack format from v1. A Pack is a directory and `apply`. |
| 190 | `20-pack.md` | No composition kinds. Reference planned `Pipeline`, `ReviewLoop`, `Approval` expanding to Workflows at snapshot time; `repeat` plus a Gate express both, and expansion would need a Layer 0 compile hook. Roadmap. |
| 191 | `20-pack.md` | Deployment out of the v1 lifecycle: no `Rollout`, no `sdlc`, `research`, `engineering-iteration` Workflows yet. Roadmap. |
| 192 | `20-pack.md` | Traceability Validator and entity indexing deferred; the `list` Engine callback stays for Relation queries by any Handler or Adapter. |
| 193 | `20-pack.md` | Artifact kinds cut from 14 to the 3 the shipped Workflows touch; `PlanTask`, `ImplementationReport`, `implements-v1`, `verifies-v1` arrive with the engineering Workflows. |
| 194 | `20-pack.md` | No reference `tool` Executor in the pack; the type and `subprocess/v1` support stay. |
| 195 | `20-pack.md` | Local mode human Executor: `cli-human/v1`, terminal prompt when a TTY is attached, file drop in `.persimmon/inbox/<taskRun>.yaml` completed by `persimmon complete <taskRun> --file` otherwise; `review-ui/v1` is server mode. |
| 196 | `20-pack.md` | Override port compatibility is checked by the Handler `validate` of Task, Gate, Validator and Workflow against the Global definition of the same name: same port names and types, same required-ness on inputs; code `override_incompatible`. The check runs when the override is written; a later change to the Global definition is not re-checked against its shadows. Found in implementation. |
| 197 | `20-pack.md` | Override must be port-compatible, so a run never breaks at snapshot time on a definition it did not name. |
| 198 | `20-pack.md` | `approve-prd` takes the security and product ReviewReports as optional inputs and context; the `reviews-in` Transition joins with `all` over Succeeded and Failed, so the human reads both reviews, a failed one omitted. The `cli-human/v1` form carries `reading[]`: every context entry with its content, fetched with the call token, so the form stands alone. Found in UAT. |
| 199 | `20-pack.md` | `persimmon init` also applies `namespaced/` into `defaultNamespace`: a user who ran `init` has a working loop without a path into the persimmon checkout. Found in UAT. |
| 200 | `20-pack.md` | `cli-human/v1` is the file drop; the terminal prompt is `persimmon complete <taskRun>` without `--file`, which reads the inbox form and asks one YAML answer per output port, validated against the port schema. A per-call Adapter process cannot own the terminal, so the prompt lives in the verb. The pack Gate uses `policy: all` over `prd-structure` and `prd-human-review`; `prd-security-scan` joins when `threat-model/v1` ships. Global pack Executors bind Global credential names (`github-token`, `registry-token`). Found in implementation. |
| 201 | `20-pack.md` | [`examples/pack-task-global.yaml`](examples/pack-task-global.yaml) and [`examples/pack-task-override.yaml`](examples/pack-task-override.yaml): a Global pack Task and its port-compatible Namespace override; both validate against `schemas/task.yaml` |
| 202 | `20-pack.md` | pack members: every example named in the content table |
| 203 | `20-pack.md` | `examples/<nn>/` are projects, not packs: hand-written definitions plus a `README.md` the user follows, `persimmon init` run inside the directory, generated state ignored. A pack is installed by `init`; an example is applied by the user, one scenario each. Found in UAT. |
