# Persimmon

A Kubernetes-style resource engine that runs a software delivery lifecycle with agents,
humans and scripts as interchangeable workers. Every fact is a versioned Resource; every run
is replayable and auditable; the engine knows no business concept.

```text
YAML definitions ──▶ persimmon run ──▶ WorkflowRun ──▶ TaskRun ──▶ Adapter (Claude Code, Codex, script, human)
   Workflow Task Executor            snapshot frozen      attempts       │
   Gate Validator Prompt Skill                                           ▼
                                                              Artifact revisions, provenance, audit
```

## Shape

| | |
|---|---|
| Form | one binary `persimmon`; local mode on a laptop with SQLite, server mode as a daemon with Postgres; same features in both |
| Input | YAML definitions: Workflow, Task, Executor, Gate, Validator, Prompt, Skill, Trigger |
| Output | artifacts: immutable, numbered revisions with provenance |
| Workers | Adapters, out of process, behind one JSON protocol |
| Language | TypeScript engine; Adapters in any language |
| Users | one developer locally; a team with Namespaces and grants on a server |

## Concepts

1. **Resource**: `apiVersion, kind, metadata, spec, status`. Users write `spec`, Handlers write
   `status`, every write is audited with an Actor.
2. **KindDefinition**: registers a kind with its schema. Shipped kinds and user kinds use the
   same path. Any kind with a `stepContract` can be a Workflow step.
3. **Handler**: pure function `reconcile(resource, event) → status patch + actions`. Decides,
   never does slow work.
4. **Reconcile loop**: one Event in, one transaction out, per Resource, in order. Crash-safe by
   construction.
5. **Snapshot**: a run freezes every definition it depends on by digest. Edits never reach a
   running run.
6. **Artifact**: append-only revisions, staged during an attempt, visible on commit, provenance
   stamped by the engine.
7. **Outbox**: in-database event bus. Triggers react to `artifact.published` and
   `resource.finished`.
8. **Adapter**: out-of-process worker with Roles `handler`, `executor`, `evaluator`. The engine
   validates capability, never interprets behaviour.

Layer 1 in one line each:

- **Workflow**: DAG of Steps and Transitions, typed ports, loops only via `repeat`.
- **Task**: `executorRef` says who, `action` says what, `context` says what to look at.
- **Executor**: agent, script, tool or human behind an Adapter.
- **Gate / Validator**: a Gate decides over Validators by policy; a Validator asks one question.
- **Prompt / Skill**: frozen text and a pinned capability bundle for Task context.
- **Trigger**: creates a run from an Outbox event.
- **Runs**: WorkflowRun, TaskRun with attempts, GateRun, ValidationRun; phases never revert.

## Principles

- Swapping human, agent, script touches one `executorRef`.
- Failed means "could not complete"; a business rejection is Succeeded plus a verdict output.
- Unknown is never success.
- Every reference to produced data is pinned to an exact revision. No implicit latest.
- Framework first: Workflow gets no engine special case.
- Simplest expression: no manifests, no composition kinds, no policy resource in v1.

## Not in v1

No deployment lifecycle, no web UI, no composition kinds, no cross-Namespace references, no
external webhooks. See `docs/design/91-roadmap.md`.

## Quickstart

```sh
npm install && npm run build
node dist/main.js init                          # .persimmon/, persimmon.yaml, shipped Adapters, the SDLC pack
node dist/main.js adapter install <adapter.yaml> # a further Adapter; claude-code/v1, codex/v1, subprocess/v1 and cli-human/v1 ship with init
node dist/main.js create run.yaml --follow       # a WorkflowRun; runs until it reaches a terminal phase
node dist/main.js get WorkflowRun                # phases
node dist/main.js complete <taskRun> --file result.yaml   # answer a human Task from .persimmon/inbox/
```

Every verb runs the engine in process and drains before it exits. `PERSIMMON_DEBUG=1` prints
reconcile errors. Tests: `npm test`; the end-to-end scenario is `test/scenario/prd.test.ts`.

## Read next

- [`DESIGN.md`](DESIGN.md): map of the design, one file per model with schema and examples
- [`CONTEXT.md`](CONTEXT.md): glossary; one canonical term per concept
- [`docs/design/90-decisions.md`](docs/design/90-decisions.md): every decision, by file
