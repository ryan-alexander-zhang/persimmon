# Runtime Layer

Controller-owned state describing executions. All runtime objects are immutable in `spec`;
`status` is written only by the engine.

## Kinds

| Kind | One per | Key spec fields | Key status fields |
|---|---|---|---|
| WorkflowRun | invocation | workflowRef, inputs, timeout, origin, parent? | phase, snapshot, steps[], outputs, error, reason, waitingReason |
| TaskRun | attempt | taskRef, snapshot, workflowRunRef, stepRef, iterationPath, attempt, logicalExecutionId, idempotencyKey?, inputs, context | phase, outputs, error, logs, actor? |
| GateRun | gate evaluation | gateRef, snapshot, workflowRunRef, inputs | phase, result, validationRunRefs |
| ValidationRun | validator execution | validatorRef, snapshot, gateRunRef?, inputs | phase, result, loadedArtifacts, taskRunRefs |

Additions to the design doc:

- `WorkflowRun.spec.origin`: `{kind: manual, actor?: Actor}`,
  `{kind: trigger, triggerRef: ObjectRef, eventId: string, causationRef?: ObjectRef}`, or
  `{kind: parent}` for body runs of `repeat` and sub-Workflow steps. Runs are otherwise identical.
- `WorkflowRun.spec.parent`: `{workflowRunRef: ObjectRef, stepRef: string, iterationPath:
  IterationAddress}`. Required when `origin.kind: parent`, forbidden otherwise. Child runs
  copy the parent's `status.snapshot` at creation; the engine never re-resolves for children.
- `WorkflowRun.status.reason`: the `reason` of the selected terminal, set on Succeeded and
  Failed. For a terminal Failed the engine also sets
  `error = {code: <reason>, message: "terminal Failed selected by transition <id>", retryable: false}`,
  so a parent can route on `steps.<child>.error.code`.
- `Actor` = `{kind: user | service, id: string, display?: string}`. Set by the engine from the
  adapter's authenticated channel; never taken from a TaskResult body.
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

On WorkflowRun creation, before any scheduling, the engine resolves the definition closure:
the Workflow, every reachable sub-Workflow, Task, Executor, Gate, Validator, Prompt, Skill,
ArtifactSchema and RelationType. It serializes them canonically (`persimmon.snapshot/v1`),
stores the bytes, and sets `status.snapshot = {uri, digest}` exactly once. Child runs
(TaskRun, GateRun, ValidationRun, body WorkflowRuns of `repeat`) reference the same snapshot.
Reading a snapshot verifies the digest; a mismatch or unreachable URI fails the run, never
falls back to current definitions.

## Identity of executions

- Invocation address: `workflowRunName / iterationPath / stepRef`.
- `logicalExecutionId` = that address. All attempts of one step invocation share it.
- `idempotencyKey` = `logicalExecutionId` unless the adapter derives a business key.
- A new `repeat` iteration is a new address, therefore a new key.

## Durable execution

State is persisted as an append-only run event log plus a materialized status view. Every
scheduler action is idempotent and keyed by (run, step address, attempt, action type), so a
crash between "decided" and "recorded" replays safely.

Event types (minimum): RunCreated, SnapshotResolved, StepScheduled, AttemptStarted,
AttemptFinished, TransitionFired, StepSkipped, IterationStarted, IterationFinished,
OutputsCommitted, RunFinished, RunCancelled, WaitingEntered, WaitingExited.

Resume: on start, the engine loads runs not in a terminal phase, rebuilds status from the
log, and continues. Attempts whose result is unknown (process died mid-attempt) are queried
through the adapter's `query` operation; if the adapter cannot answer, the attempt is marked
Failed with `unknown_result`, and retry follows the policy and `sideEffects` rules.

This applies identically in local mode (SQLite) and cloud mode (Postgres).

## Scheduling semantics

Unchanged from the design doc: waiting-threshold joins, dispatch, skip propagation, terminal
selection, repeat loop, retry backoff, effective deadline = min of enclosing deadlines. Output
commit is transactional with artifact publication: an attempt is Succeeded only after every
declared output is present, type-checked and, for artifacts, published with an exact ref.

Terminal selected while other activated steps are still running:
- terminal Succeeded: the engine waits for all activated steps to reach a terminal phase. Any
  failure not consumed by a fired Transition downgrades the run to Failed.
- terminal Failed: the engine cancels remaining activated steps (phase Cancelled) and fails
  the run with the terminal's reason.

Context resolution at attempt start: a `file` entry whose externalResource ref lacks `version`
fails the attempt with `invalid_input` (non-retryable). Context entries on absent optional
inputs are dropped from the resolved list.

## Cancellation

`Cancelled` is set on the root and propagated to children. The engine calls `cancel` on
adapters for running attempts and records the outcome. It never asserts external effects were
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

A `human` Task attempt enters Waiting with `waitingReason: human`. Completion arrives through
the adapter (`complete` operation carrying a TaskResult and an Actor asserted by the adapter's
authenticated channel). The engine refuses `complete` without an Actor, records it in
`TaskRun.status.actor`, and stamps `spec.provenance.actor` on every artifact published by that
attempt (see `30-data-layer.md`). Validators read the actor from artifact provenance.
Membership in `approvalGroup` is asserted by the adapter; the engine records the group on the
TaskRun. Timeout applies.
