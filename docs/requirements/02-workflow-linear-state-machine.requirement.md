# Linear Workflow (Persisted) — State Transition Specification

## Scope

This document specifies the complete state transition flow for the **strictly linear** workflow engine:

- Strict linear execution (a responsibility chain): step order is fixed by `step_seq`.
- Steps are **fully pre-inserted** into the database at workflow start.
- Runtime progression **does not depend** on in-memory workflow definitions.
- Concurrency uses **B-claim** semantics (claim first, then execute) with DB leases.
- External events can **wake up** a waiting step (with inbox idempotency handled upstream).

This spec covers:

- Instance state machine
- Step state machine
- End-to-end lifecycle (start → run → complete/fail)

Non-goals:

- Branching, DAG, parallelism, loops
- BPMN modeling

## Terminology

- `workflowType`: workflow definition name (string), e.g. `order.process`
- `workflowVersion`: definition version (integer); used at **start time** to generate steps
- `stepSeq`: the strictly linear step index, `0..N-1`
- `stepType`: stable step name (string), e.g. `VALIDATE`, `SHIP`
- `instanceId`: workflow instance identifier
- `workerId`: a readable unique identity used for DB leases (e.g. `${app}:${host}:${pid}:${suffix}`)

## State Sets

### Instance States (`workflow_instance.status`)

- `RUNNING`
- `COMPLETED`
- `FAILED`
- `CANCELED` (reserved; optional behavior)

### Step States (`workflow_step.status`)

- `PENDING` — inserted but not yet activated (not runnable)
- `READY` — runnable and claimable
- `RUNNING` — claimed by a worker (lease is active)
- `WAITING` — waiting for an external event
- `DONE` — completed successfully
- `DEAD` — unrecoverable failure

## Start Flow (Full Step Pre-insert)

When a workflow instance is started:

1. Insert one row in `workflow_instance`:
   - `status = RUNNING`
   - `current_step_seq = 0`
   - `current_step_type = stepTypeAt(0)`
2. Insert **all** steps in `workflow_step` for `step_seq = 0..N-1`:
   - For `step_seq = 0`:
     - `status = READY`
     - `next_run_at = now`
   - For `step_seq > 0`:
     - `status = PENDING`

After this transaction commits, the database contains the complete future step plan for the instance.

## Tick Flow (Runner) — Claim Then Execute (B-claim)

Each tick executes the following phases:

### 1) Lease Recovery

Release expired RUNNING leases:

- `RUNNING && locked_until < now` → `READY`
  - `attempts += 1`
  - `next_run_at = now`
  - `last_error = 'LEASE_EXPIRED'`
  - clear `locked_by/locked_until`

### 2) Claim READY Steps

Claim a batch of runnable steps:

1. Select `READY` rows:
   - `status = READY && next_run_at <= now`
   - `FOR UPDATE SKIP LOCKED`
2. For each selected row, mark it `RUNNING` and set the lease:
   - `status = RUNNING`
   - `locked_by = workerId`
   - `locked_until = now + lease`

Only claimed steps may be executed. A worker must **never** execute step side effects without first claiming.

### 3) Claim Timed-out WAITING Steps (Optional)

If enabled, timed-out WAITING steps are also claimable:

- `WAITING && deadline_at <= now` → claim to `RUNNING` with a lease
- Execute handler with `taskType = WAITING_TIMEOUT`

## Execution Result Handling (Core State Transitions)

All `RUNNING -> *` writes must enforce the lease condition:

- `status = RUNNING`
- `locked_by = thisWorkerId`
- `locked_until >= now` (or `locked_until is null` if you allow it)

This prevents late writes from an expired worker from overwriting newer state.

### A) Completed

When the handler returns `Completed`:

1. Current step:
   - `RUNNING` → `DONE`
2. Compute `nextSeq = stepSeq + 1`
3. If there is **no** `workflow_step(instance_id, nextSeq)` row:
   - Instance:
     - `RUNNING` → `COMPLETED`
     - set `completed_at = now`
4. Otherwise (a next step exists):
   - Next step:
     - `PENDING` → `READY`
     - set `next_run_at = now`
   - Instance:
     - `current_step_seq = nextSeq`
     - `current_step_type = next step's step_type`

Notes:

- Runtime does not consult in-memory definitions. The existence of `stepSeq + 1` in the DB determines whether the workflow continues.

### B) Waiting

When the handler returns `Waiting(waitingEventType, timeout, outboundEvents)`:

1. Current step:
   - `RUNNING` → `WAITING`
   - set `waiting_event_type = waitingEventType`
   - set `deadline_at = now + timeout`
   - clear `next_run_at`
2. Instance stays:
   - `RUNNING` and `current_step_seq/type` unchanged
3. If `outboundEvents` are produced:
   - Persist them to **outbox** in the same transaction (recommended).

### C) Retry

When the handler returns `Retry(backoff, lastError)`:

1. Attempt to schedule retry:
   - `RUNNING` → `READY`
   - `attempts += 1`
   - `next_run_at = now + backoff`
   - `last_error = lastError`
2. Retry must respect `max_attempts`. If `(attempts + 1) >= max_attempts`, the retry update must not succeed and the step should be treated as exhausted.

### D) Dead

When the handler returns `Dead(lastError)` (or retry is exhausted):

1. Current step:
   - `RUNNING` → `DEAD`
   - `attempts += 1`
   - `last_error = lastError`
2. Instance:
   - `RUNNING` → `FAILED`
   - set `failed_at = now`

## External Event Wake-up (After Inbox Idempotency)

When an external event arrives, inbox idempotency must be enforced upstream.

Wake-up semantics:

- For the **current** waiting step:
  - `WAITING && waiting_event_type == incomingEventType` → `READY`
  - set `next_run_at = now`
  - clear `waiting_event_type/deadline_at`

The next tick will claim and execute the now-runnable step again (the same `step_seq`).

## Summary of Full Lifecycle

1. Start:
   - instance → `RUNNING`
   - steps: `seq0 READY`, `seq>0 PENDING`
2. Tick:
   - lease recovery
   - claim READY → RUNNING
   - execute
3. On `Completed`:
   - current step DONE
   - activate next step: `PENDING -> READY`, advance instance pointer
   - if no next step: instance COMPLETED
4. On `Waiting`:
   - current step WAITING with deadline
   - external event wakes it to READY
5. On `Retry`:
   - schedule READY with backoff; exhausted → DEAD
6. On `DEAD`:
   - instance FAILED

