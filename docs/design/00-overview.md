# Persimmon Core Workflow Model: Overview

Status: accepted high-level design, 2026-09-20. Source decisions in `60-decisions.md`.

## Goal

A durable, auditable workflow engine for AI-assisted software delivery. Workflows are
declared in YAML. Steps are executed by interchangeable executors: AI agents, scripts, tools,
humans. Progress is gated by validators whose verdicts are recorded as evidence. Every run is
reproducible from an immutable definition snapshot and immutable artifact references.

The baseline is the Persimmon Engineering Resource Model (see `docs/reference`). This design
keeps its semantics and adds what is needed for a customizable, pluginable system that runs
locally and in the cloud.

## Principles

1. Definition, runtime and data are separate layers with one-way references.
2. Every reference to data is immutable and revision-pinned. No implicit latest.
3. Control flow comes only from Transitions. Data flow comes only from Bindings.
4. A single invocation is a DAG. Iteration is explicit (`repeat`) with typed state.
5. The engine is provider-neutral. Adapters own everything provider-specific.
6. Every core feature must work in local mode. Cloud mode adds scale, not semantics.
7. Audit is a core promise: which definition, which inputs, which context, which adapter,
   which outputs, who approved.
8. Failure is explicit. Cannot-verify is never treated as pass. Terminal phases never revert.

## Layers

```text
+--------------------------------------------------------------+
| Definition layer          what CAN run                       |
| Workflow Task Executor Gate Validator Prompt Skill Trigger   |
| ArtifactSchema RelationType                                  |
+--------------------------------------------------------------+
        | referenced only through DefinitionSnapshot (sha256)
        v
+--------------------------------------------------------------+
| Runtime layer             what IS running                    |
| WorkflowRun TaskRun GateRun ValidationRun StepExecution      |
| phases deadlines idempotency keys event log resume           |
+--------------------------------------------------------------+
        | reads/writes only through ArtifactRef / ExternalResourceRef
        v
+--------------------------------------------------------------+
| Data layer                what WAS produced                  |
| DomainArtifact revisions Relation provenance representations |
+--------------------------------------------------------------+
```

Reference rules:
- Definition never references Runtime.
- Runtime references Definition only through a snapshot digest.
- Both reference Data only through revision-pinned refs.
- Data references Runtime only in provenance (`producerRunRef`, `assertedBy`).

## Kinds

| Kind | Layer | Origin |
|---|---|---|
| Workflow, Task, Executor, Gate, Validator | Definition | design doc |
| ArtifactSchema, RelationType | Definition (data typing) | design doc |
| Prompt, Skill | Definition | new: execution context |
| Trigger | Definition | new: event-driven runs |
| WorkflowRun, TaskRun, GateRun, ValidationRun | Runtime | design doc |
| Relation, DomainArtifact (per registered kind) | Data | design doc |

Fifteen API kinds plus domain artifact kinds registered through ArtifactSchema.

## Scope of this phase

In scope: the core workflow model across three layers, the adapter protocol, the local/cloud
mode split, the static validation rules. First deliverable is the DSL schema plus a static
validator; no execution engine yet.

Deferred (see `70-deferred.md`): the 14 SDLC domain artifact kinds, entity indexing, SDLC
relations, rollout/fencing semantics, entrypoint sugar, context inheritance, eager join, UI.

## Reading order

`10-definition-layer.md` → `20-runtime-layer.md` → `30-data-layer.md` →
`40-plugin-protocol.md` → `50-modes.md` → `60-decisions.md` → `70-deferred.md`.
