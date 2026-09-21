# Layer 1: Core Run Kinds and the Workflow Handler

Run kinds are `KindDefinition {mutability: Immutable, snapshot: None, terminal: {path:
status.phase, values: [Succeeded, Failed, Cancelled]}}`. WorkflowRun adds `snapshotOnCreate:
true`; the others are created by handlers through `createResource` and inherit the parent's
snapshot. `status` is written only by the owning handler. This document describes the run kinds and the semantics the built-in `workflow`,
`task`, `gate` and `validator` handlers implement on top of the framework's reconcile loop
(`05-framework.md` §4–5). Everything below is handler logic, not engine logic.

Mapping to framework primitives: a step becomes a child resource (`createResource`);
completion arrives as `ChildFinished`; repeat rounds are new children; retries are attempts
inside one TaskRun; adapter calls are `callAdapter` + `AdapterFinished`; human completion is
`Signal`; deadlines are `setTimer`; artifact outputs are published by the adapter into the
attempt's scope and made visible by `commitScope`; the snapshot is resolved by the framework
when the WorkflowRun is stored (`snapshotOnCreate`) and inherited by children.

## Kinds

| Kind | One per | Key spec fields | Key status fields |
|---|---|---|---|
| WorkflowRun | invocation | workflowRef, inputs, timeout, origin, parent? | phase, steps[], outputs, error, reason, waitingReason |
| TaskRun | step invocation | taskRef, workflowRunRef, stepRef, iterationPath, logicalExecutionId, inputs, context | phase, attempts[], outputs, error, logs, actor? |
| GateRun | gate evaluation | gateRef, workflowRunRef, inputs | phase, result, validationRunRefs |
| ValidationRun | validator execution | validatorRef, gateRunRef?, inputs | phase, result, loadedArtifacts, taskRunRefs |

The snapshot is `metadata.snapshot` on every run (framework §7), not a spec field.

Additions to the design doc:

- `WorkflowRun.spec.origin`: `{kind: manual, actor?: Actor}`,
  `{kind: trigger, triggerRef: ObjectRef, eventId: string, causationRef?: ObjectRef}`, or
  `{kind: parent}` for body runs of `repeat` and sub-Workflow steps. Runs are otherwise identical.
- `WorkflowRun.spec.parent`: `{workflowRunRef: ObjectRef, stepRef: string, iterationPath:
  IterationAddress}`. Required when `origin.kind: parent`, forbidden otherwise. Child runs
  inherit the parent's `metadata.snapshot` (framework §7); nothing is re-resolved for children.
- `WorkflowRun.status.reason`: the `reason` of the selected terminal, set on Succeeded and
  Failed. For a terminal Failed the workflow handler also sets
  `error = {code: <reason>, message: "terminal Failed selected by transition <id>", retryable: false}`,
  so a parent can route on `steps.<child>.error.code`.
- `Actor` = `{kind: user | service, id: string, display?: string}`. Set by the engine from the
  adapter's authenticated channel; never taken from a TaskResult body.
- `TaskRun.status.attempts[]`: `{index, state: running | succeeded | failed | unknown,
  idempotencyKey, startedAt, finishedAt?, error?, approvalGroup?}`. Owned by the `task` handler.
- `TaskRun.status.actor`: the Actor that completed a `human` attempt.
- `TaskRun.spec.context`: the resolved context list (file refs with version, ArtifactRefs,
  Prompt name plus content digest, Skill name plus bundle digest). Proves what the adapter saw.
- `status.waitingReason` (optional string) on every Run kind, set while phase is Waiting.
  Recommended values: `human`, `child`, `retryBackoff`, `adapter`. Free text allowed.

## Phases

`Pending → Running → (Waiting ↔ Running) → Succeeded | Failed | Cancelled`.
`Skipped` exists only on `StepExecution`. Terminal phases never change. Succeeded requires
outputs/result; other phases forbid them. Failed requires `error`; other phases forbid it.

## Snapshot

WorkflowRun is registered with `snapshotOnCreate: true`, so the framework resolves the
definition closure when the run is stored, whoever stores it (user, Trigger handler, or a
parent run). The closure is the Workflow, every reachable sub-Workflow, Task, Executor, Gate,
Validator, Prompt, Skill, revisioned KindDefinition and RelationType, reached by walking
`x-persimmon-ref` fields (framework §7). It lands in `metadata.snapshot` before `Created` is
delivered. Child runs (TaskRun, GateRun, ValidationRun, body WorkflowRuns of `repeat`) inherit
it. Reading a snapshot verifies the digest; a mismatch or unreachable URI fails the run, never
falls back to current definitions.

## Identity of executions

- Invocation address: `workflowRunName / iterationPath / stepRef`.
- `logicalExecutionId` = that address; it is the TaskRun's identity.
- Attempt `idempotencyKey` = `logicalExecutionId/<attempt index>`. It keys the `callAdapter`
  and therefore the attempt's publication scope (framework §5, §8).
- A new `repeat` iteration is a new address, therefore a new TaskRun.

## Task attempts

The `task` handler owns the retry loop inside one TaskRun:

1. `Created`: append `attempts[0] {state: running}`, issue
   `callAdapter(executor.adapter, execute, payload, idempotencyKey)`, `setTimer(deadline)`.
2. `AdapterFinished {state: succeeded}`: validate the TaskResult and every declared output
   (artifacts must have been staged into this attempt's scope); on success `commitScope(key)`,
   set outputs, phase Succeeded. A TaskResult that fails validation is treated as `failed`
   with `schema_violation`.
3. `AdapterFinished {state: failed}`: `abandonScope(key)`; if `retryPolicy` allows another
   attempt for `error.code`, `setTimer(backoff)` and enter Waiting (`retryBackoff`); on
   `TimerFired` start attempt n+1 (step 1). Otherwise phase Failed with that error.
4. `AdapterFinished {state: unknown}` (engine restarted with the call outstanding): if the
   adapter's `describe.supports.query`, issue `callAdapter(query)` and treat its answer as the
   attempt's result; otherwise the attempt is `failed` with `unknown_result`, retryable only
   when `sideEffects: none`. Unknown is never success.
5. `TimerFired(deadline)` while an attempt is running: `callAdapter(cancel)` best effort,
   `abandonScope`, phase Failed with `timeout`.

## Durable execution

Stored `status` is authoritative and the framework RunLog is the only log; nothing is rebuilt.
Every decision above is a status patch plus actions committed in one reconcile (framework
§4), so a crash between "decided" and "recorded" loses nothing: the event is redelivered and
the handler, idempotent on `(uid, sequence)`, produces the same result. Resume is the
framework redelivering undelivered events and outstanding adapter results (framework §5);
no run-kind handler has resume logic of its own.

This applies identically in local mode (SQLite) and server mode (Postgres).

## Scheduling semantics

Unchanged from the design doc: waiting-threshold joins, dispatch, skip propagation, terminal
selection, repeat loop, retry backoff, effective deadline = min of enclosing deadlines. Output
commit is transactional with artifact publication: a TaskRun is Succeeded only after every
declared output is present, type-checked and, for artifacts, committed (`commitScope`) with an
exact ref, all in the same reconcile.

Terminal selected while other activated steps are still running (the run's phase stays
Running until this resolves; no terminal phase is ever revised):
- terminal Succeeded: the workflow handler waits for all activated steps to reach a terminal
  phase. Any failure not consumed by a fired Transition makes the final phase Failed with
  `error.code: unconsumed_failure`.
- terminal Failed: the workflow handler cancels remaining activated steps (phase Cancelled)
  and fails the run with the terminal's reason.

Context resolution at attempt start: a `file` entry whose externalResource ref lacks `version`
fails the attempt with `invalid_input` (non-retryable). Context entries on absent optional
inputs are dropped from the resolved list.

## Cancellation

`Cancelled` is set on the root and propagated to children through `cancelResource`. The
`task` handler issues `callAdapter(cancel)` for a running attempt, abandons its scope and
records the answer. It never asserts external effects were
undone. No error object is carried on Cancelled runs.

## Trigger delivery

Events are produced by the engine itself when it commits an artifact publication or a
WorkflowRun terminal phase. Delivery is at-least-once through an outbox in the same store as
the run log; no external broker.

- Event id = `sha256(eventKind + subjectRef)`. Run creation from a Trigger is idempotent on
  `(triggerName, eventId)`; a duplicate event creates no second run.
- The created WorkflowRun carries `origin.kind: trigger` with `triggerRef`, `eventId`, and
  `causationRef` pointing at the producing run when known.
- Loop guard: a run whose causation chain already contains the same `(triggerName,
  workflowRef)` pair more than `maxChainDepth` times (default 8) is not created; the engine
  records a TriggerSuppressed event instead.
- Disabled triggers (`enabled: false`) receive no events.
- Trigger input binding failure (missing `content.<path>`, type mismatch) records
  TriggerFailed; no run is created.

## Human tasks

A `human` Task attempt enters Waiting with `waitingReason: human`. Completion arrives as a
`Signal` carrying the adapter's `complete` (a TaskResult, an Actor asserted by the adapter's
authenticated channel, and optionally `approvalGroup`). The framework refuses a `complete`
without an Actor (framework §9). The `task` handler records the Actor in `status.actor` and
`approvalGroup` in `status.attempts[].approvalGroup`, then commits the attempt's scope in that
same reconcile, so the framework stamps `provenance.actor` with the human Actor on every
artifact of the attempt (framework §8). Validators read the actor from artifact provenance.
Timeout applies.
