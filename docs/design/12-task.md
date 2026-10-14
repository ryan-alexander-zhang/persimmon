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
| `inputs`, `outputs` | Ports (`10-ports.md`); an artifact output may carry `id`, a Binding over `inputs` (`literal`, `fromInput`, `expression`) yielding the artifact identity (revisioned `Id`), so a Task names what it publishes (`<spec id>-plan`) and a second run or round publishes the next revision of it; absent, the Adapter names it `<logicalExecutionId>-<port>` |
| `executorRef` | LocalDefinitionRef to an Executor (`x-persimmon-ref`); the only place that says who works |
| `action.instructions` | text; no templating |
| `action.context[]` | ordered Context entries |
| `action.parameters` | object; validated against the Executor's adapter `describe.parametersSchema` |
| `action.workspace` | optional; `{path}` relative to the project directory, or `{input}` naming an `externalResource` input whose `ref.locator.path` is a directory. The attempt's working directory: the agent's cwd and sandbox root, the root `file` context paths point into, a script's cwd and `resultFile` root. Absent: the project directory. `{path}` may leave the project with `..` or an absolute path, and an `{input}` `locator.path` may be absolute; a relative one resolves against the project directory. Local mode: the attempt runs with the engine user's rights wherever it points |
| `timeout` | Duration per attempt |
| `retryPolicy` | optional RetryPolicy; absent means one attempt |
| `sideEffects` | `none` \| `idempotent` \| `nonIdempotent`; `unknown_result` is retried unless `nonIdempotent` |

Step contract: `inputsPath: spec.inputs`, `outputsPath: spec.outputs`, `runKind: TaskRun`,
`phasePath: status.phase`, `outputsValuePath: status.outputs`, `errorPath: status.error`.

The execute payload carries the resolved ids as `task.outputIds: {<port>: Id}` (`19-adapter-roles.md`); on an `artifacts` output the id is the prefix, and the Adapter publishes the list's items as `<prefix>-<n>` in order.

## Context

| kind | Fields | Resolved to (`TaskRun.status.context`, execute payload) | Rule |
|---|---|---|---|
| `file` | `input`, `path` | `{kind, ref: ExternalResourceRef, path}` | `input` is an `externalResource` port; ref carries `version` at run time |
| `artifact` | `input` | `{kind, ref: RevisionRef}`; on an `artifacts` port one entry per ref, in order | `input` is an `artifact` or `artifacts` port |
| `prompt` | `ref` | `{kind, name, mediaType, content, digest}` | LocalDefinitionRef to a Prompt (`15-prompt-skill.md`) |
| `skill` | `ref` | `{kind, name, source, digest, format}` | LocalDefinitionRef to a Skill; `format` ∈ adapter `describe.skillFormats` |

Adapters receive entries in order, then value inputs, then `instructions`, then the answer schema. An entry on an absent optional input
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
| `outputs` | `{<port>: RuntimeValue}`; exactly the declared outputs, types equal; artifacts staged in this attempt's Publication scope (a human completion stages only what its `publish[]` published, never a ref the signal carries) |
| `summary` | optional text for humans |

Anything else fails the attempt with `schema_violation`.

## Rules

| Rule | Enforcer |
|---|---|
| `executorRef`, `prompt.ref`, `skill.ref` resolve | `x-persimmon-ref` (`04-snapshot.md`) |
| the Executor's adapter is reachable and Ready | `13-executor.md` |
| `action.parameters` validates against `describe.parametersSchema` | static checker |
| `action.workspace.input` names an `externalResource` input; at run time its `locator.path` is a string (task Handler) and a directory (Adapter), else `invalid_input` | static checker; task Handler; Adapter |
| `file` context `path` resolves inside `action.workspace`; the entry's `ref` is provenance, not a root | none; stated |
| every `context.kind` ∈ adapter `describe.contextKinds` | static checker |
| `file.input` is an `externalResource` port; `artifact.input` is an `artifact` or `artifacts` port; an `artifacts` output names its `id` prefix and never sits on a human Executor (the form answers one artifact per port) | static checker |
| two artifact outputs of one kind never resolve to one identity: equal ids, or an id that reads as a prefix's `<prefix>-<n>`, fail the attempt `invalid_input` | `task` handler |
| the referenced Skill's `format` ∈ adapter `describe.skillFormats` | static checker |
| `retryOn ∩ abortOn = ∅`; the three never-retried codes ∉ `retryOn` | static checker |
| `outputs.<port>.id` only on an `artifact` or `artifacts` output; its Binding reads `inputs` only and yields a string (an `expression` type-checks against the inputs site; a `literal` is a string; a `fromInput` names a `value` input); at attempt start the value is an `Id` (at most 59 characters on an `artifacts` output, a prefix), else `invalid_input`; the published ref carries that id, and an `artifacts` output's refs are `<prefix>-1`, `<prefix>-2`, ... in list order, else `schema_violation` | static checker; `task` handler |
| `unknown_result` retried unless `sideEffects: nonIdempotent`; `retryPolicy` cannot override | `task` handler (`17-runs.md`) |
| `file` ref without `version` at attempt start | `task` handler: `invalid_input` |

## Decisions

- An artifact output may choose its identity through `outputs.<port>.id`, a Binding over the
  inputs resolved by the engine and handed to the Adapter as `task.outputIds`, because the runner's
  `<logicalExecutionId>-<port>` gave every round, retry and re-run a fresh identity: the rules a
  Prd run writes were never revision 2 of the context's rules, a Plan's second round was not
  revision 2 of the Plan, and no Workflow could find the Spec of a capability by id. The engine,
  not the Adapter, resolves the Binding, so an Adapter publishes a name it was given and the
  handler refuses any other. Found in UAT.

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
- `unknown_result` is retried for `none` and `idempotent`, refused for `nonIdempotent`. The earlier
  rule (only `none`) made `idempotent` behave like `nonIdempotent`, the one place `sideEffects` is
  read; and in local mode a killed engine kills its stdio Adapter and agent, so a resumed call with
  no answer had done nothing, yet an `idempotent` Task failed for good. Found in UAT.
- A Task may output `artifacts`: the output names an id prefix through `outputs.<port>.id`, the
  agent answers a list of contents, the Adapter publishes them in order as `<prefix>-1`,
  `<prefix>-2`, ... and the handler refuses any other id. The prefix is the Task's, never the
  agent's, so a second round republishes the same identities as the next revisions; a shorter list
  leaves the tail at its last revision. One `id` per item was rejected: the engine resolves ids
  before the attempt, when the count is unknown. Needed by `write-architecture`, one Adr per
  strategy decision. Found in UAT.
- Two outputs of one kind with ids that could stage one identity in one attempt (`x` beside the
  prefix `x`, or `x-1` beside it) are refused at attempt start, where every id is resolved; a clash
  with another Task's ids stays unguarded, as it is for a single `artifact`. A human Executor gets
  no `artifacts` output: the inbox form answers one artifact per port and `--file` has no path to a
  list. Found in audit.

## Examples

- [`examples/task-write-prd.yaml`](examples/task-write-prd.yaml): agent Task with four
  Context kinds and a RetryPolicy; also frozen in `snapshot-closure.yaml`
- [`examples/task-approve-prd.yaml`](examples/task-approve-prd.yaml): human Task answering
  a Validator's question with a ValidationResult
- [`examples/task-result.yaml`](examples/task-result.yaml): TaskResult of a `write-prd`
  attempt; validates against `#/$defs/TaskResult`
- [`examples/kind-definition-task.yaml`](examples/kind-definition-task.yaml): the Task
  KindDefinition with its `stepContract` and annotations
