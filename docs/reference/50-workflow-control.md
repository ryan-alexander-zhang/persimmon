# Workflow Control Semantics (design doc §8–10)

## Graph constraints (v1)

- One Workflow invocation is a DAG.
- `entry` lists every zero-in-degree step explicitly.
- Every non-entry step has exactly one Transition that owns delivering its control token.
  Multi-source joins are expressed inside one `Transition.from`.
- Each step is consumed exactly once in some Transition's `from`.
- Fan-out, join and conditional branching are supported. Re-activating a step through
  multiple inbound edges is rejected. Reuse work by giving the same Task multiple step ids;
  repeat work with `repeat`.
- The Workflow reference graph is non-recursive.

## Transition

`from[]`: `{stepRef, outcomes}` where outcomes ⊆ {Succeeded, Failed}.
`to[]`: `{stepRef, when?}` or `{terminal, reason, when?}`.
`join`: `all | any | quorum{count}`. `dispatch`: `all | first`. `noMatch`: `fail | skip`.

Join is a waiting threshold barrier: wait until all `from` steps are terminal, then count
whose phase is in their declared outcomes. Skipped matches nothing. Branches never activated
are recorded Skipped and skip propagates along disabled Transitions so later barriers can
finish.

`any`/`quorum` do not mean "first finisher wins". No ordering-dependent winner selection.
Eager join would need a selected-set, cancellation and output-collection contract; it is not
this field.

When a Transition fires it consumes the terminal states of its listed sources; explicit
`any`/`quorum` therefore tolerates partial source failure. A failed step not consumed by any
fired Transition fails the invocation.

`dispatch: all` selects every target whose `when` is true; `first` selects the first in
declaration order. Absent `when` is true. An enabled Transition selecting nothing:
`noMatch: fail` errors, `noMatch: skip` sends no token. Threshold not reached is "disabled",
distinct from noMatch.

One dispatch cannot select a terminal together with a step, nor two terminals. `when` may read
only the sources and their causal predecessors.

## Terminals

Every real execution path must pick a terminal. Succeeded additionally requires all activated
work finished, no unhandled failure, all outputs resolved and type-checked. A failed Workflow
exports no public outputs; successful sub-steps and their artifacts remain queryable.
External cancel uses phase Cancelled; a controller must stop children and converge unknown
side effects. Cancel and global timeout do not guarantee budget for rollback nodes.

## repeat

Allowed only on `uses.kind: Workflow` steps. Fields: `state`, `initial`, `next`, `until`,
`maxIterations`, `timeout` (all required).

1. Evaluate `initial` in the outer scope into typed state; optional state may be absent.
2. Create a new body WorkflowRun with its own invocation address; evaluate inputs.
3. On body success evaluate `until` over `iteration.outputs`.
4. `until` true: this iteration's outputs are the step outputs; step succeeds.
5. `until` false with budget left: rebuild full state via `next`, go to 2.
6. Limit or deadline reached: fail. Body execution error fails directly.

`maxIterations: 5` includes the first run. Previous PRD and feedback flow only through state;
no `latestCompleted`, no `previousIteration`, no global "latest TaskRun" query. Rework across
iterations is distinct from network retry within one iteration.

## Retry, timeout, errors

`Task.retryPolicy` is the default. `WorkflowStep.retryPolicy` is allowed only on Task steps and
replaces the default wholesale. No implicit retry wrapper around Workflows or repeat.

No policy means one attempt. `maxAttempts` includes the first. `retryOn` ∩ `abortOn` = ∅;
`permission_denied`, `invalid_input`, `schema_violation` may not be in `retryOn`. Runtime abort
wins.

Backoff for retry k (from 1), base = initial: fixed `min(base,max)`, linear `min(base*k,max)`,
exponential `min(base*2^(k-1),max)`. `jitter: none | full` (uniform in [0, wait]).
Unlisted errors are not retried. `Error.retryable` is diagnostic only.

Duration: positive integer plus one unit `ms | s | m | h | d`. No zero, negatives, floats or
compound forms.

`Task.timeout` bounds one attempt. `Step.timeout` covers queueing, attempts and backoff. Gate,
Validator, sub-Workflow, repeat and WorkflowRun each have a budget. Effective deadline is the
minimum of all enclosing deadlines. Human steps may be Waiting but still have a timeout.
