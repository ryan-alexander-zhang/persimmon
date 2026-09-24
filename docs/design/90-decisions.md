# Decisions

status: draft · Every deviation from `docs/reference/` and every choice the reference left open, as
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
| 7 | `01-kind-definition.md` | `scope: Any` added for definition kinds, so a pack ships Global definitions that a Namespace overrides by name (reference decision 26). Reference had `Namespaced \| Global`. |
| 8 | `01-kind-definition.md` | `terminal` optional with `handlerRef`. Definition kinds (Workflow, Task) have a Handler for `validate` and never finish. Reference required `terminal` whenever `handlerRef` was set. |
| 9 | `01-kind-definition.md` | `x-persimmon-ref.kinds` optional. Absent means the ref's own `kind` field decides; this is what keeps step kinds open. |
| 10 | `01-kind-definition.md` | `revisioned: true` ⇒ `Immutable`, `Namespaced`, `snapshot: None`, no `statusSchema`. The schema is frozen through `x-persimmon-kind-ref`, not by making revisions closure members. |
| 11 | `01-kind-definition.md` | `subscriptions.filter` is a CEL expression string. Reference left the shape open. |
| 12 | `01-kind-definition.md` | `versions[].statusSchema` optional; absent means `status` is free-form for that version. |
| 13 | `02-handler.md` | Every Handler, builtin or Adapter, reads other Resources only through the Engine callbacks (`07-adapter.md`); builtin Handlers call them in process. Reference gave builtins nothing. |
| 14 | `02-handler.md` | `implementation.adapter` is `{id}` only. Reference carried `transport` here; the Adapter Resource owns it. |
| 15 | `02-handler.md` | No `events[]` filter. Reference let a Handler list wanted Events; a Handler that ignores an Event costs one no-op call, and a filter could drop AdapterFinished or TimerFired the Handler itself caused. |
| 16 | `02-handler.md` | `statusPatch` in the result is the only Handler way to write `status`; the reference's separate `patchStatus` action is dropped (`03-reconcile.md` follows). The engine itself writes `status` of the kinds it registers (`07-adapter.md`). |
| 17 | `02-handler.md` | `context.actor` absent on engine-originated Events (TimerFired, ChildFinished, AdapterFinished); writes of that reconcile carry the Handler's `handler` Actor. Reference did not say. |
| 18 | `02-handler.md` | Static checker is a write-path stage after schema validation, before Handler `validate`. |
| 19 | `02-handler.md` | KindDefinition, Handler, Adapter are registered by the engine at start with no `handlerRef`. |
| 20 | `03-reconcile.md` | Every Event has a fixed `dedupeKey`; the reference named the field without shapes. |
| 21 | `03-reconcile.md` | Signal always carries an `eventId`; API and adapter callers supply one. |
| 22 | `03-reconcile.md` | `callAdapter.adapterId` is the `Adapter.spec.id` string; the reference wrote `adapterRef`. |
| 23 | `03-reconcile.md` | `idempotencyKey` is single-use per Resource. A `query` after `unknown` takes a new key. |
| 24 | `03-reconcile.md` | CancelRequested is delivered once per Resource; a second request is a no-op. |
| 25 | `03-reconcile.md` | `createResource` accepts `owned: false` for ownerless Resources (Trigger-created runs) and is idempotent on an equal existing Resource. |
| 26 | `03-reconcile.md` | `setTimer` with an existing key replaces it. |
| 27 | `03-reconcile.md` | Stalled recovery is any new Event. Reference had no recovery path. |
| 28 | `03-reconcile.md` | `patchStatus` action removed (`02-handler.md`). |
| 29 | `04-snapshot.md` | Bytes carry no run identity and no engine metadata: content-addressed, deduplicated. Reference serialized whole Resources. |
| 30 | `04-snapshot.md` | `uri` is `snapshot://<digest hex>`. Reference left it opaque. Sibling examples updated. |
| 31 | `04-snapshot.md` | Two new annotations, `x-persimmon-kind-ref` and `x-persimmon-adapter`, added to `01-kind-definition.md`. Reference reached artifact kinds and adapter digests without a mechanism. |
| 32 | `04-snapshot.md` | Adapter must answer `describe` at resolution and match its cached digest. Local mode adapters are local subprocesses, so offline still works. |
| 33 | `04-snapshot.md` | `stepContract.runKind` KindDefinitions are frozen too, so a child created mid-run validates against the schema the run was admitted with. |
| 34 | `04-snapshot.md` | Every hop resolves in the root's Namespace, so a Namespaced override of a Global pack definition applies through the whole closure. |
| 35 | `05-revisioned-kind.md` | `metadata.name` is `<id>.r<revision>`; the envelope needs a name and the reference gave none. |
| 36 | `05-revisioned-kind.md` | `id` is required and a DNS label. Reference wrote `id?`; a generated id is not replayable across redelivery. |
| 37 | `05-revisioned-kind.md` | Publish carries `inputs[]`, the source of `provenance.inputs`. Reference had no source. |
| 38 | `05-revisioned-kind.md` | Representations are content-addressed blobs, `blob://<digest>`, uploaded by a `putBlob` callback before publish. Reference used `artifact://<ns>/<id>/<rev>/<name>` and left the upload path open. `CONTEXT.md` and `07-adapter.md` carry the callback. |
| 39 | `05-revisioned-kind.md` | Engine-originated commits stamp the owning Handler's `handler` Actor. Reference left the adapter path without an Actor. |
| 40 | `05-revisioned-kind.md` | Revisioned kinds are `Namespaced` with `snapshot: None`; the schema is frozen through `x-persimmon-kind-ref` (`04-snapshot.md`), not by making revisions closure members. Recorded in `01-kind-definition.md`. |
| 41 | `05-revisioned-kind.md` | Engine supplies the status schema for revisioned kinds; `versions[].statusSchema` is forbidden on them. |
| 42 | `06-outbox.md` | `resource.statusChanged` renamed `resource.finished` and fires only on reaching a terminal value. Reference did not say which status changes count. |
| 43 | `06-outbox.md` | `eventId` includes `time` and `ordinal`, so two emits of one type in one reconcile stay distinct. Reference hashed `(eventKind, subjectRef)` only. |
| 44 | `06-outbox.md` | Causation propagates through `createResource` and ChildFinished, so a publish → Trigger → run → publish loop is caught by the Layer 0 guard. Reference propagated through Signals only. |
| 45 | `06-outbox.md` | Delivery is Namespace-scoped and skips terminal Resources. Reference fanned out to every Resource of the kind. |
| 46 | `06-outbox.md` | Engine-emitted events carry `{kind: service, id: engine}`. |
| 47 | `06-outbox.md` | A committed revision emits `artifact.published` only, not `resource.created`. |
| 48 | `06-outbox.md` | `timer.fired` dropped; TimerFired is a reconcile Event, not a bus concern. |
| 49 | `07-adapter.md` | `signal` is a Layer 0 callback with a long-lived adapter token; the Actor is asserted by the Adapter over its authenticated channel. Reference put `complete` in Layer 1 with no Layer 0 ingress. |
| 50 | `07-adapter.md` | `putBlob` and `getBlob` replace `getRepresentation`; `log` takes text only, bytes go through `putBlob` (`05-revisioned-kind.md`). |
| 51 | `07-adapter.md` | `describe` must return `protocol`, so a wrong-protocol Adapter fails at apply. |
| 52 | `07-adapter.md` | The engine sets `payload.engine`, overwriting a supplied one. Reference had the Handler forward it. |
| 53 | `07-adapter.md` | `callAdapter` gains an optional `deadline` (`03-reconcile.md`); absent means engine default. |
| 54 | `07-adapter.md` | http long operations complete by POSTing to `engine.endpoint/responses`. |
| 55 | `07-adapter.md` | stdio spawns one process per call; no resident-process liveness in the engine. |
| 56 | `07-adapter.md` | `credentialBindings[0]` is the http bearer token. |
| 57 | `07-adapter.md` | `status.describeDigest` stored beside `describe`. Adapter `status` is engine-written, and `Ready` lives in `status.conditions[]`; the reference kept conditions out of `status` for handled kinds (decision 32), an Adapter has no Handler. |
| 58 | `07-adapter.md` | One process per call, so a resident process with liveness handling is roadmap. |
| 59 | `07-adapter.md` | Conformance suite for Adapters and Handlers is roadmap (`91-roadmap.md`). |
| 60 | `08-store.md` | Tokens live in a TokenStore, not CredentialStore; `07-adapter.md` updated. CredentialStore stays read-only for the engine. |
| 61 | `08-store.md` | Reads are authorized by the same Namespace grant as writes. Reference §9 covered writes only. |
| 62 | `08-store.md` | Grants and auth key on the full Actor `{kind, id}`. |
| 63 | `08-store.md` | TLS is mandatory in server mode; no upstream termination in v1. |
| 64 | `08-store.md` | Credential names are Global or `<namespace>/<name>`; a Namespaced Resource binds only its Namespace and Global. |
| 65 | `08-store.md` | `persimmon.yaml` is the one config file; `defaultNamespace`, `defaultCallDeadline`, `leaseTtl` added. |
| 66 | `08-store.md` | Local verbs drain before exit, so a Trigger fires in the command that caused it when no Adapter call is pending. |
| 67 | `08-store.md` | `signal` appends an audit record (`change: signal`, `00-resource.md`). |
| 68 | `08-store.md` | `listRevisions`, `reserveRevision` and Publication scope ops live on ResourceStore; the reference's ArtifactStore and RelationStore are Layer 1 views. |
| 69 | `08-store.md` | Server HTTP API is the verb set; a detailed API spec is roadmap. |
| 70 | `08-store.md` | Authentication is bearer tokens only; OIDC is roadmap. Authorization is the grant table; a policy Resource is roadmap (reference decision 36). |
| 71 | `10-ports.md` | Well-known `ArtifactRef` renamed `RevisionRef` everywhere, including the `$ref` id; `CONTEXT.md` amended. `EntityRef` dropped with entity indexing (`91-roadmap.md`). |
| 72 | `10-ports.md` | Step ids allow `-`. Reference allowed `_` only; every example and `logicalExecutionId` use `-`. |
| 73 | `10-ports.md` | `artifact` PortType carries `artifactKind` with `x-persimmon-kind-ref`, so the snapshot walk freezes the schema. |
| 74 | `10-ports.md` | `fromEvent` reads an engine projection, not the raw Outbox event, because payloads are pointers (`06-outbox.md`). |
| 75 | `10-ports.md` | `Finding.severity` gains `info`. |
| 76 | `10-ports.md` | CEL library: `@marcbachmann/cel-js`. Spike over every expression in `examples/`: it evaluates all of them and its `Environment.check` rejects unknown roots, unknown fields and type errors before any run, which is what static rule 11 needs. `cel-js` lacks the `size()` method form and `startsWith`; `@bufbuild/cel` has no exported checker. Needs `homogeneousAggregateLiterals: false` for the ValidationResult map literal. |
| 77 | `10-ports.md` | Port values bind to CEL by schema type, because a JSON integer bound as `double` makes `inputs.n + 1` a type error in every spec-conformant library. |
| 78 | `10-ports.md` | `inputs` and `outputs` optional on a definition. |
| 79 | `11-workflow.md` | Workflow is `scope: Any` (`01-kind-definition.md`): pack Workflows are Global, overridable by Namespace. |
| 80 | `11-workflow.md` | Mixed `to` lists are legal with `dispatch: first`; the static rule bounds `dispatch: all` only. Reference rule 6 read as a rule on the fired set. |
| 81 | `11-workflow.md` | A Failed outcome is consumed when the step's Transition lists `Failed`; decidable statically, independent of when the Transition fired. |
| 82 | `11-workflow.md` | Every step is `from` of exactly one Transition; the reference allowed none. |
| 83 | `11-workflow.md` | `reason` is snake_case and becomes `error.code` verbatim; optional on Succeeded. |
| 84 | `11-workflow.md` | `join`, `dispatch`, `noMatch` default to `all`, `all`, `fail`. Reference required them. |
| 85 | `11-workflow.md` | Layer 1 codes defined here: `no_match`, `unconsumed_failure`, `output_unbound`, `no_progress`, `iteration_limit`, `timeout` reused from Layer 0. |
| 86 | `11-workflow.md` | `any` and `quorum` never cancel the remaining `from` steps; eager joins are roadmap. |
| 87 | `11-workflow.md` | A Failed Workflow exports no outputs; a business rejection is Succeeded plus a verdict output (reference; kept). No named entrypoints (reference decision 7; kept). |
| 88 | `12-task.md` | No `action.kind` and no `resultProtocol` field. Reference decision 25 removed the first; the second was a constant. |
| 89 | `12-task.md` | `timeout` is per attempt; the enclosing deadline bounds the TaskRun. |
| 90 | `12-task.md` | `permission_denied`, `invalid_input`, `schema_violation` are hard non-retryable, not only barred from `retryOn`. |
| 91 | `12-task.md` | Resolved `skill` entry carries `format`; `19-adapter-roles.md` publishes that shape. Resolved `prompt` entry carries `mediaType`, `content` and `digest`. |
| 92 | `12-task.md` | No context inheritance; every Task states its own context (reference decision 14; kept). |
| 93 | `12-task.md` | `TaskResult.summary` added; logs go through the `log` callback. |
| 94 | `12-task.md` | Attempt indices and `idempotencyKey` suffixes are 1-based. |
| 95 | `12-task.md` | Codes used: `invalid_input`, `schema_violation`, `timeout`, `unknown_result`, `permission_denied` from Layer 0; `adapter_unavailable` as a warning code. |
| 96 | `13-executor.md` | `allowedOperations` and `validateConfig` dropped. Reference listed both; neither had a consumer beyond what `describe.configurationSchema` gives. `CONTEXT.md` updated. |
| 97 | `13-executor.md` | `configuration` and `action.parameters` never merge; a key in both is two keys. |
| 98 | `13-executor.md` | `security` absent means `networkAccess: deny`. |
| 99 | `13-executor.md` | Credentials resolve per attempt, so rotation applies to the next attempt. |
| 100 | `13-executor.md` | Executor is `scope: Any`; a Namespace that wants a pack Executor with its own credentials overrides it by name. |
| 101 | `13-executor.md` | `contextKinds` and `skillFormats` are checked on the Task (`12-task.md`), not here. |
| 102 | `13-executor.md` | `formRenderable` and the human completion contract are owned by `19-adapter-roles.md`. |
| 103 | `13-executor.md` | No unified effort hint; each Adapter defines its own in `configurationSchema`. A cross-adapter hint is roadmap. |
| 104 | `14-gate.md` | GateRun exposes its verdict at `status.outputs.result`, like every step kind. Reference had `status.result`. |
| 105 | `14-gate.md` | `any` and `quorum` count after every ValidationRun finishes; eager termination is roadmap. No Gate-level score aggregation; `ValidationResult.score` is informational. |
| 106 | `14-gate.md` | `evaluator.type` is closed: `cel`, `task`, `adapter`; the Adapter Role is always `evaluator`. Reference let `type` name the Role. |
| 107 | `14-gate.md` | Evaluator Adapters get no `credentials` or `security`; they run on Adapter-level bindings. |
| 108 | `14-gate.md` | Validator inputs are bound per Gate, so one Validator serves many Gates. |
| 109 | `14-gate.md` | `cel` sees `{content, provenance}` per artifact and may return a full ValidationResult. |
| 110 | `14-gate.md` | Gate and Validator inputs exclude `externalResource`: a Validator judges produced facts; a repository check is a `task` Validator whose Task reads the repository. |
| 111 | `14-gate.md` | A ValidationRun exists only under a GateRun in v1. |
| 112 | `14-gate.md` | `resultOutput` needs a `value` port; the ValidationResult `$ref` is recommended, the runtime check is what binds (reference rule 14; kept). |
| 113 | `14-gate.md` | Gate and Validator are `scope: Any`. `validateConfig` dropped for the evaluator Role too. |
| 114 | `14-gate.md` | Demo instance names are free text; `CONTEXT.md` governs design prose, not example names. |
| 115 | `15-prompt-skill.md` | No Skill handler and no engine-side digest check. Reference had a `skill` handler that verified when reachable; one verifier, the Adapter, means one algorithm. Reference open question 3 (Git tree digest) is the Adapter's contract. |
| 116 | `15-prompt-skill.md` | Prompt `mediaType` restricted to `text/*`; delivered in the resolved entry. Reference allowed any and did not deliver it. |
| 117 | `15-prompt-skill.md` | Skill `format` grammar is `<name>/v<n>`, like Adapter ids. |
| 118 | `15-prompt-skill.md` | `source.provider` is open. Reference listed `git \| oci \| https \| file`. |
| 119 | `15-prompt-skill.md` | New Layer 1 code: `skill_digest_mismatch`. |
| 120 | `16-trigger.md` | `spec.on` renamed `spec.event`; bare `on` is a YAML 1.1 boolean. `artifactKind` nested as `{apiVersion, kind}` like a PortType. |
| 121 | `16-trigger.md` | Trigger-created runs are ownerless (`createResource owned: false`, `03-reconcile.md`), so a Trigger stays deletable and receives no ChildFinished. |
| 122 | `16-trigger.md` | `enabled: false` is a Handler check; delivery is kind-level (`06-outbox.md`). Reference had disabled Triggers receive nothing. |
| 123 | `16-trigger.md` | Idempotency by run name `<trigger>-<12 hex>`; a deleted and recreated Trigger does not refire. Reference keyed on `(triggerName, eventId)` without a mechanism. |
| 124 | `16-trigger.md` | `fromEvent: run` dropped; no ObjectRef PortType. Reference had it. |
| 125 | `16-trigger.md` | `workflowRunFinished` matches root runs only. |
| 126 | `16-trigger.md` | Loop guard is the Layer 0 causation chain, per Signal (`06-outbox.md`); the reference's `(triggerName, workflowRef)` count is dropped. |
| 127 | `16-trigger.md` | `trigger.failed` Outbox event replaces the reference's TriggerFailed record. |
| 128 | `16-trigger.md` | No Trigger `terminal`. |
| 129 | `16-trigger.md` | `event.kind` is closed to engine-produced events; external sources and webhooks are roadmap. |
| 130 | `17-runs.md` | Builtin Handlers use the Engine callbacks in process (`02-handler.md`); a Handler needs to read child runs, artifacts and its Executor. |
| 131 | `17-runs.md` | Child runs carry an absolute `spec.deadline` set by the creator; the step deadline is enforced by the child, not by a per-step timer on the parent. |
| 132 | `17-runs.md` | Attempt deadline expiry is an attempt failure `timeout` and follows `retryPolicy`; the enclosing `deadline` fails the run unconditionally. |
| 133 | `17-runs.md` | Cancel is immediate: the run is Cancelled in the reconcile that received CancelRequested; children are cancelled best effort. Reference waited for children. |
| 134 | `17-runs.md` | `address` groups the Invocation address fields on TaskRun, GateRun and ValidationRun. |
| 135 | `17-runs.md` | `steps` is a map keyed by step id without outputs; readers follow `runRef`. |
| 136 | `17-runs.md` | `approvalGroup` dropped; human quorum is Gate `policy`. `loadedArtifacts` dropped; `spec.inputs` already records the exact revisions. |
| 137 | `17-runs.md` | GateRun records `validationRuns: {<name>: ObjectRef}` and exposes the verdict at `status.outputs.result`. ValidationRun `gateRunRef` required. |
| 138 | `17-runs.md` | Run kind refs other than `workflowRef` are unannotated; they resolve against the inherited snapshot. |
| 139 | `17-runs.md` | `query` after `unknown` uses key `<logicalExecutionId>/<n>/query`. |
| 140 | `17-runs.md` | Human completion is a Signal through the `signal` callback; no `complete` op. |
| 141 | `17-runs.md` | `TaskRun.status.actor` from the completing Signal's `context.actor` (reference decision 22). |
| 142 | `18-artifact.md` | No separate ArtifactStore or RelationStore: artifacts and Relations are Resources; queries are `list` with engine-stamped labels. Reference had two stores. |
| 143 | `18-artifact.md` | New Engine callback `list(kind, namespace, labels)` (`07-adapter.md`), so a pack traceability Validator can read Relations. |
| 144 | `18-artifact.md` | `assertedBy` dropped; the audit record of the create carries the Actor. Reference had it as a field. |
| 145 | `18-artifact.md` | The engine writes labels under the reserved `persimmon.ai/` prefix (`00-resource.md`). |
| 146 | `18-artifact.md` | Endpoints are `revision` or `external`; `EntityRef` dropped with entity indexing (`91-roadmap.md`). |
| 147 | `18-artifact.md` | Builtin Handlers assert no Relations in v1; pack kinds and users do. |
| 148 | `18-artifact.md` | Artifact kinds and RelationTypes beyond the examples are pack content (`20-pack.md`). |
| 149 | `18-artifact.md` | No artifact scope (internal versus exported); Workflow output contracts encapsulate, and every revision stays addressable for audit (reference roadmap; kept out). |
| 150 | `19-adapter-roles.md` | `validateConfig` and `complete` removed from the Role op sets; completion is the Layer 0 `signal` callback (`07-adapter.md`, `13-executor.md`). |
| 151 | `19-adapter-roles.md` | Human completion carries content: the Signal body is `{taskResult, publish[]}` and the `task` Handler publishes into its own reconcile. No long-lived call token, and the engine stamps the human Actor because the commit is that reconcile. Reference had the Adapter publish with a call token before `complete`. |
| 152 | `19-adapter-roles.md` | `execute` returns HumanAck for `type: human`; the `task` Handler recognises it and stays Waiting. Layer 0 mapping to AdapterFinished is unchanged. |
| 153 | `19-adapter-roles.md` | `execute` payload reshaped: `task` is `{instructions, parameters, sideEffects, outputs, outputSchemas}`, `taskRun` carries an ObjectRef and the attempt key. Reference nested `action` and sent neither key nor schemas. |
| 154 | `19-adapter-roles.md` | The `query` and `cancel` payloads carry the attempt's `idempotencyKey`; each call itself takes a fresh key (`03-reconcile.md`). `query` `running` re-polls. |
| 155 | `19-adapter-roles.md` | `supports.complete` means "finishes through `signal`" and holds iff `human ∈ executorTypes`. |
| 156 | `19-adapter-roles.md` | `evaluate` receives `artifacts.<port>` as `{content, provenance}`, matching the `cel` environment. |
| 157 | `19-adapter-roles.md` | A standard form-rendering contract for human Adapters is roadmap; v1 renders from `task.outputSchemas` in Adapter-specific ways. Web, chat and email approval clients are Adapters, outside this design. |
| 158 | `19-adapter-roles.md` | A Claude Code Adapter may expose `configuration.agent` to run a repository subagent definition as-is; portable definitions use Prompt and Skill instead. |
| 159 | `20-pack.md` | No pack manifest, version, dependency resolution or `pack` verb: reference roadmap excluded a pack format from v1. A Pack is a directory and `apply`. |
| 160 | `20-pack.md` | No composition kinds. Reference planned `Pipeline`, `ReviewLoop`, `Approval` expanding to Workflows at snapshot time; `repeat` plus a Gate express both, and expansion would need a Layer 0 compile hook. Roadmap. |
| 161 | `20-pack.md` | Deployment out of the v1 lifecycle: no `Rollout`, no `sdlc`, `research`, `engineering-iteration` Workflows yet. Roadmap. |
| 162 | `20-pack.md` | Traceability Validator and entity indexing deferred; the `list` Engine callback stays for Relation queries by any Handler or Adapter. |
| 163 | `20-pack.md` | Artifact kinds cut from 14 to the 3 the shipped Workflows touch; `PlanTask`, `ImplementationReport`, `implements-v1`, `verifies-v1` arrive with the engineering Workflows. |
| 164 | `20-pack.md` | No reference `tool` Executor in the pack; the type and `subprocess/v1` support stay. |
| 165 | `20-pack.md` | Local mode human Executor: `cli-human/v1`, terminal prompt when a TTY is attached, file drop in `.persimmon/inbox/<taskRun>.yaml` completed by `persimmon complete <taskRun> --file` otherwise; `review-ui/v1` is server mode. |
| 166 | `20-pack.md` | Override must be port-compatible, so a run never breaks at snapshot time on a definition it did not name. |
