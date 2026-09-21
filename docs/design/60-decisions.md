# Decision Log

Decisions taken on 2026-09-20 while aligning on the core workflow model. Format: decision,
alternatives considered, reason.

| # | Decision | Alternatives | Reason |
|---|---|---|---|
| 1 | Design doc (Persimmon Engineering Resource Model) is the baseline | Research doc recursive DSL as target; merge per topic | Design doc is complete, formally specified and internally consistent; research ideas enter only by explicit decision |
| 2 | First deliverable: DSL schema plus static validator; full design before code | Simulator first; engine MVP first | Requirements are customizable and pluginable; model must be settled before runtime code |
| 3 | Core workflow model first; SDLC domain artifacts next phase | Model everything at once | Keeps scope to definition, runtime, data layers |
| 4 | Three layers: definition, runtime, data, with one-way references | Flat model | Matches the design doc's planes and makes immutability rules enforceable |
| 5 | Step kinds: Task, Workflow, Gate | Task+Workflow only; add Human kind | Gate audit (GateRun) stays first-class; human fits as a Task action |
| 6 | Strict DAG per invocation; loops only via `repeat` | Back-edge transitions; both | Static analysis, explicit rework state, one mechanism |
| 7 | No named entrypoints; compose sub-Workflows | Entrypoints in core; sugar later | Entrypoints add three conditional rules (owner, inputs, bindings) for YAML deduplication that sub-Workflow extraction already provides |
| 8 | `Executor.configuration` opaque, validated by adapter schema | Core `model`/`effort` fields; typed hints | Core stays provider-neutral; no fake unified model API |
| 9 | Phases: Pending, Running, Waiting, Succeeded, Failed, Cancelled; optional `waitingReason` | Add Blocked and reason enum | Fewer states; reason string gives observability |
| 10 | Human-in-the-loop is `action.kind: human` on Task | Approval primitive kind | Composable: human Task plus Gate covers manual, auto and hybrid approval |
| 11 | Two modes, local (CLI + SQLite on a developer machine) and server (long-lived daemon + Postgres on a machine you operate), one engine library and one storage interface. Not Kubernetes, not hosted | Server only; CLI only; library only | Fast local iteration without a second semantics; every feature must work locally |
| 12 | Local mode is crash-resumable | Best effort locally | Same durable state model in both modes |
| 13 | Definitions editable in place; each run freezes a DefinitionSnapshot by sha256 | Explicit immutable versions in refs; both | Simple refs, full reproducibility, no version object sprawl |
| 14 | Execution context is a typed `context` list on Task action: file, artifact, prompt, skill; new Prompt and Skill kinds | Adapter-opaque; add inheritance | Audit must record exactly which context fed a run; inheritance deferred as sugar |
| 15 | Trigger kind with events `artifactPublished`, `workflowRunFinished`; manual and triggered runs identical | Manual only; design only | Event-driven rework without coupling Workflows to their invokers; separate kind keeps Workflow clean |
| 16 | Adapters are out-of-process, speaking `persimmon.adapter/v1` over stdio or http | In-process plugins; both | Language-agnostic, crash-isolated, sandboxable; engine language undecided |
| 17 | Canonical artifact content stored by the engine (SQLite/Postgres); representations in a blob store; Git is export only | Git-backed local store; interface only | One identity model across modes; integer revisions stay meaningful |
| 18 | Implementation language decided later; design stays language-neutral | Python, Go, TypeScript | Protocol-first plugin design makes the choice deferrable |
| 19 | Docs in English Markdown, one file per topic | Chinese; single design doc | Repository language is English |

| 20 | Remove `repeat.timeout`; step `timeout` bounds the loop | Keep both | Two required fields with one meaning; body Workflow already bounds one iteration |
| 21 | `context` allowed on `agent` and `human` actions only | Also `script`; only `agent` | Humans need to see artifacts; scripts and tools consume typed inputs |
| 22 | Engine-set `provenance.actor` on artifacts and `TaskRun.status.actor`, both `{kind, id, display?}` | Actor string; actor only on TaskRun | Validators can only read artifacts; approval must be verifiable from the authenticated actor |
| 23 | Core exposes embedded types as well-known `$ref` schemas for value ports | Inline copies; runtime-only check | Makes the ValidationResult contract visible and checkable |

| 24 | Framework first: Layer 0 is a kind-agnostic resource runtime (KindDefinition, Handler, reconcile loop, actions, events, snapshot, revisioned kinds). Core kinds register through the same path as user kinds | Engine with hard-coded Workflow semantics | Final target is a framework for the whole SDLC plus user kinds; a special-cased engine cannot host either |
| 25 | Task is executor-agnostic: no `action.kind`; executor-specific fields live in `Executor.configuration` or `action.parameters` | Keep `action.kind == Executor.type` | Swapping human ↔ agent ↔ script must not touch the Task or the Workflow. "A Gate decides, a Validator asks, the Executor answers" |
| 26 | Built-in SDLC pack is a first-class deliverable (Layer 2), shipped as global (no namespace) definitions overridable by namespace-local name shadowing | Example set only; namespace-local only | Same relationship as Deployment to Kubernetes; users start from a working lifecycle |
| 27 | Artifact kinds are `KindDefinition {revisioned: true}`; `ArtifactSchema` kind retired | Keep ArtifactSchema as a separate meta-kind | One registration path for every kind; framework owns identity/revision/provenance generically |
| 28 | Triggers are a Layer 1 kind built on framework event subscriptions; the framework knows events, not triggers | Trigger logic in the engine | Keeps Layer 0 kind-agnostic |

| 29 | Adapters are registered as a global (no namespace) `Adapter` resource mapping id → transport + command/url + roles; `describe` cached in status | Config file; implicit PATH lookup | Every reference validates at admission; snapshots can pin the adapter's describe digest; same path in local and cloud |

| 30 | `KindDefinition.stepContract` makes any kind usable as a Workflow step; the closed `uses.kind` enum is removed | Hard-code Task/Workflow/Gate; add pack kinds to the enum later | Pack and user kinds (ReviewLoop, Pipeline, Approval) must compose without engine changes; the abstraction test demands it |
| 31 | `executorRef` override at Task invocation sites (WorkflowStep, Gate validators) | Duplicate Tasks/Validators per executor | One review Task, N reviewers; who reviews is an Executor choice, not a Task copy |

Superseded: decision 21 (context per action kind) by 25 + adapter `contextKinds`.

Open decisions carried into `70-roadmap.md`.
