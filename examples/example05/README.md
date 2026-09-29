# example05: two reviewers in parallel, one judge, a PRD that gets better each round

You give one sentence. Claude writes a PRD. Claude and Codex review it at the same time, each on
its own. Claude, the author, reads both reviews and judges every finding: true or false, with a
reason. It fixes the true ones and publishes the next PRD. The round repeats until no error
finding holds, or three rounds.

```text
idea ─▶ write (claude) ─▶ ┌ review-claude ┐ ─▶ judge-and-fix (claude) ─▶ clean? ─▶ PRD
                          └ review-codex  ┘        Judgement per finding    │ no: next round
                                  ▲                                          │
                                  └──────────────────────────────────────────┘
```

Everything is in [`prd-review.yaml`](prd-review.yaml): two artifact kinds (`EarsPrd`, the PRD;
`Judgement`, what the judge decided about every finding), two Prompts (the PRD template, the
review rules both reviewers follow), three Executors, four Tasks, the round Workflow
`review-round` and the outer Workflow `idea-to-reviewed-prd`. The `ReviewReport` kind comes from
the built-in pack.

## Prerequisites

- persimmon built: `npm install && npm run build` in the repository root
- `codex` and `claude` CLIs installed and logged in (`codex login`, `claude`)
- an alias to the binary, run from anywhere inside the repository:

```sh
alias persimmon="node $(git rev-parse --show-toplevel)/dist/main.js"    # bash, zsh
alias persimmon "node (git rev-parse --show-toplevel)/dist/main.js"     # fish
```

## Steps

Run every command inside this directory.

### 1. Create the project and install the workflow

```sh
cd examples/example05
persimmon init
persimmon validate prd-review.yaml     # every line `ok`
persimmon apply prd-review.yaml
```

### 2. Run it

```sh
persimmon run idea-to-reviewed-prd --input idea="A CLI that turns a meeting transcript into tracked action items" --follow
```

`--input maxRounds=2` changes the cap (default 3). Expected output, one round shown:

```text
created WorkflowRun/idea-to-reviewed-prd-<hex>
WorkflowRun   idea-to-reviewed-prd-<hex>   Running
write   TaskRun   claude-code/v1   Running
write   TaskRun   claude-code/v1   Succeeded
rounds   WorkflowRun   Running
review-claude   TaskRun   claude-code/v1   Running
review-codex   TaskRun   codex/v1   Running
review-codex   TaskRun   codex/v1   Succeeded
review-claude   TaskRun   claude-code/v1   Succeeded
judge   TaskRun   claude-code/v1   Running
judge   TaskRun   claude-code/v1   Succeeded
rounds   WorkflowRun   Succeeded
WorkflowRun   idea-to-reviewed-prd-<hex>   Succeeded

WorkflowRun   idea-to-reviewed-prd-<hex>                       Succeeded  8m10s
├─ write   TaskRun   claude-code/v1                            Succeeded  1m20s
│     EarsPrd/idea-to-reviewed-prd-<hex>-write-prd.r1
└─ rounds-1   WorkflowRun                                      Succeeded  6m50s
   ├─ review-claude   TaskRun   claude-code/v1                 Succeeded  1m05s
   │     ReviewReport/idea-to-reviewed-prd-<hex>-rounds-1-review-claude-report.r1
   ├─ review-codex   TaskRun   codex/v1                        Succeeded  2m40s
   │     ReviewReport/idea-to-reviewed-prd-<hex>-rounds-1-review-codex-report.r1
   └─ judge   TaskRun   claude-code/v1                         Succeeded  3m00s
         Judgement/idea-to-reviewed-prd-<hex>-rounds-1-judge-judgement.r1
         EarsPrd/idea-to-reviewed-prd-<hex>-rounds-1-judge-prd.r1
  prd      EarsPrd/idea-to-reviewed-prd-<hex>-rounds-1-judge-prd.r1
  clean    true
  rounds   1
```

The two reviewers start in the same tick and run at the same time; whichever finishes first
reports first. The judge starts when both are done (the transition joins `all`, the default).
A second round appears as `rounds-2` with its own three runs. Ctrl-C is safe; `persimmon resume`
continues.

### 3. Read what the judge decided

```sh
persimmon get WorkflowRun/idea-to-reviewed-prd-<hex>                       # status.outputs: prd, clean, rounds
persimmon get Judgement                                                    # one per round
persimmon get Judgement/idea-to-reviewed-prd-<hex>-rounds-1-judge-judgement.r1
persimmon get ReviewReport                                                 # two per round: what each reviewer said
persimmon get EarsPrd                                                      # the draft and one revision per round
persimmon tree WorkflowRun/idea-to-reviewed-prd-<hex>
persimmon logs TaskRun/idea-to-reviewed-prd-<hex>-rounds-1-judge           # how the judge reasoned
```

A `Judgement` has one verdict per finding: which reviewer, the finding verbatim, `holds`, and the
reason. `accepted` and `rejected` count them. Compare the two `ReviewReport`s of a round to see
where Claude and Codex disagreed and whom the judge sided with.

## Change it

| Want | Edit in `prd-review.yaml` | Then |
|---|---|---|
| stricter or looser reviews | Prompt `prd-review-rules` | `persimmon apply prd-review.yaml` |
| a third reviewer | copy `review-prd-codex` and its step, add it to `entry`, `reviews-in.from` and a `judge` input | apply |
| the judge stops on warnings too | `clean = true when no finding ... error` in `judge-and-fix` instructions | apply |
| one reviewer is enough | `join: {strategy: quorum, count: 1}` on `reviews-in`, `onMissing: omit` on the judge's inputs | apply |
| more rounds | `--input maxRounds=5` at run time; `maxIterations` is the hard cap | |

## Reset

```sh
rm -rf .persimmon persimmon.yaml
```

## Known limits

- The judge is the author. It judges its own work against two critics; a wrong finding it likes
  gets through. Make `judge-and-fix` use another Executor to change that.
- A round where one reviewer fails (timeout, agent error) fails the round and the run. `quorum`
  in the table above trades that for reviews from whoever answered.
