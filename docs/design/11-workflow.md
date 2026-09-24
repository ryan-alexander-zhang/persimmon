# Workflow

status: draft · layer: 1 · schema: [`schemas/workflow.yaml`](schemas/workflow.yaml)

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
| `inputs` | `{<port>: Binding}`; every required input of `uses` bound |
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
| `when` reads a `Skipped` step or an unfinished step's outputs | evaluates to false |
| a step input reads an unfinished or `Skipped` step | absent; requires `onMissing: omit` (static) |
| no `to` matches | `noMatch: fail` fails the run with `no_match`; `skip` skips every `to` step |
| terminal Succeeded selected | wait for every activated step; then a step ended `Failed` whose Transition does not list `Failed` fails the run with `unconsumed_failure`; else evaluate `outputBindings`, a source absent fails with `output_unbound`; else Succeeded |
| terminal Failed selected | cancel every activated step (`Cancelled`); run Failed with `error.code = reason` |
| two terminals selected | the first selection wins; the second is ignored |
| every activated step finished, no terminal selected | run Failed with `no_progress` |
| deadline | a step's effective deadline is min(run `timeout`, step `timeout`, enclosing step deadlines); expiry fails the step with `timeout`; run `timeout` expiry cancels activated steps and fails the run with `timeout` |
| run cancelled | activated steps `Cancelled`; run `Cancelled`; no error |

`Cancelled` is never a routable outcome.

## RepeatPolicy

| Field | Rule |
|---|---|
| `state` | `{<var>: InputSpec}` |
| `initial` | `{<var>: Binding}`; outer scope; every required var bound |
| `next` | `{<var>: Binding}`; `fromIterationOutput` allowed; every required var bound; keys ⊆ `state` |
| `until` | CEL over `iteration.outputs`, `iteration.index`, `inputs`; boolean |
| `maxIterations` | ≥ 1; includes the first |

| Case | Behaviour |
|---|---|
| iteration Succeeded, `until` true | step Succeeded; outputs = that iteration's outputs |
| iteration Succeeded, `until` false, index < `maxIterations` | `next` state; new iteration at a new invocation address |
| iteration Succeeded, `until` false, index = `maxIterations` | step Failed with `iteration_limit`; no outputs |
| iteration Failed | step Failed with the iteration's error; `until` not evaluated |

Invocation address: `<workflowRunName>/<iterationPath>/<stepId>`; `iterationPath` is empty
without `repeat`, `<stepId>[<index>]` per enclosing repeat level, joined by `/`.

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

## Examples

- [`examples/workflow-prd-create.yaml`](examples/workflow-prd-create.yaml): two steps,
  one Transition, Succeeded terminal
- [`examples/workflow-review-loop.yaml`](examples/workflow-review-loop.yaml): `repeat`
  over a body Workflow, failure routing
- [`examples/workflow-fan-in.yaml`](examples/workflow-fan-in.yaml): two parallel
  reviewers, `quorum` join, `dispatch: first`
