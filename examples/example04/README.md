# example04: your own SDLC, from one line to verified code

Three templates you own, one Workflow that uses them. You type one line. An agent writes an Idea
with your idea template; you approve it at the terminal. An agent writes a Spec with your spec
template: EARS requirements, GWT acceptance criteria. Codex implements it behind a Gate: a script
measures coverage, and codex reads the tests to check that every Given/When/Then is verified,
not just mentioned. Rejected rounds loop back. A verification report follows your report template.

```text
"one line" ─▶ write-idea (claude) ─▶ you: approve? ─▶ write-spec (claude) ─▶ implement (codex) ─▶ Gate ─┐
                idea-template                        spec-template                                    │ rejected: next round
                                                     EARS + GWT                    coverage script     │
                                                                                   gwt-check (codex)   │
                                                     report (claude) ◀── passed or 3 rounds ◀──────────┘
                                                     report-template ─▶ app/reports/verification.html
```

Files:

- [`templates.yaml`](templates.yaml): three `Prompt` resources. **This is the file you edit.**
- [`sdlc.yaml`](sdlc.yaml): four artifact kinds (`Idea`, `Spec`, `ImplementationReport`,
  `VerificationReport`), five Executors, seven Tasks, two Validators, the Gate, two Workflows
- [`app/`](app/): the agents' workspace, as in example02
- [`scripts/coverage.mjs`](scripts/coverage.mjs): the coverage Validator's script

## Templates

A template is a `Prompt`: text handed to the agent as context. The artifact kind in `sdlc.yaml`
fixes the fields (`Spec` has `features[].requirements[].pattern`, `acceptance[].given`, ...); the
template says how to fill them. Change the wording, the size, the rules:

```sh
$EDITOR templates.yaml
persimmon apply templates.yaml             # updated Prompt/spec-template; the next run uses it
```

The kinds change the same way, in `sdlc.yaml`, with one rule: a revisioned kind never changes
after registration, so rename it or bump its version, or reset the project.

## Prerequisites

- persimmon built: `npm install && npm run build` in the repository root
- `codex` and `claude` CLIs installed and logged in
- the alias from [example01](../example01/README.md#prerequisites)
- the app's tooling and its own git repository, once:

```sh
cd examples/example04/app && npm install && git init -q && cd ..
```

## Steps

Run every command inside `examples/example04`.

### 1. Install

```sh
persimmon init
persimmon validate templates.yaml sdlc.yaml       # every line ok
persimmon apply templates.yaml sdlc.yaml          # 24 created
```

### 2. Run it

```sh
persimmon run idea-to-verified --input idea="A CLI that counts words, lines and characters in a text file" --follow
```

About a minute later the run parks on you:

```text
created WorkflowRun/idea-to-verified-<hex>
WorkflowRun   idea-to-verified-<hex>   Running
write-idea   TaskRun   claude-code/v1   Running
write-idea   TaskRun   claude-code/v1   Succeeded
approve   TaskRun   cli-human/v1   Waiting human

WorkflowRun   idea-to-verified-<hex>                Running   1m02s
├─ write-idea   TaskRun   claude-code/v1            Succeeded   58s
│     Idea/idea-to-verified-<hex>-write-idea-idea.r1
└─ approve   TaskRun   cli-human/v1                 Waiting human
      persimmon complete idea-to-verified-<hex>-approve
parked on you: persimmon complete idea-to-verified-<hex>-approve
```

### 3. Approve the idea

```sh
persimmon complete idea-to-verified-<hex>-approve
```

The terminal shows the Idea (title, problem, proposal, out of scope, success signal), then asks
`approve? [y/n]`. On `y` the run continues in the same command: spec, code, Gate, report. Around
ten minutes; the tree prints when it ends. On `n` it asks for your findings, one per line, and
the run ends `Failed idea_rejected`.

Scripted (no terminal): `--file` with `{passed: true, findings: [], evidence: []}` as in
[example01](../example01/README.md#4-approve-or-reject).

### 4. Read the results

```sh
persimmon tree WorkflowRun/idea-to-verified-<hex>        # every run, every artifact by name, the Gate verdicts
open app/reports/verification.html                       # the report from your template (macOS)
persimmon get Spec/idea-to-verified-<hex>-write-spec-spec.r1               # EARS requirements, GWT ACs
persimmon get GateRun/idea-to-verified-<hex>-rounds-1-gate                 # results.acceptance.findings: one per AC, info verified, error missing
persimmon logs TaskRun/idea-to-verified-<hex>-rounds-1-gate-acceptance-task   # what codex read and concluded
persimmon get VerificationReport                          # passed, verified/total, coverage, rounds
```

The acceptance Validator's findings are the heart of it: `info` with `<file>: <test name>` for a
verified AC, `error` naming the unverified part (given, when or then) otherwise. A round with any
error is rejected and the coder gets the whole verdict as `previous`.

## Change it

| Want | Edit | Then |
|---|---|---|
| stricter or looser ACs | `templates.yaml` `spec-template` | `persimmon apply templates.yaml` |
| a different report | `templates.yaml` `report-template` | apply |
| more rounds | `--input maxRounds=5` | |
| other models | `sdlc.yaml` Executors | `persimmon apply sdlc.yaml` |
| skip the approval | remove the `approve` step and route `write-idea` to `write-spec` | apply |

## Reset

```sh
rm -rf .persimmon persimmon.yaml app/src app/test app/coverage app/reports
git checkout app/package.json
```

## Known limits

- The idea is not revised on rejection; the run ends. Rerun with a better line.
- Same as example02: the HTML report is a file, scripts get artifact references, one `resultFile`.
