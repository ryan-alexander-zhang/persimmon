# Task

status: active · layer: 1 · schema: [`schemas/task.yaml`](schemas/task.yaml)

A Definition kind: one unit of work, executor-agnostic. Who does it is the Executor; what to
do is `action`. Runs as a TaskRun (`17-runs.md`).

```text
Task ── executorRef ──▶ Executor ── adapter ──▶ Adapter (role: executor, 19-adapter-roles.md)
  │
  ├─ inputs / outputs ─────── typed ports (10-ports.md)
  ├─ action.instructions ──── what to do, in words
  ├─ action.context[] ─────── file | artifact | prompt | skill, injected in order
  ├─ action.parameters ────── adapter-specific, validated by describe.parametersSchema
  ├─ timeout, retryPolicy ─── per attempt budget and retry loop (17-runs.md)
  └─ sideEffects ──────────── none | idempotent | nonIdempotent
```

## Spec

| Field | Rule |
|---|---|
| `inputs`, `outputs` | Ports (`10-ports.md`) |
| `executorRef` | LocalDefinitionRef to an Executor (`x-persimmon-ref`); the only place that says who works |
| `action.instructions` | text; no templating |
| `action.context[]` | ordered Context entries |
| `action.parameters` | object; validated against the Executor's adapter `describe.parametersSchema` |
| `action.workspace` | optional; `{path}` relative to the project directory, or `{input}` naming an `externalResource` input whose `ref.locator.path` is a directory. The attempt's working directory: the agent's cwd and sandbox root, the root `file` context paths point into, a script's cwd and `resultFile` root. Absent: the project directory |
| `timeout` | Duration per attempt |
| `retryPolicy` | optional RetryPolicy; absent means one attempt |
| `sideEffects` | `none` \| `idempotent` \| `nonIdempotent`; `unknown_result` is retried only with `none` |

Step contract: `inputsPath: spec.inputs`, `outputsPath: spec.outputs`, `runKind: TaskRun`,
`phasePath: status.phase`, `outputsValuePath: status.outputs`, `errorPath: status.error`.

## Context

| kind | Fields | Resolved to (`TaskRun.spec.context`, execute payload) | Rule |
|---|---|---|---|
| `file` | `input`, `path` | `{kind, ref: ExternalResourceRef, path}` | `input` is an `externalResource` port; ref carries `version` at run time |
| `artifact` | `input` | `{kind, ref: RevisionRef}` | `input` is an `artifact` port |
| `prompt` | `ref` | `{kind, name, mediaType, content, digest}` | LocalDefinitionRef to a Prompt (`15-prompt-skill.md`) |
| `skill` | `ref` | `{kind, name, source, digest, format}` | LocalDefinitionRef to a Skill; `format` ∈ adapter `describe.skillFormats` |

Adapters receive entries in order, then `instructions`. An entry on an absent optional input
is dropped; on an absent required input the attempt fails with `invalid_input`. Inputs not
listed stay fetchable through `getArtifact`, not injected.

## RetryPolicy

| Field | Rule |
|---|---|
| `maxAttempts` | ≥ 1; includes the first |
| `backoff` | `{strategy: fixed \| linear \| exponential, initial, max, jitter?: none \| full}`; `jitter` default `none` |
| `retryOn[]` | optional; error codes that always start another attempt |
| `abortOn[]` | optional; error codes that fail the TaskRun at once |

A code in neither list follows the error's `retryable`. `permission_denied`,
`invalid_input`, `schema_violation` are never retried.

## Deadlines

| Deadline | Value |
|---|---|
| attempt | `min(now + timeout, enclosing)` |
| enclosing, Task used as a Step | the Step's effective deadline (`11-workflow.md`) |
| enclosing, Task used by a Validator | the ValidationRun's deadline (`14-gate.md`) |

## TaskResult

What an attempt returns, `persimmon.result/v1`.

| Field | Rule |
|---|---|
| `protocol` | `persimmon.result/v1` |
| `outputs` | `{<port>: RuntimeValue}`; exactly the declared outputs, types equal; artifacts staged in this attempt's Publication scope |
| `summary` | optional text for humans |

Anything else fails the attempt with `schema_violation`.

## Rules

| Rule | Enforcer |
|---|---|
| `executorRef`, `prompt.ref`, `skill.ref` resolve | `x-persimmon-ref` (`04-snapshot.md`) |
| the Executor's adapter is reachable and Ready | `13-executor.md` |
| `action.parameters` validates against `describe.parametersSchema` | static checker |
| `action.workspace.input` names an `externalResource` input; at run time its `locator.path` is a directory, else `invalid_input` | static checker; task Handler |
| every `context.kind` ∈ adapter `describe.contextKinds` | static checker |
| `file.input` is an `externalResource` port; `artifact.input` is an `artifact` port | static checker |
| the referenced Skill's `format` ∈ adapter `describe.skillFormats` | static checker |
| `retryOn ∩ abortOn = ∅`; the three never-retried codes ∉ `retryOn` | static checker |
| `unknown_result` retried only when `sideEffects: none`; `retryPolicy` cannot override | `task` handler (`17-runs.md`) |
| `file` ref without `version` at attempt start | `task` handler: `invalid_input` |

## Decisions

- No `action.kind` and no `resultProtocol` field. Reference decision 25 removed the first;
  the second was a constant.
- `timeout` is per attempt; the enclosing deadline bounds the TaskRun.
- The static checker rules run inside the `task` Handler's `validate`, reading the Executor and
  the Adapter `describe` live; an unreachable Adapter skips them, the Executor reports it. Found
  in implementation.
- `permission_denied`, `invalid_input`, `schema_violation` are hard non-retryable, not only
  barred from `retryOn`.
- Resolved `skill` entry carries `format`; `19-adapter-roles.md` publishes that shape.
  Resolved `prompt` entry carries `mediaType`, `content` and `digest`.
- No context inheritance; every Task states its own context (reference decision 14; kept).
- `TaskResult.summary` added; logs go through the `log` callback.
- Attempt indices and `idempotencyKey` suffixes are 1-based.
- Codes used: `invalid_input`, `schema_violation`, `timeout`, `unknown_result`,
  `permission_denied` from Layer 0; `adapter_unavailable` as a warning code.
- `action.workspace` names where an attempt works. Without it the agent inherited the engine's cwd,
  so a coder run from a subdirectory of a checkout found that checkout's `.git` and `AGENTS.md`
  and committed to it. The workspace is the Task's, not the Executor's: it is what the work
  touches, not who does it; an Executor-level cap is roadmap. Found in UAT.

## Examples

- [`examples/task-write-prd.yaml`](examples/task-write-prd.yaml): agent Task with four
  Context kinds and a RetryPolicy; also frozen in `snapshot-closure.yaml`
- [`examples/task-approve-prd.yaml`](examples/task-approve-prd.yaml): human Task answering
  a Validator's question with a ValidationResult
- [`examples/task-result.yaml`](examples/task-result.yaml): TaskResult of a `write-prd`
  attempt; validates against `#/$defs/TaskResult`
- [`examples/kind-definition-task.yaml`](examples/kind-definition-task.yaml): the Task
  KindDefinition with its `stepContract` and annotations
