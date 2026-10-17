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
the demo pack.

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
  ([Installation](../../README.md#installation))
- `codex` and `claude` CLIs installed and logged in (`codex login`, `claude`)

## Steps

Run every command inside this directory.

### 1. Create the project and install the workflow

```sh
cd examples/example05
persimmon init
persimmon apply ../../packs/demo/global/*.yaml --global   # the ReviewReport kind
persimmon validate prd-review.yaml     # every line `ok`
persimmon apply prd-review.yaml
```

### 2. Run it

```sh
persimmon run idea-to-reviewed-prd --input idea="A CLI that turns a meeting transcript into tracked action items" --follow
```

`--input maxRounds=2` changes the cap (default 3). Expected output, three rounds (the usual case:
Codex keeps finding errors and the cap ends the loop), names shortened:

```text
created WorkflowRun/idea-to-reviewed-prd-<hex>
write   TaskRun   claude-code/v1   Running
WorkflowRun   idea-to-reviewed-prd-<hex>   Running
write   TaskRun   claude-code/v1   Succeeded
rounds-1   WorkflowRun   Running
rounds-1/review-claude   TaskRun   claude-code/v1   Running
rounds-1/review-codex   TaskRun   codex/v1   Running
rounds-1/review-claude   TaskRun   claude-code/v1   Succeeded
rounds-1/review-codex   TaskRun   codex/v1   Succeeded
rounds-1/judge   TaskRun   claude-code/v1   Running
rounds-1   WorkflowRun   Succeeded
rounds-1/judge   TaskRun   claude-code/v1   Succeeded
rounds-2   WorkflowRun   Running
...
rounds-3/judge   TaskRun   claude-code/v1   Succeeded
WorkflowRun   idea-to-reviewed-prd-<hex>   Succeeded

WorkflowRun   idea-to-reviewed-prd-<hex>        Succeeded 12m28s
├─ write   TaskRun   claude-code/v1              Succeeded  1m07s
│     EarsPrd/idea-to-reviewed-prd-<hex>-write-prd.r1
├─ rounds-1   WorkflowRun                        Succeeded  3m33s
│  ├─ review-claude   TaskRun   claude-code/v1   Succeeded  1m08s
│  │     ReviewReport/idea-to-reviewed-prd-<hex>-rounds-1-review-claude-report.r1
│  ├─ review-codex   TaskRun   codex/v1          Succeeded  1m00s
│  │     ReviewReport/idea-to-reviewed-prd-<hex>-rounds-1-review-codex-report.r1
│  └─ judge   TaskRun   claude-code/v1           Succeeded  2m24s
│        Judgement/idea-to-reviewed-prd-<hex>-rounds-1-judge-judgement.r1
│        EarsPrd/idea-to-reviewed-prd-<hex>-rounds-1-judge-prd.r1
├─ rounds-2   WorkflowRun                        Succeeded  3m56s
│  ...
└─ rounds-3   WorkflowRun                        Succeeded  3m51s
   ...
         EarsPrd/idea-to-reviewed-prd-<hex>-rounds-3-judge-prd.r1

outputs
  clean   false
  prd     EarsPrd/idea-to-reviewed-prd-<hex>-rounds-3-judge-prd.r1
  rounds  3
```

The two reviewers start in the same tick and run at the same time. Local mode delivers the
answers of one tick together, so both `Succeeded` lines print at once, in step order, whoever
answered first; the tree shows each one's real duration. The judge starts when both are done
(the transition joins `all`, the default). A round's `WorkflowRun Succeeded` line prints just
before its judge's, the same tick. `clean true` ends the loop early. Ctrl-C is safe;
`persimmon resume` continues.

### 3. Read what the judge decided

```sh
persimmon get WorkflowRun/idea-to-reviewed-prd-<hex>                       # status.outputs: prd, clean, rounds
persimmon get Judgement                                                    # one per round
persimmon get Judgement/idea-to-reviewed-prd-<hex>-rounds-1-judge-judgement.r1
persimmon get ReviewReport                                                 # two per round: what each reviewer said
persimmon get EarsPrd                                                      # the draft and one revision per round
persimmon tree WorkflowRun/idea-to-reviewed-prd-<hex>
persimmon logs TaskRun/idea-to-reviewed-prd-<hex>-rounds-1-judge           # the judge's reasoning, one line per finding, then its answer calls
```

A `Judgement` has one verdict per finding: which reviewer, the finding verbatim, `holds`, and the
reason. `accepted` and `rejected` count them. In one run, round 1 had 11 verdicts (3 from Claude,
8 from Codex), 8 accepted and 3 rejected; the judge sided with the PRD on matters of taste and
scope and fixed the rest. The judge is told to write its reasoning as text before it answers,
so `logs` shows one line per finding; headless `claude` prints no thinking on its own, only
what the agent says and the tools it calls. Compare the two `ReviewReport`s of a round to see
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
rm -rf .persimmon persimmon.yaml AGENTS.md CLAUDE.md .gitignore
```

## Known limits

- The judge is the author. It judges its own work against two critics; a wrong finding it likes
  gets through. Make `judge-and-fix` use another Executor to change that.
- A round where one reviewer fails (timeout, agent error) fails the round and the run. `quorum`
  in the table above trades that for reviews from whoever answered.
