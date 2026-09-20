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
| 11 | Two modes, local (CLI + SQLite) and cloud (API server + controller), one engine library and one storage interface | Server only; CLI only; library only | Fast local iteration without a second semantics; every feature must work locally |
| 12 | Local mode is crash-resumable | Best effort locally | Same durable state model in both modes |
| 13 | Definitions editable in place; each run freezes a DefinitionSnapshot by sha256 | Explicit immutable versions in refs; both | Simple refs, full reproducibility, no version object sprawl |
| 14 | Execution context is a typed `context` list on Task action: file, artifact, prompt, skill; new Prompt and Skill kinds | Adapter-opaque; add inheritance | Audit must record exactly which context fed a run; inheritance deferred as sugar |
| 15 | Trigger kind with events `artifactPublished`, `workflowRunFinished`; manual and triggered runs identical | Manual only; design only | Event-driven rework without coupling Workflows to their invokers; separate kind keeps Workflow clean |
| 16 | Adapters are out-of-process, speaking `persimmon.adapter/v1` over stdio or http | In-process plugins; both | Language-agnostic, crash-isolated, sandboxable; engine language undecided |
| 17 | Canonical artifact content stored by the engine (SQLite/Postgres); representations in a blob store; Git is export only | Git-backed local store; interface only | One identity model across modes; integer revisions stay meaningful |
| 18 | Implementation language decided later; design stays language-neutral | Python, Go, TypeScript | Protocol-first plugin design makes the choice deferrable |
| 19 | Docs in English Markdown, one file per topic | Chinese; single design doc | Repository language is English |

Open decisions carried into `70-deferred.md`.
