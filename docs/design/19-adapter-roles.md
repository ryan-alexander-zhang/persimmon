# Adapter roles: executor and evaluator

status: active · layer: 1 · schema: [`schemas/adapter-roles.yaml`](schemas/adapter-roles.yaml)

Part B of `persimmon.adapter/v1`: the two Roles the core kinds bind to. Part A, the envelope,
transports, `handler` Role and Engine callbacks, is `07-adapter.md`.

```text
Executor.spec.adapter ──▶ Adapter role executor:  describe | execute | query | cancel
                                   task Handler ── callAdapter(execute) ──▶ TaskResult | HumanAck | error
                                   human: HumanAck ──▶ later signal(taskRun, actor, {taskResult, publish[]}) ──▶ Handler publishes and commits
Validator.evaluator.adapter ─▶ Adapter role evaluator: describe | evaluate
                                   validator Handler ── callAdapter(evaluate) ──▶ ValidationResult | error
```

## describe

| Field | Role | Required | Rule |
|---|---|---|---|
| `executorTypes[]` | executor | yes | non-empty ⊆ `agent, script, tool, human` |
| `configurationSchema` | both | yes | JSON Schema for `Executor.spec.configuration` or `Validator.evaluator.configuration` |
| `parametersSchema` | executor | yes | JSON Schema for `Task.action.parameters` |
| `contextKinds[]` | executor | yes | ⊆ `file, artifact, prompt, skill` |
| `skillFormats[]` | executor | yes | `Skill.spec.format` values understood |
| `supports` | executor | yes | `{query, cancel, complete}`; `complete` means "finishes through `signal`" and holds iff `human ∈ executorTypes` |
| `formRenderable` | executor | yes | renders an input form from `task.outputSchemas` |

## execute

`callAdapter(execute, payload, idempotencyKey: <logicalExecutionId>/<n>, deadline)` from the
`task` Handler (`17-runs.md`).

| Payload field | Content |
|---|---|
| `taskRun` | `{ref: ObjectRef, logicalExecutionId, idempotencyKey, attempt}` |
| `task` | `{instructions, parameters, sideEffects, outputs: {<port>: OutputSpec}, outputSchemas: {<port>: schema}}`; `outputSchemas` holds the frozen content schema of every artifact output |
| `executor` | `{type, configuration, security}` |
| `inputs` | `{<port>: RuntimeValue}` |
| `context[]` | resolved entries, in order (`12-task.md`, `15-prompt-skill.md`) |
| `deadline` | RFC 3339 |
| `credentials` | `{<name>: secret}` for `security.credentialBindings`; required, `{}` when none |
| `engine` | `{endpoint, token}`; call token |

| Executor type | Result | Then |
|---|---|---|
| `agent`, `script`, `tool` | TaskResult (`12-task.md`) or error; artifacts published with `putBlob` and `publishArtifact` under the call token first | `task` Handler validates and commits |
| `human` | HumanAck `{accepted: true}` | `task` Handler marks the attempt `acknowledged`, stays Waiting `human`; the Adapter later calls `signal(taskRun.ref, eventId, actor, {taskResult, publish[]})` with the adapter token; the Handler publishes each `publish[]` request into its reconcile and fills the outputs from the returned RevisionRefs (`17-runs.md`) |

A human Adapter needs no call token after the ack: content travels in the Signal, bytes go
through `putBlob` with the adapter token, the schema for the form is `task.outputSchemas`.

## query, cancel

| Op | Payload | Result |
|---|---|---|
| `query` | `{logicalExecutionId, idempotencyKey}` of the attempt | `{state, result?, error?}`; `succeeded` carries `result`, `failed` carries `error` |
| `cancel` | same | `{state}` |

| `query` state | `task` Handler |
|---|---|
| `succeeded`, `failed` | as AdapterFinished with that state |
| `running` | Waiting `adapter`; `setTimer(query)` and ask again |
| `unknown` | as AdapterFinished `unknown` without `query` support: `unknown_result` |

`cancel` states are `running`, `succeeded`, `failed`, `unknown`, `cancelled`; the Handler only
records them. An acknowledged human attempt is never queried; restart redelivery of its call
as `unknown` is a no-op.

## evaluate

`callAdapter(evaluate, payload, idempotencyKey: <logicalExecutionId>/1, deadline)` from the
`validator` Handler.

| Payload field | Content |
|---|---|
| `validationRun` | `{ref: ObjectRef, logicalExecutionId, idempotencyKey}` |
| `validator` | `{configuration}` |
| `inputs` | `{<port>: RuntimeValue}` |
| `artifacts` | `{<port>: {content, provenance}}` for artifact inputs |
| `deadline`, `engine` | as `execute` |

Result: a ValidationResult (`10-ports.md`). No `credentials`, no `security` (`14-gate.md`).

## Obligations

| Adapter must | Checked by |
|---|---|
| return exactly the declared outputs with equal types | `task` Handler: `schema_violation` |
| honour `security.networkAccess`, `allowedHosts`, and the `deadline` | Adapter author; conformance suite |
| be idempotent per `idempotencyKey` when `sideEffects: idempotent` | Adapter author |
| verify Skill digests before use; mismatch → `skill_digest_mismatch`, not retryable (`15-prompt-skill.md`) | Adapter author |
| never persist or log `credentials` | Adapter author |
| report `retryable` honestly | Adapter author |
| present `context` entries before `instructions`; no templating of `instructions` | Adapter author |
| `human`: render from `task.outputSchemas`; `signal` with the authenticated Actor | Adapter author; engine refuses `signal` without `actor` |

| Executor type | Minimum `supports` |
|---|---|
| `agent` | `cancel` |
| `script`, `tool` | none |
| `human` | `complete`, `cancel` |

## Decisions

- `validateConfig` and `complete` removed from the Role op sets; completion is the Layer 0
  `signal` callback (`07-adapter.md`, `13-executor.md`).
- Human completion carries content: the Signal body is `{taskResult, publish[]}` and the
  `task` Handler publishes into its own reconcile. No long-lived call token, and the engine
  stamps the human Actor because the commit is that reconcile. Reference had the Adapter
  publish with a call token before `complete`.
- `execute` returns HumanAck for `type: human`; the `task` Handler recognises it and stays
  Waiting. Layer 0 mapping to AdapterFinished is unchanged.
- `execute` payload reshaped: `task` is `{instructions, parameters, sideEffects, outputs,
  outputSchemas}`, `taskRun` carries an ObjectRef and the attempt key. Reference nested
  `action` and sent neither key nor schemas.
- The `query` and `cancel` payloads carry the attempt's `idempotencyKey`; each call itself
  takes a fresh key (`03-reconcile.md`). `query` `running` re-polls.
- `supports.complete` means "finishes through `signal`" and holds iff `human ∈ executorTypes`.
- `evaluate` receives `artifacts.<port>` as `{content, provenance}`, matching the `cel`
  environment.
- A standard form-rendering contract for human Adapters is roadmap; v1 renders from
  `task.outputSchemas` in Adapter-specific ways. Web, chat and email approval clients are
  Adapters, outside this design.
- A Claude Code Adapter may expose `configuration.agent` to run a repository subagent
  definition as-is; portable definitions use Prompt and Skill instead.
- Shipped agent Adapters `claude-code/v1` and `codex/v1` share one runner
  (`adapters/lib/agent.mjs`). One agent process per attempt, prompt is context entries in
  order, value inputs, `instructions`, then the output schemas; the agent answers one JSON
  object `{outputs, summary}` through the CLI's structured output; the Adapter publishes the
  artifact outputs itself under identity `<logicalExecutionId>-<port>` as a DNS label, one
  per logical execution. The agent never sees `engine.token` or the adapter token; task
  credentials reach it as `<NS>__<NAME>` environment. Found in implementation.
- `agent_failed` (retryable) is the Layer 1 code for an agent process that exits non-zero or
  answers no JSON; a publish the engine refuses is `schema_violation`, not retryable; a
  callback refusal is `permission_denied`. Found in implementation.
- Shipped agent Adapters report `skillFormats: []` and refuse `skill` context with
  `invalid_input`; `file` context is a pointer into the working directory, the agent reads it.
  Skill fetching and digest verification are roadmap. `security.networkAccess` and
  `allowedHosts` are not enforced by these Adapters. Found in implementation.
- `subprocess/v1` ships on the same runner: `configuration.program` plus `parameters.args`, the
  execute payload without `credentials` and `engine` on stdin, credentials as environment, and
  the answer `{outputs, summary?}` read from `configuration.resultFile` (relative to the engine
  cwd) and removed; artifact ports carry content, the Adapter publishes. Found in
  implementation.
- `codex/v1` sends the output schema in OpenAI strict form: closed objects, every kept
  property required, optional properties dropped, `format` removed; the prompt states the
  formats. Found in implementation.

## Examples

- [`examples/adapter-roles-execute.yaml`](examples/adapter-roles-execute.yaml): `execute`
  payload for attempt 2 of `write-prd`; validates against `#/$defs/ExecutePayload`
- [`examples/adapter-roles-evaluate.yaml`](examples/adapter-roles-evaluate.yaml): `evaluate`
  payload for the security scan; validates against `#/$defs/EvaluatePayload`
- [`examples/adapter-roles-human.yaml`](examples/adapter-roles-human.yaml): human completion
  flow; validates against `revisioned.yaml#/$defs/Flow`
- Adapter `describe` examples: `adapter-claude-code.yaml`, `adapter-review-ui.yaml`,
  `adapter-subprocess.yaml`, `adapter-threat-model.yaml`
