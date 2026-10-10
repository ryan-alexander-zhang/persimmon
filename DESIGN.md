# Design

Map of `docs/design/`. Product shape: `README.md`. Code map: `ARCHITECTURE.md`. Terms per `CONTEXT.md`. Baseline: `docs/reference/`.

```text
Layer 3  User kinds        docs/design/3x-*      LATER
Layer 2  SDLC pack         docs/design/2x-*      NOW
Layer 1  Core kinds        docs/design/1x-*      NOW
Layer 0  Framework         docs/design/0x-*      NOW
```

Read top to bottom within a layer; a file depends only on files above it.

## Conventions

- One model per file: `NN-<name>.md` + `schemas/<name>.yaml` (JSON Schema 2020-12, YAML) +
  `examples/<name>-*.yaml`. The markdown links both.
- Diagram first, then fields, then rules. One sentence per idea.
- `status`: `draft` | `active`. Code follows `active` only.

## Layer 0: framework

| File | Content | Status |
|---|---|---|
| `docs/design/00-resource.md` | Envelope, Namespace, Global, Actor, four Reference shapes, write order, audit, delete | active |
| `docs/design/01-kind-definition.md` | KindDefinition: schema, scope, mutability, snapshot, terminal, stepContract, subscriptions | active |
| `docs/design/02-handler.md` | Handler: kinds, implementation, events; `validate` / `reconcile` contract | active |
| `docs/design/03-reconcile.md` | Event set, Action set, RunLog, lease, atomic commit, retry, stalled | active |
| `docs/design/04-snapshot.md` | Closure walk, canonical bytes, digest, inherit vs new | active |
| `docs/design/05-revisioned-kind.md` | Identity, revision, provenance, representations, Publication scope | active |
| `docs/design/06-outbox.md` | Outbox event, subscription, causation chain, loop guard | active |
| `docs/design/07-adapter.md` | Adapter resource, `persimmon.adapter/v1` part A, handler Role, Engine callbacks | active |
| `docs/design/08-store.md` | Store interface, local and server Mode, credentials, authorization | active |

## Layer 1: core kinds

| File | Content | Status |
|---|---|---|
| `docs/design/10-ports.md` | Port, PortType, RuntimeValue, Binding, expression profile, well-known `$ref`, Duration | active |
| `docs/design/11-workflow.md` | Workflow, Step, Transition, Repeat, static rules | active |
| `docs/design/12-task.md` | Task, Context, RetryPolicy, TaskResult | active |
| `docs/design/13-executor.md` | Executor, security, credential bindings | active |
| `docs/design/14-gate.md` | Gate, Validator, GateResult, ValidationResult | active |
| `docs/design/15-prompt-skill.md` | Prompt, Skill | active |
| `docs/design/16-trigger.md` | Trigger, event kinds, `fromEvent` | active |
| `docs/design/17-runs.md` | WorkflowRun, TaskRun, GateRun, ValidationRun, Phase, Attempt, handler semantics | active |
| `docs/design/18-artifact.md` | Artifact kind, Relation, RelationType, storage, retention | active |
| `docs/design/19-adapter-roles.md` | `persimmon.adapter/v1` part B: executor and evaluator Roles | active |

## Layer 2: SDLC pack

| File | Content | Status |
|---|---|---|
| `docs/design/20-pack.md` | Pack as a directory, lifecycle, override by name, SDLC pack content | active |
| `docs/design/21-composition.md` | Pipeline, Approval, ReviewLoop: sugar kinds expanding to Workflow and Gate | active |

## Cross-cutting

| File | Content | Status |
|---|---|---|
| `docs/design/90-decisions.md` | Decision log | active |
| `docs/design/91-roadmap.md` | Deferred items, open questions | active |
