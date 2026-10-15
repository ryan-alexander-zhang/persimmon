# example01: from an idea to an approved PRD

You give one sentence. Codex researches it on the web, Claude writes a PRD in a fixed
template, Claude reviews the PRD, Claude fixes the P0 findings, you approve or reject the result
at the terminal.

```text
idea ─▶ research (codex gpt-6-sol) ─▶ write (claude-sonnet-5) ─▶ review ─▶ fix P0 ─▶ you
```

Everything the workflow needs is in [`idea-prd.yaml`](idea-prd.yaml): the PRD shape
(`EarsPrd`: Section 1 `summary`, Section 2 `features[]` with EARS requirements), the template
Prompt, two Executors, five Tasks and the Workflow `idea-to-prd`.

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
  ([Installation](../../README.md#installation))
- `codex` and `claude` CLIs installed and logged in (`codex login`, `claude`)

## Steps

Run every command inside this directory.

### 1. Create the project

```sh
cd examples/example01
persimmon init
persimmon apply ../../packs/demo/global/*.yaml --global
```

Expected: `wrote persimmon.yaml`, then one `created ...` line per shipped Adapter and pack
definition. `init` installs the built-in SDLC pack, with the `local-reviewer` Executor (you, at the
terminal) this example reuses; the demo pack adds the `ResearchReport` and `ReviewReport`
artifact kinds it also needs.

### 2. Install the workflow

```sh
persimmon validate idea-prd.yaml     # schema plus static rules; every line `ok`
persimmon apply idea-prd.yaml        # writes the definitions into .persimmon/persimmon.db
persimmon get Workflow               # ... Workflow/idea-to-prd  -n default
```

`apply` runs nothing. Edit the YAML and `apply` again to change a model, a prompt or a step.

### 3. Run it

```sh
persimmon run idea-to-prd --input idea="A CLI that turns a meeting transcript into tracked action items" --follow
```

`--follow` prints every phase change and returns when the run finishes or waits on you. Four
agent steps run in sequence: research takes a few minutes, the other three under two minutes
each, about seven minutes in all. Expected output:

```text
created WorkflowRun/idea-to-prd-<hex>
WorkflowRun   idea-to-prd-<hex>   Running
research   TaskRun   codex/v1   Running
research   TaskRun   codex/v1   Succeeded
write   TaskRun   claude-code/v1   Running
...
fix   TaskRun   claude-code/v1   Succeeded
approve   TaskRun   cli-human/v1   Waiting human

WorkflowRun   idea-to-prd-<hex>                      Running   6m39s
├─ research   TaskRun   codex/v1                     Succeeded 3m39s
│     ResearchReport/idea-to-prd-<hex>-research-report.r1
├─ write   TaskRun   claude-code/v1                  Succeeded 1m30s
│     EarsPrd/idea-to-prd-<hex>-write-prd.r1
├─ review   TaskRun   claude-code/v1                 Succeeded   50s
│     ReviewReport/idea-to-prd-<hex>-review-report.r1
├─ fix   TaskRun   claude-code/v1                    Succeeded   39s
│     EarsPrd/idea-to-prd-<hex>-fix-prd.r1
└─ approve   TaskRun   cli-human/v1                  Waiting human
      persimmon complete idea-to-prd-<hex>-approve
parked on you: persimmon complete idea-to-prd-<hex>-approve
```

Each line is one run: its name under the run that owns it, its kind, the Adapter behind it, its
state. The tree at the end lists every artifact by the name `get` takes.

Ctrl-C is safe at any point; `persimmon resume` continues where the run stopped.

### 4. Approve or reject

```sh
persimmon complete idea-to-prd-<hex>-approve
```

The terminal shows the revised PRD and the review it was fixed against, then asks
`approve? [y/n]` and, on `n`, one finding per line. The answer is validated, signalled, and the
run finishes in the same command.

Scripted instead (no terminal, CI):

```sh
cat > .persimmon/approve.yaml <<'YAML'
protocol: persimmon.result/v1
outputs:
  result: {kind: value, value: {passed: true, findings: [], evidence: []}}
YAML
persimmon complete idea-to-prd-<hex>-approve --file .persimmon/approve.yaml
```

### 5. Read the results

```sh
persimmon get WorkflowRun                          # idea-to-prd-<hex>  Succeeded   (Failed prd_rejected on n)
persimmon get WorkflowRun/idea-to-prd-<hex>        # status.outputs.prd, status.outputs.approved
persimmon get EarsPrd                              # <run>-write-prd.r1 and <run>-fix-prd.r1
persimmon get EarsPrd/idea-to-prd-<hex>-fix-prd.r1 # the approved PRD, content under spec
persimmon get ResearchReport                       # what codex found, with source URLs
persimmon get ReviewReport                         # the P0/P1 findings
persimmon tree WorkflowRun/idea-to-prd-<hex>       # every run and every artifact, by name
persimmon logs TaskRun/idea-to-prd-<hex>-research  # under logs: what codex printed while it worked
persimmon logs TaskRun/idea-to-prd-<hex>-write     # under logs: what claude said and which tools it ran
```

## Change it

| Want | Edit in `idea-prd.yaml` | Then |
|---|---|---|
| another model | `Executor` `configuration.model` | `persimmon apply idea-prd.yaml` |
| less effort, cheaper | `parameters: {effort: ...}` / `{reasoningEffort: ...}` on a Task | apply |
| a different PRD template | Prompt `ears-prd-template` content, `EarsPrd` schema | apply |
| review loop until clean | add a second `review` step after `fix` and a `when` on the transition | apply |

## Reset

```sh
rm -rf .persimmon persimmon.yaml
```

## Known limits

- Codex has one network switch. `allowedHosts` on `codex-researcher` cannot narrow the hosts;
  the agent fetches blogs with `curl` inside its sandbox.
- The fix step runs once. A remaining P0 is yours to catch at step 4.
