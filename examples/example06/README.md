# example06: the debate as composition kinds

Example05 again, written with three composition kinds instead of hand-wired Workflows. The author
writes a PRD; two agent reviewers judge it under one Approval; the author reads their findings,
judges each one true or false, fixes the true ones; the round repeats until both reviewers pass
or three rounds; then you sign off at the terminal.

```text
Pipeline idea-to-approved-prd
  ├─ debate: ReviewLoop idea-to-reviewed-prd ─┐  produce: write-or-revise-prd (claude)
  │     round 1, 2, 3 ...                      │  review:  Approval prd-review = review-prd-claude + review-prd-codex, policy all
  │     previous PRD and feedback flow back ◀──┘  until both pass, or maxRounds
  └─ signoff: Approval prd-signoff              you, at the terminal; a reject ends the run with signoff_rejected
```

Everything is in [`prd-debate.yaml`](prd-debate.yaml): the same kinds and prompts as example05,
four Tasks, two `Approval`s, one `ReviewLoop`, one `Pipeline`. No `Workflow`, no `Gate`, no
`Validator`, no `transitions`, no `repeat` block: the composition kinds expand to those when a run
starts, and the run keeps the expansion in its snapshot.

| Kind | Expands to | What it buys |
|---|---|---|
| `Approval` | one Gate plus one Validator per approver | "these Tasks must pass" in five lines |
| `ReviewLoop` | a Workflow with a repeat step plus the round body Workflow | produce, review, feed back, repeat |
| `Pipeline` | a Workflow with implied transitions | phases in order; a gate phase rejects |

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
  ([Installation](../../README.md#installation))
- `codex` and `claude` CLIs installed and logged in (`codex login`, `claude`)

## Steps

Run every command inside this directory.

### 1. Create the project and install the definitions

```sh
cd examples/example06
persimmon init
persimmon validate prd-debate.yaml     # 15 lines, every one `ok`
persimmon apply prd-debate.yaml
persimmon get Pipeline                 # Pipeline/idea-to-approved-prd
persimmon get ReviewLoop               # ReviewLoop/idea-to-reviewed-prd
persimmon get Approval                 # Approval/prd-review, Approval/prd-signoff
persimmon get Workflow                 # the pack's two only: nothing derived is stored
```

`validate` expands each composition and checks the result with the Workflow and Gate rules, so a
typo in a phase or an approver is reported against the line you wrote.

### 2. Run it

```sh
persimmon run idea-to-approved-prd --input idea="A CLI that turns a meeting transcript into tracked action items" --follow
```

`run` takes a Pipeline name as it takes a Workflow name. Expected shape, names shortened:

```text
created WorkflowRun/idea-to-approved-prd-<hex>
debate   WorkflowRun   Running
debate/rounds-1   WorkflowRun   Running
debate/rounds-1/produce   TaskRun   claude-code/v1   Running
debate/rounds-1/produce   TaskRun   claude-code/v1   Succeeded
debate/rounds-1/review   GateRun   Running
debate/rounds-1/review/claude   ValidationRun   Running
debate/rounds-1/review/codex   ValidationRun   Running
...
debate/rounds-1/review   GateRun   rejected
debate/rounds-2   WorkflowRun   Running
...
debate   WorkflowRun   Succeeded
signoff   GateRun   Running
signoff/you   ValidationRun   Waiting human
parked on you: persimmon complete idea-to-approved-prd-<hex>-signoff-you
```

Each round is one WorkflowRun of the expanded round body: `produce` (the author), then `review`
(the Approval's Gate with its two ValidationRuns, each running a reviewer Task). `rejected` on
the Gate is a verdict, not a failure: the next round starts with `previous` and `feedback` bound.
After three rejected rounds the loop still Succeeds with `passed false`, and the Pipeline moves on
to your sign-off.

### 3. Sign off

```sh
persimmon complete idea-to-approved-prd-<hex>-signoff-you
```

The terminal shows the PRD and asks `approve? [y/n]`. `y` ends the run `Succeeded`; `n` ends it
`Failed signoff_rejected`, as a gate phase of a Pipeline does. Scripted:

```sh
cat > .persimmon/approve.yaml <<'YAML'
protocol: persimmon.result/v1
outputs:
  result: {kind: value, value: {passed: true, findings: [], evidence: []}}
YAML
persimmon complete idea-to-approved-prd-<hex>-signoff-you --file .persimmon/approve.yaml
```

### 4. Read the results

```sh
persimmon get WorkflowRun/idea-to-approved-prd-<hex>     # status.outputs: prd, agreed, rounds
persimmon tree WorkflowRun/idea-to-approved-prd-<hex>    # every round, every reviewer, every artifact
persimmon get Judgement                                  # one per round; round 1 is the empty "first draft"
persimmon get EarsPrd                                    # one revision per round
persimmon logs TaskRun/idea-to-approved-prd-<hex>-debate-rounds-2-produce   # the author's one line per finding
persimmon get WorkflowRun/idea-to-approved-prd-<hex>-debate-rounds-1        # spec.workflowRef names the expanded round body
```

The run's `spec.workflowRef` says `kind: Pipeline`; what ran is the expansion, frozen in the
snapshot. Edit `prd-debate.yaml`, `apply`, and the next run expands anew; a running one keeps its
own.

## Change it

| Want | Edit in `prd-debate.yaml` | Then |
|---|---|---|
| one reviewer is enough | `policy: {strategy: quorum, count: 1}` on `prd-review` | `persimmon apply prd-debate.yaml` |
| a third reviewer | one more Task and one more approver line | apply |
| more rounds | `maxRounds` on the ReviewLoop | apply |
| no sign-off | drop the `signoff` phase and its Approval | apply |
| see the expansion | `persimmon get WorkflowRun/<run>-debate-rounds-1` and its snapshot | |

## Reset

```sh
rm -rf .persimmon persimmon.yaml
```

## Known limits

- `maxRounds` is fixed in the ReviewLoop; a Workflow could take it as an input, a ReviewLoop cannot.
- The round body's `produce` runs every round, so round 1 writes from the idea and later rounds
  revise; one Task, two jobs, told apart by whether `previous` is bound.
