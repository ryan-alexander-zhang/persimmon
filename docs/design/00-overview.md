# Persimmon: Overview

Status: accepted high-level design, revised 2026-09-20 (framework-first). Decisions in
`60-decisions.md`.

## Goal

A framework that executes an entire software delivery lifecycle as declared resources. The
framework itself knows nothing about PRDs, gates, agents or releases. It knows resources,
kinds, handlers, runs, events, snapshots and adapters. Everything with business meaning is a
kind registered on top of it, including the kinds Persimmon ships.

## Layers

```text
Layer 3  User kinds + handlers            LATER   same registration path as Layer 1
Layer 2  SDLC pack                        LATER   pre-installed instances of Layer 1 kinds
Layer 1  Core kinds                       SHAPE   Workflow Task Gate Validator Executor
                                                  Prompt Skill Trigger, artifact kinds
Layer 0  Framework                        NOW     kind-agnostic resource runtime
```

Dependency runs downward only. Layer 0 must not reference any Layer 1 kind by name.

**Test of the abstraction:** Workflow, Task, Gate and the rest must be registrable through
the same `KindDefinition` + `Handler` path a user would use for their own kind. If a Layer 1
kind needs an engine special case, Layer 0 is wrong and gets fixed there.

## Layer 0 in one paragraph

Resources have a uniform envelope (`apiVersion`, `kind`, `metadata`, `spec`, `status`). A
`KindDefinition` registers a kind with its schema, scope, mutability and snapshot behaviour.
A `Handler` binds kinds to code: built in, an out-of-process adapter, or a declarative
Workflow. The engine stores resources, validates them, records every mutation with its
authenticated actor, freezes definition closures into digest-addressed snapshots, and drives
handlers through a serialized per-resource reconcile loop fed by an event log. Handlers act
only through engine actions (create child, patch status, publish artifact, emit event, set
timer, call adapter, cancel). One engine library, two frontends: local CLI with SQLite, cloud
API server with Postgres.

## Principles

1. Framework first. No business kind is special to the engine.
2. Every reference to produced data is immutable and revision-pinned. No implicit latest.
3. Definitions may change; running work uses a frozen, digest-addressed snapshot.
4. Handlers are idempotent and stateless between calls; all state is in resources and the log.
5. Adapters run out of process behind one versioned protocol. Provider details never leak in.
6. Every mutation carries an authenticated actor. Users write `spec`; handlers write `status`.
7. Every feature works in local mode. Cloud adds scale and tenancy, not semantics.
8. Failure is explicit. Unknown is never success. Terminal states never revert.

## Documents

| File | Layer | Content |
|---|---|---|
| `05-framework.md` | 0 | Resource model, KindDefinition, Handler, reconcile loop, actions, events, snapshot, refs, auth, storage |
| `10-core-kinds-definitions.md` | 1 | Workflow, Task, Executor, Gate, Validator, Prompt, Skill, Trigger as kinds on the framework |
| `20-core-kinds-runs.md` | 1 | WorkflowRun, TaskRun, GateRun, ValidationRun and the Workflow handler's semantics |
| `30-artifact-kinds.md` | 1 | Revisioned kinds, artifact envelope, publication, relations |
| `40-plugin-protocol.md` | 0 | `persimmon.adapter/v1`: executor, evaluator, handler, eventSource roles |
| `50-modes.md` | 0 | Local and cloud modes, storage interface |
| `60-decisions.md` | – | Decision log |
| `70-roadmap.md` | 2, 3 | SDLC pack, user kinds, explicitly deferred items |

Read in that order.
