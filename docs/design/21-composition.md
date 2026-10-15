# Composition kinds: Pipeline, Approval, ReviewLoop

status: active · layer: 2 · schema: [`schemas/composition.yaml`](schemas/composition.yaml)

Three Definition kinds that are sugar for the Layer 1 graph kinds. Each expands to Workflow or
Gate Resources through the expansion hook (`01-kind-definition.md`, `02-handler.md`,
`04-snapshot.md`); a run pins the expansion it started with. Users write these; they drop to a
raw Workflow when the shape does not fit.

```text
Pipeline   ──expand──▶ Workflow                 phases in order, fail-fast, gates reject
Approval   ──expand──▶ Gate + Validator×n       approvers are Tasks (human or agent) answering a ValidationResult
ReviewLoop ──expand──▶ Workflow + Workflow      produce ─▶ review, repeated with feedback until passed or maxRounds
                                 <name>-round
```

## Expansion

| Rule | Checked by |
|---|---|
| a composition's `metadata.name` is free in its scope for the expansion kind and every helper name (`<name>-round`) | Handler `validate` |
| `validate` expands, then runs the schema, the static checker and the target Handler's `validate` on every expanded Resource; findings carry the path into the composition where one exists, else the expanded Resource's name | Handler `validate` |
| the expansion is a pure function of `spec`; the same spec expands to the same bytes | Handler author |
| a run names the composition (`workflowRef: {kind: Pipeline, name}`, `gateRef: {kind: Approval, name}`); the closure holds the expansion under the target kind and the composition's name, plus the composition's KindDefinition | snapshot walk, run schemas |
| `persimmon run <name>` accepts a Workflow or any kind expanding to Workflow; `tree`, `describe` and `get` of a run show the expanded step ids | CLI |

## Pipeline

A Workflow whose Transitions are implied by order.

| Field | Rule |
|---|---|
| `inputs`, `outputs`, `outputBindings`, `timeout` | as Workflow (`11-workflow.md`); `outputBindings` read `steps.<phase>` |
| `phases[]` | Steps (`11-workflow.md`): `id`, `uses`, `inputs`, `timeout`, optional `repeat`; order is execution order; at least one |

Expansion to Workflow `<name>`:

| Part | Content |
|---|---|
| `entry` | `[phases[0].id]` |
| `steps` | `phases` verbatim |
| `transitions` | one per phase, id `after-<id>`, `from: [{stepRef: id, outcomes: [Succeeded]}]`; `to` the next phase, or `{terminal: Succeeded}` after the last |
| gate phase (`uses` kind's `stepContract.runKind` is GateRun: Gate, Approval) | `to: [{<next or terminal Succeeded>, when: 'steps.<id>.outputs.result.passed'}, {terminal: Failed, reason: <id>_rejected}]`, `dispatch: first` |
| ReviewLoop phase | the same, on `steps.<id>.outputs.passed`: a loop Succeeds with `passed: false` after `maxRounds`, and the next phase must never start from a rejected subject |

A phase that Fails is unrouted, so the run fails with that phase's error (`11-workflow.md`).
No `onFailure` branches in v1: a failure stops the pipeline, a rejection ends it with
`<id>_rejected`.

## Approval

A Gate whose Validators are Tasks: a human at the terminal, an agent, a script.

| Field | Rule |
|---|---|
| `inputs` | Ports; `artifact`, `artifacts` and `value` only (`14-gate.md`) |
| `approvers[]` | `{name, uses: {kind: Task}, inputs?, resultOutput?}`; `name` unique; `uses` a Task with a `value` output `resultOutput` (default `result`) of the ValidationResult `$ref`; `inputs` maps `{<task port>: <approval port>}`, default: every Approval input to the Task port of the same name |
| `policy` | `{strategy: all \| any \| quorum, count?}`; default `all` |
| `timeout` | Duration for the GateRun and each ValidationRun |

Expansion:

| Resource | Content |
|---|---|
| Gate `<name>` | `inputs`; `outputs` fixed; `validators: [{name: approver, ref: Validator <name>-<approver>, inputs: {<task port>: {fromInput: <approval port>}}}]`; `policy`; `timeout` |
| Validator `<name>-<approver>` | `inputs`: one per mapped Task port, the Approval port's type; `evaluator: {type: task, taskRef: uses, resultOutput}`; `timeout` |

Approval carries Gate's step contract (runKind GateRun). As a Pipeline phase it routes on
`passed`; in a raw Workflow the Transition reads `steps.<id>.outputs.result.passed`.

## ReviewLoop

Produce, review, feed the verdict back, repeat.

| Field | Rule |
|---|---|
| `inputs`, `timeout` | as Workflow |
| `produce` | Step without `repeat`: `uses` (Task, Workflow, Pipeline), `inputs`, `timeout` |
| `review` | Step without `repeat`: `uses` a kind with runKind GateRun (Gate, Approval), `inputs` (may bind `fromStep: {stepRef: produce}`, and `fromInput: previous` or `fromInput: feedback`, the loop's reserved names, into an optional port of the Gate: round one has neither), `timeout` |
| `subject` | an output port of `produce`; carried as the loop's result |
| `previous` | optional input port of `produce`, `required: false`, type of `subject`; receives the last round's subject |
| `feedback` | optional input port of `produce`, `required: false`, type `GateResult`; receives the last round's verdict |
| `maxRounds` | integer ≥ 1; default 3: the ceiling. The expansion adds an optional loop input `maxRounds` (default the ceiling), so a run asks for fewer rounds, never more |

Outputs: every output of `produce` (its type), plus `passed` (boolean) and `rounds` (integer).
A phase downstream of a loop reads `steps.<phase>.outputs.<any produce port>`. A produce output
named `verdict`, `passed` or `rounds` is shadowed by the loop's own of that name.

Expansion:

| Resource | Content |
|---|---|
| Workflow `<name>-round` | inputs: the loop's, plus `previous` and `feedback` as declared, `required: false`; steps `produce` (its bindings, plus `previous: {fromInput: previous, onMissing: omit}` and the same for `feedback`) and `review`; Transitions `produce Succeeded → review`, `review Succeeded → terminal Succeeded`; outputs: every `produce` output, each `fromStep: {stepRef: produce, output: <port>}`, plus `verdict` (GateResult) from `review.result` and `passed` from `steps.review.outputs.result.passed` |
| Workflow `<name>` | inputs: the loop's plus `maxRounds` (integer, `required: false`, default `<maxRounds>`); one step `rounds` using `<name>-round`, every input `fromInput` (with `onMissing: omit` when the loop input is `required: false`, in the round body's `produce` and `review` bindings too), `previous: {fromState: previous, onMissing: omit}`, `feedback: {fromState: feedback, onMissing: omit}`; `repeat: {state: {previous?, feedback?}, initial: {}, next: {previous: {fromIterationOutput: <subject>}, feedback: {fromIterationOutput: verdict}}, until: 'iteration.outputs.passed \|\| iteration.index >= (inputs.maxRounds < <maxRounds> ? inputs.maxRounds : <maxRounds>)', maxIterations: <maxRounds>}`; `timeout`; Transition `rounds Succeeded → terminal Succeeded`; outputs: every `produce` output and `passed`, each `fromStep: {stepRef: rounds, output: <port>}`, plus `rounds: {expression: 'steps.rounds.iterations'}` |

`passed: false` after `maxRounds` is a verdict: the run Succeeds with `passed false`, as
`workflow-review-loop.yaml` does by hand today.

## Static rules

| Rule | Checked by |
|---|---|
| every Pipeline phase id unique; `outputBindings` keys equal `outputs` | expansion + Workflow checker |
| Approval: approver names unique; every mapped Task port and Approval port exists; every required Task input is mapped; `uses` Task has output `resultOutput` of `value` type with the ValidationResult `$ref` | composition Handler, then the Validator rules on the expansion |
| ReviewLoop: `subject` ∈ produce outputs and not `passed`, `rounds`, `verdict` (the loop's own shadow a produce output of that name, so `subject` could never carry it); `previous`, `feedback` ∈ produce inputs, optional, of the stated types, not bound by `produce.inputs`, and no loop input named `previous`, `feedback` or `maxRounds`; a `review` binding `fromInput: previous` or `fromInput: feedback` names one the loop declares and lands on an optional Gate input; `review.uses` runKind is GateRun | composition Handler |
| no composition expands through itself (a ReviewLoop producing with a ReviewLoop that produces with it) | expansion; refused at write when visible, at snapshot otherwise |
| everything else | the Workflow and Gate rules on the expansion; a finding's path is rebased onto what the user wrote (a Pipeline phase; a ReviewLoop's `produce`, `review`, `inputs` or `maxRounds`, else `/spec`), its message names the expanded Resource |

## Decisions

- Composition kinds are engine-shipped under `persimmon.ai/v1` with builtin Handlers, like
  Workflow; a pack ships YAML and cannot ship a Handler. The reference placed them in the SDLC
  pack.
- Expansion runs at write (`validate`) and at snapshot; nothing derived is stored as a live
  Resource. `get Pipeline/x` shows what the user wrote; the run's closure shows what ran.
- Pipeline has no `onFailure` routing; the Workflow default (unrouted failure fails the run with
  the step's error) is the pipeline semantic. Reference listed per-phase failure routing.
- `Rollout` stays roadmap (`20-pack.md`).
- A composition's KindDefinition may register before its `expansion.kind`; the target is checked
  at expand time, so shipped and example KindDefinitions load in any order. `stepContract`
  equality with the target is checked when both are registered. Found in implementation.
- The composition Handler validates an expansion with the target kind's schema, a name-taken
  check against the live store in the same scope, then the target Handler's `validate`; findings
  are prefixed `<Kind>/<name>: `. `reconcile` is a no-op. Found in implementation.
- A live composition used as a step (a Pipeline phase using an Approval) is read through its
  expansion for the static checker, so `steps.<id>.outputs.result` exists; `HandlerDeps.expand`
  supplies it. Found in implementation.
- A ReviewLoop's expansion reads the `subject` type from `produce`'s definition, live at write
  and at snapshot: the loop names the port, the definition owns the type. The loop rules
  (`subject` an output, `previous` and `feedback` optional inputs, `review` a GateRun kind) are
  checked before expansion, so the finding names the loop field, not a derived Workflow. Found
  in implementation.
- Expansion resolves references in the run's Namespace at snapshot (`expand(resource, namespace)`),
  the composition's own at write, the same order the walk uses for every hop. A composition that
  expands through itself is refused by an in-progress guard. Found in UAT (audit).
- `GateRun.spec.gateRef` accepts a kind expanding to Gate, as `workflowRef` does: a round whose
  review was an Approval stalled on `/gateRef/kind must be equal to constant`. The Gate Handler
  reads the closure by name, so the expansion is found either way. Found in UAT.
- `maxRounds` is both the ceiling and an optional loop input the expansion adds: a run that wants
  one round of a three-round loop asks `maxRounds: 1`; `maxIterations` keeps the ceiling, so a
  larger value is clamped in `until`, never `iteration_limit`. Found in implementation.
- A ReviewLoop surfaces every produce output: a design phase's loop must hand its `contexts`
  list to the next phase, and a Pipeline cannot read artifact content to find it itself. A produce
  output named `verdict`, `passed` or `rounds` is shadowed by the loop's own, documented, never
  refused, so a loop may produce with a loop. Found in design review.
- A finding on a ReviewLoop's expansion is rebased onto `/spec/produce`, `/spec/review`,
  `/spec/inputs/...` or `/spec/maxRounds`, else `/spec`: never a path the loop does not have. The
  message names the expanded Resource. Found in implementation (audit).

- A Pipeline routes a ReviewLoop phase on the loop's `passed` as it routes a gate phase on its
  GateResult: the loop Succeeds after `maxRounds` with `passed: false`, and without the route the next
  phase started from a rejected model behind three human gates. Found in audit.
- A binding from an optional loop input carries `onMissing: omit`: the Prd loop's `glossary` is
  `required: false`, a run without one failed `source absent` at the `rounds` step before any Task
  ran. The author declares optionality once, on the loop input; the expansion repeats it where the
  engine needs it. Found in UAT.
- An optional Approval input reaches its Validators with `onMissing: omit`: the expansion bound
  every Approval input `fromInput` as if required, so a GateRun without the optional one failed at
  Created with `source absent`. Found in implementation (the review of a ReviewLoop reading
  `previous`).
- `review` may bind `fromInput: previous` and `fromInput: feedback`: the round body already
  declared both, only `produce` was fed. A Validator that sees the last round can refuse a change
  the findings did not ask for (`28-prd-process.md`: a round two renumbered every rule). The Gate
  port must be optional, round one has nothing; the expansion adds `onMissing: omit` as it does for
  an optional loop input. Found in UAT (example08).


## Examples

- [`examples/pipeline-prd.yaml`](examples/pipeline-prd.yaml): research, write, approve as phases
- [`examples/approval-prd.yaml`](examples/approval-prd.yaml): two reviewers, quorum 1
- [`examples/review-loop-prd.yaml`](examples/review-loop-prd.yaml): `prd-with-review` of `11-workflow.md` as a ReviewLoop
