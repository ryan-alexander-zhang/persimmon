# Workflow

status: active · layer: 1 · schema: [`schemas/workflow.yaml`](schemas/workflow.yaml)

A Definition kind: a strict DAG of Steps joined by Transitions, with typed ports. Loops only
through `repeat`. Runs as a WorkflowRun (`17-runs.md`).

```text
inputs ──▶ [entry steps] ──Transition──▶ [steps] ──Transition──▶ terminal Succeeded ──▶ outputs (outputBindings)
                │                                          └──▶ terminal Failed {reason}
                └── step.repeat: state ─▶ body run ─▶ until? ─▶ next state ─▶ body run …

Step uses any kind with a stepContract: Task, Workflow, Gate, pack and user kinds.
```

## Spec

| Field | Rule |
|---|---|
| `inputs`, `outputs` | Ports (`10-ports.md`) |
| `outputBindings` | `{<output port>: Binding}`; same key set as `outputs`; evaluated after the terminal Succeeded barrier |
| `entry[]` | exactly the steps with no incoming Transition |
| `steps[]` | Step list |
| `transitions[]` | Transition list |
| `timeout` | Duration for the whole run, queueing included |

## Step

| Field | Rule |
|---|---|
| `id` | step id (`10-ports.md`); unique among steps |
| `uses` | LocalDefinitionRef to a kind declaring a `stepContract` (`x-persimmon-ref`) |
| `inputs` | `{<port>: Binding}`; every required input of `uses` bound (one with a `required` expression may stay unbound, the bind decides, `10-ports.md`) |
| `timeout` | Duration; covers queueing, attempts, backoff, and every `repeat` iteration |
| `repeat` | optional RepeatPolicy |

A Step carries no executor or retry override; the used definition states them once. Step
outputs are the used definition's outputs; expressions read them per `10-ports.md`.

Per-step phase, recorded in `WorkflowRun.status.steps.<id>` (`17-runs.md`):
`Pending`, `Running`, `Waiting`, `Succeeded`, `Failed`, `Cancelled`, `Skipped`.

## Transition

| Field | Rule |
|---|---|
| `id` | identifier; unique among transitions |
| `from[]` | `{stepRef, outcomes ⊆ [Succeeded, Failed]}`; one or more |
| `join` | `{strategy: all \| any \| quorum, count?}`; default `all`; `count` with `quorum` only |
| `to[]` | `{stepRef, when?}` or `{terminal: Succeeded \| Failed, reason?, when?}`; `reason` required with Failed |
| `dispatch` | `all` \| `first`; default `all` |
| `noMatch` | `fail` \| `skip`; default `fail` |

## Semantics

| Case | Behaviour |
|---|---|
| a `from` step reaches a listed outcome | counts toward the threshold: `all` = every entry, `any` = 1, `quorum` = `count` |
| a `from` step reaches an unlisted outcome, `Cancelled`, or `Skipped` | that entry can no longer count |
| threshold reached | the Transition fires, once; later outcomes of its `from` steps change nothing |
| threshold unreachable | the Transition is dead; its `to` steps are `Skipped`; skip propagates through dead Transitions |
| `dispatch: all` | every `to` whose `when` is true or absent |
| `dispatch: first` | the first such `to` in order |
| a `to` step the dispatch did not choose | `Skipped`, unless another Transition lists it in its `to`: it then waits for that one, whose death skips it |
| `when` reads a `Skipped` step or an unfinished step's outputs | evaluates to false |
| `steps.<id>.iterations` | how many iterations a finished `repeat` step ran; absent without `repeat` |
| a step input reads an unfinished or `Skipped` step | absent; requires `onMissing: omit` (static) |
| no `to` matches | `noMatch: fail` fails the run with `no_match`; `skip` skips every `to` step |
| terminal Succeeded selected | wait for every activated step; then a step ended `Failed` whose Transition does not list `Failed` fails the run with `unconsumed_failure`; else evaluate `outputBindings`, a source absent fails with `output_unbound`; else Succeeded |
| terminal Failed selected | cancel every activated step (`Cancelled`); run Failed with `error.code = reason` |
| two terminals selected | the first selection wins; the second is ignored |
| every activated step finished, no terminal selected | run Failed with the first Failed step's error, its message prefixed `step <id>: `; with no Failed step, `no_progress` |
| deadline | a step's effective deadline is min(run `timeout`, step `timeout`, enclosing step deadlines), set when the step first starts and recorded in `steps.<id>.deadline`; every `repeat` iteration shares it (a body run gets the remaining time as its `timeout`); expiry fails the step with `timeout`; run `timeout` expiry cancels activated steps and fails the run with `timeout` |
| run cancelled | activated steps `Cancelled`; run `Cancelled`; no error |

`Cancelled` is never a routable outcome.

## RepeatPolicy

| Field | Rule |
|---|---|
| `state` | `{<var>: InputSpec}`, `required` a boolean (an expression has no site to evaluate at, `10-ports.md`); readable as `state.<var>` in the step's `inputs` and in `next`, nowhere else |
| `initial` | `{<var>: Binding}`; outer scope, no `state`; every required var bound |
| `next` | `{<var>: Binding}`; `fromState`, `fromIterationOutput` and `state.<var>` read the state and outputs of the iteration that just finished; every required var bound; keys ⊆ `state` |
| `until` | CEL over `iteration.outputs`, `iteration.index`, `inputs`; no `state`; boolean |
| `maxIterations` | ≥ 1; includes the first |

| Case | Behaviour |
|---|---|
| iteration Succeeded, `until` true | step Succeeded; outputs = that iteration's outputs |
| iteration Succeeded, `until` false, index < `maxIterations` | `next` state; new iteration at a new invocation address |
| iteration Succeeded, `until` false, index = `maxIterations` | step Failed with `iteration_limit`; no outputs |
| iteration Failed | step Failed with the iteration's error; `until` not evaluated |

Invocation address: `{workflowRunRef, stepRef, iterationPath, logicalExecutionId}`. `iterationPath`
is empty without `repeat`, `<stepId>[<index>]` per enclosing repeat level, joined by `/`.
`logicalExecutionId` is `<workflowRunName>/<own iteration>/<stepId>`, double slash when the step
has no `repeat`; the run name already carries the enclosing iterations (`<parent>-<step>-<n>`).

## Rules

| Rule | Enforcer |
|---|---|
| `uses.kind` declares a `stepContract` | static checker |
| step ids unique; transition ids unique; every `stepRef` resolves to a declared step | static checker |
| the step graph is a DAG | static checker |
| `entry` equals the zero-in-degree set | static checker |
| every step is `from` of exactly one Transition; every non-entry step is `to` of at least one | static checker |
| `dispatch: all`: the `to` list holds either steps only or one terminal | static checker |
| `quorum.count ≤ len(from)` | static checker |
| `outputBindings` keys equal `outputs` keys | static checker |
| every required input of `uses` bound; producer type equals consumer type | static checker |
| a Binding or `when` reads only steps that precede it; a step reachable only through `any`/`quorum` or a Failed-listing entry needs `onMissing: omit` | static checker |
| `repeat`: `fromIterationOutput` names a body output of equal type; `until` is boolean | static checker |
| Workflow reference graph acyclic | static checker |

## Decisions

- Workflow is `scope: Any` (`01-kind-definition.md`): pack Workflows are Global, overridable
  by Namespace.

- Mixed `to` lists are legal with `dispatch: first`; the static rule bounds `dispatch: all`
  only. Reference rule 6 read as a rule on the fired set.
- A Failed outcome is consumed when the step's Transition lists `Failed`; decidable statically,
  independent of when the Transition fired.
- Every step is `from` of exactly one Transition; the reference allowed none.
- `reason` is snake_case and becomes `error.code` verbatim; optional on Succeeded.
- `join`, `dispatch`, `noMatch` default to `all`, `all`, `fail`. Reference required them.
- Layer 1 codes defined here: `no_match`, `unconsumed_failure`, `output_unbound`,
  `no_progress`, `iteration_limit`, `timeout` reused from Layer 0.
- `any` and `quorum` never cancel the remaining `from` steps; eager joins are roadmap.
- A Failed Workflow exports no outputs; a business rejection is Succeeded plus a verdict output
  (reference; kept). No named entrypoints (reference decision 7; kept).
- The `stepContract` names no child `spec` shape, so the `workflow` Handler builds TaskRun, GateRun
  and WorkflowRun specs itself and gives any other run kind the TaskRun shape with `<kind>Ref`. A
  contract field for the child shape is roadmap. Found in implementation.
- A Transition counts as fired once any of its `to` steps has a run, even one another Transition
  started; a step that is `to` of two Transitions therefore fires the second one at most through
  its own guard. Recording fired Transitions in `status` is roadmap. Found in implementation.
- A step a dispatch passes over waits while another Transition lists it: a step passed by on
  a condition (`cases` to `write-api` or `implement`, then `write-api` to `implement`) was
  `Skipped` the moment the first dispatch chose `write-api`, so the second Transition found it
  finished and the run ended `no_progress`. The skip now falls to the other Transition, which
  dies when its `from` step is skipped. Found in implementation (`39-test-process.md`).
- `logicalExecutionId` is `<runName>/<own iteration>/<stepId>`: the child run of a repeat body is
  named `<parent>-<step>-<n>`, so repeating the enclosing `iterationPath` doubled it in artifact
  ids (`...-rounds-1-rounds-1-implement-report`). `address.iterationPath` keeps the full path.
  Found in UAT.
- `steps.<id>.iterations` is readable in `when` and in later steps' bindings once a `repeat` step
  finished: a report step wanted the round count. Found in UAT.
- A run whose steps all finished without a terminal fails with the first Failed step's own error
  (`step implement: skill_digest_mismatch: ...`), not `no_progress`; `no_progress` is reserved for
  the case with no failure, a routing hole. A body run's error then reaches the repeat step and
  the outer run unchanged. Found in UAT.
- The `repeat` state is readable as `state.<var>` in the body `inputs` and in `next`: a loop over a
  list (`item: state.items[state.index - 1]`, `index: state.index + 1`) has no other way to say it,
  and `fromState` in `next` was already legal statically while the running state was nowhere to be
  read. The state of the running iteration is therefore kept in `steps.<id>.state`. `until` keeps
  `iteration` and `inputs` only. Found in design review.
- A `repeat` step's `timeout` bounds the loop: the deadline is computed once at the first
  iteration and kept in `steps.<id>.deadline`; later iterations reuse it, a body WorkflowRun gets
  the remaining time as `timeout`. The code had given every iteration a fresh `timeout`, so a `6h`
  step could run three `4h` rounds. Found in UAT.

## Examples

- [`examples/workflow-prd-create.yaml`](examples/workflow-prd-create.yaml): two steps,
  one Transition, Succeeded terminal
- [`examples/workflow-review-loop.yaml`](examples/workflow-review-loop.yaml): `repeat`
  over a body Workflow, failure routing
- [`examples/workflow-fan-in.yaml`](examples/workflow-fan-in.yaml): two parallel
  reviewers, `quorum` join, `dispatch: first`
