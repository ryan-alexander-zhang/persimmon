# Runs

status: active · layer: 1 · schema: [`schemas/runs.yaml`](schemas/runs.yaml)

Four Immutable run kinds and the four builtin Handlers that drive them on the reconcile
loop. Everything here is Handler logic, not engine logic.

```text
WorkflowRun (snapshotOnCreate) ──createResource(stepContract.runKind)──▶ child run     inherit snapshot, spec.deadline
      ▲  ChildFinished; outputs read at stepContract paths via getResource     │
      │                                                                        ├─ TaskRun:  callAdapter(execute) ─▶ AdapterFinished ─▶ commitScope
      └────────────────────────────────────────────────────────────────────────┤ GateRun:   ValidationRun × N ─▶ ChildFinished
                                                                               └─ ValidationRun: cel | TaskRun | callAdapter(evaluate)

Phase: Pending ─▶ Running ─▶ (Waiting ⇄ Running) ─▶ Succeeded | Failed | Cancelled      terminal never reverts
```

`Pending` is the phase of a stored run before its first reconcile. Handlers read other
Resources through the Engine callbacks, in process (`02-handler.md`).

## Kinds

All: `mutability: Immutable`, `snapshot: None`, `terminal: {path: status.phase, values:
[Succeeded, Failed, Cancelled]}`, `scope: Namespaced`. WorkflowRun adds `snapshotOnCreate:
true`; the others inherit the parent's snapshot.

| Kind | Handler | spec | status |
|---|---|---|---|
| WorkflowRun | `workflow` | `workflowRef, inputs, timeout?, origin, parent?` | `phase, steps, outputs?, error?, reason?, waitingReason?` |
| TaskRun | `task` | `taskRef, address, deadline, inputs, context` | `phase, attempts[], outputs?, error?, actor?, waitingReason?` |
| GateRun | `gate` | `gateRef, address, deadline, inputs` | `phase, outputs?, error?, validationRuns, waitingReason?` |
| ValidationRun | `validator` | `validatorRef, gateRunRef, name, address, deadline, inputs` | `phase, result?, error?, taskRunRef?, waitingReason?` |

| Field | Rule |
|---|---|
| `origin` | `{kind: manual, actor?}` \| `{kind: trigger, triggerRef, eventId, causationRef?}` \| `{kind: parent}` |
| `parent` | `{workflowRunRef, stepRef, iterationPath}`; required with `origin.kind: parent`, forbidden otherwise |
| `timeout` (WorkflowRun) | optional; overrides the Workflow's `spec.timeout`; clock starts at `creationTimestamp` |
| `address` | the Invocation address: `{workflowRunRef, stepRef, iterationPath, logicalExecutionId}`; `logicalExecutionId` = `<workflowRunName>/<own iteration>/<stepRef>`, double slash when the step has no `repeat` (`11-workflow.md`); a Validator's TaskRun has `stepRef` `<gateStepId>/<validatorName>` |
| `deadline` | absolute RFC 3339, written by the creating Handler as min of the enclosing deadlines (`11-workflow.md`, `12-task.md`, `14-gate.md`) |
| `steps` | `{<stepId>: {phase, runRef?, iteration?, deadline?, error?}}`; one entry per declared step from Created; outputs are read from `runRef` at the used kind's `stepContract` paths, the latest iteration for `repeat` |
| `attempts[]` | `{index ≥ 1, state: running \| succeeded \| failed \| unknown, idempotencyKey, startedAt, finishedAt?, error?, acknowledged?}`; `acknowledged` after a human HumanAck |
| `context` | resolved Context entries (`12-task.md`, `15-prompt-skill.md`) |
| `reason` | the selected terminal's `reason` (`11-workflow.md`) |
| `waitingReason` | free text while `Waiting`; recommended `human`, `child`, `retryBackoff`, `adapter` |

Child names: `<parentRunName>-<stepId>`, plus `-<n>` per `repeat` iteration;
`<gateRunName>-<validatorName lowercased>` for a ValidationRun; `<validationRunName>-task`
for its TaskRun.

## workflow Handler

| Event | Behaviour |
|---|---|
| Created | validate `inputs` against the Workflow's ports; every declared step Pending; `createResource(stepContract.runKind)` per entry step with `snapshot: inherit`, bound `inputs`, `address`, `deadline`; `setTimer(deadline, creationTimestamp + timeout)`; Running |
| ChildFinished | read the child's phase, outputs and error at its `stepContract` paths; record in `steps.<id>`; apply Transition semantics (`11-workflow.md`); create newly activated runs; `repeat`: evaluate `until`, create the next iteration or finish the step |
| TimerFired(deadline) | `cancelResource` every running child; Failed `timeout` |
| CancelRequested | `cancelResource` every running child; Cancelled |

Terminal selection follows `11-workflow.md`; Succeeded evaluates `outputBindings` into
`status.outputs`. A `repeat` body WorkflowRun gets `origin: parent` and `parent`.

## task Handler

| Event | Behaviour |
|---|---|
| Created | resolve `context` (absent optional input dropped; absent required or `file` without `version` → Failed `invalid_input`); `attempts[1] running`; `callAdapter(execute, key: <logicalExecutionId>/1, deadline: min(now + timeout, spec.deadline))`; `setTimer(attempt)`, `setTimer(deadline, spec.deadline)`; Running, or Waiting `human` when the Executor is `type: human` |
| AdapterFinished succeeded, result is HumanAck | `attempts[n].acknowledged`; Waiting `human` |
| AdapterFinished succeeded, result is a TaskResult | validate: exactly the declared outputs, types equal, every artifact in `context.staged` for this key; `commitScope(key)`; `outputs`; Succeeded. Invalid → as failed `schema_violation` |
| AdapterFinished failed, or TimerFired(attempt) | `abandonScope(key)`; `clearTimer(attempt)`; another attempt allowed (`12-task.md`; `timeout` is the attempt's code) → `setTimer(backoff)`, Waiting `retryBackoff`; else Failed with the error |
| AdapterFinished unknown | acknowledged attempt: no-op; else `describe.supports.query` → `callAdapter(query, key: <attempt key>/query/<sequence>)`, mapped per `19-adapter-roles.md`; else failed `unknown_result`, retryable unless `sideEffects: nonIdempotent` |
| TimerFired(backoff) | attempt n+1 as Created |
| TimerFired(deadline) | `callAdapter(cancel, key: <attempt key>/cancel/<sequence>)` if `supports.cancel`; `abandonScope`; Failed `timeout` |
| Signal (human completion) | `context.actor` → `status.actor`; body `{taskResult, publish[]}`; `publishArtifact` per `publish[]` into this reconcile, outputs filled from the returned refs; then validate and Succeeded as for a TaskResult |
| CancelRequested | `callAdapter(cancel)` if `supports.cancel`; `abandonScope`; Cancelled; the cancel answer lands in the RunLog as a later AdapterFinished |

A `human` Executor's `execute` returns HumanAck; the attempt waits for a Signal through the
`signal` callback (`07-adapter.md`) or the deadline. The reconcile that receives the Signal
publishes and commits, so the human Actor lands on every artifact (`05-revisioned-kind.md`).

## gate Handler

| Event | Behaviour |
|---|---|
| Created | `createResource(ValidationRun)` per validator with inputs bound per `14-gate.md`, `address`, `deadline`; `setTimer(deadline, spec.deadline)`; Running |
| ChildFinished | record in `validationRuns.<name>`; all Succeeded → `outputs.result` per `policy`, Succeeded; any Failed → Failed with its error; any Cancelled → Failed `validator_cancelled` |
| TimerFired(deadline) | `cancelResource` remaining; Failed `timeout` |
| CancelRequested | `cancelResource` remaining; Cancelled |

## validator Handler

| evaluator | Behaviour |
|---|---|
| `cel` | Created: `getArtifact` each artifact input; evaluate with the frozen kind schemas; validate the result; Succeeded or Failed `schema_violation`, one reconcile |
| `task` | Created: `createResource(TaskRun)` with the Validator's inputs, `address` from `spec.address`, `deadline`; ChildFinished: `result` = the TaskRun's `resultOutput` value, validated; Succeeded, or Failed with the TaskRun's error |
| `adapter` | Created: `callAdapter(evaluate, key: <logicalExecutionId>/1, deadline)`; AdapterFinished: validate; Succeeded or Failed |

`setTimer(deadline, spec.deadline)` on every path; expiry → Failed `timeout`.
CancelRequested → `cancelResource` or `callAdapter(cancel)`; Cancelled.

## Rules

| Rule | Enforcer |
|---|---|
| a run's `spec` is written once; only its Handler writes `status` | engine (`00-resource.md`) |
| Succeeded only after every declared output is present, type-checked, and committed | run Handler, one reconcile |
| terminal phases never revert; a ChildFinished or AdapterFinished after terminal is a no-op | engine, Handler (`03-reconcile.md`) |
| `statusPatch` is a JSON merge patch; arrays replaced whole | engine (`03-reconcile.md`) |
| `attempts[].idempotencyKey` unique per Resource; a `query` uses a fresh key | `task` Handler |
| `provenance.producerRef` is the Resource owning the Publication scope | engine (`05-revisioned-kind.md`) |

## Decisions

- Builtin Handlers use the Engine callbacks in process (`02-handler.md`); a Handler needs to
  read child runs, artifacts and its Executor.
- Child runs carry an absolute `spec.deadline` set by the creator; the step deadline is
  enforced by the child, not by a per-step timer on the parent.
- Attempt deadline expiry is an attempt failure `timeout` and follows `retryPolicy`; the
  enclosing `deadline` fails the run unconditionally.
- Cancel is immediate: the run is Cancelled in the reconcile that received CancelRequested;
  children are cancelled best effort. Reference waited for children.
- `address` groups the Invocation address fields on TaskRun, GateRun and ValidationRun.
- `steps` is a map keyed by step id without outputs; readers follow `runRef`.
- `approvalGroup` dropped; human quorum is Gate `policy`. `loadedArtifacts` dropped;
  `spec.inputs` already records the exact revisions.
- GateRun records `validationRuns: {<name>: ObjectRef}` and exposes the verdict at
  `status.outputs.result`. ValidationRun `gateRunRef` required.
- Run kind refs other than `workflowRef` are unannotated; they resolve against the inherited
  snapshot.
- `query` after `unknown` uses key `<attempt key>/query/<sequence>`; `cancel` uses
  `<attempt key>/cancel/<sequence>`.
- Human completion is a Signal through the `signal` callback; no `complete` op.
- `TaskRun.status.actor` from the completing Signal's `context.actor` (reference decision 22).
- `WorkflowRun.spec.timeout` and `Trigger.spec.run.timeout` are optional: the `workflow` Handler
  reads the Workflow's `spec.timeout` when the run carries none, so every writer (CLI, Trigger,
  API) inherits it the same way. Found in UAT.
- An attempt's `finishedAt` is the Adapter's answer time (`AdapterFinished.finishedAt`), not the
  delivery time: local mode dispatches the calls of one drain together and delivers their answers
  after the slowest, so a two-second script showed the same end as a one-minute agent. Found in
  UAT.

## Examples

- [`examples/run-workflowrun.yaml`](examples/run-workflowrun.yaml): manual run after both
  steps finished; validates against `#/$defs/WorkflowRun`
- [`examples/run-taskrun.yaml`](examples/run-taskrun.yaml): two attempts, resolved context
  with the optional `file` entry dropped; validates against `#/$defs/TaskRun`
- [`examples/run-gaterun.yaml`](examples/run-gaterun.yaml) and
  [`examples/run-validationrun.yaml`](examples/run-validationrun.yaml): quorum Gate with a
  human ValidationRun; validate against `#/$defs/GateRun`, `#/$defs/ValidationRun`
