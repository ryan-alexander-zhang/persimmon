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
- [`sdlc.yaml`](sdlc.yaml): four artifact kinds (`Idea`, `AppSpec`, `ImplementationReport`,
  `VerificationReport`), one Skill, five Executors (plus the pack's `local-reviewer`), seven
  Tasks, two Validators, the Gate, two Workflows
- [`skills/vitest-style/`](skills/vitest-style/): a skill the coder gets, how tests are written here
- [`app/`](app/): the agents' workspace, as in example02
- [`scripts/coverage.mjs`](scripts/coverage.mjs): the coverage Validator's script

## Templates

A template is a `Prompt`: text handed to the agent as context. The artifact kind in `sdlc.yaml`
fixes the fields (`AppSpec` has `features[].requirements[].pattern`, `acceptance[].given`, ...); the
template says how to fill them. Change the wording, the size, the rules:

```sh
$EDITOR templates.yaml
persimmon apply templates.yaml             # updated Prompt/spec-template; the next run uses it
```

The kinds change the same way, in `sdlc.yaml`, with one rule: a revisioned kind's schema may change
only where every artifact already in the project still validates under it; `apply` names the first
that does not. A change they cannot pass needs a new kind name or a reset project. A run started
before the change still publishes under the schema its snapshot froze, so it may commit an artifact
the new schema refuses; the change after that one stops on it.

## Skills

A template tells the writer what to produce; a skill tells the coder how to work. `vitest-style`
is a directory with a `SKILL.md`, the shape claude and codex both read. Three parts:

- the Skill resource in `sdlc.yaml` pins the directory by digest: what you reviewed
- `persimmon skill install vitest-style --into app` copies the verified bundle into
  `app/.agents/skills/vitest-style` (codex) and `app/.claude/skills/vitest-style` (claude), where
  each CLI discovers its own skills; the copies stay, agents and you see the same files
- the `implement` Task lists the Skill as context; at every attempt the Adapter hashes the
  installed copy against the declared digest and refuses to start on a mismatch

Change it:

```sh
$EDITOR skills/vitest-style/SKILL.md
persimmon digest skills/vitest-style       # paste into sdlc.yaml, Skill vitest-style, spec.digest
persimmon apply sdlc.yaml
persimmon skill install vitest-style --into app
```

Forget the last step and the next `implement` attempt fails with `skill_digest_mismatch` and the
install command, never silently. Skills in `app/` that no Task declares are allowed and logged.

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root ([Installation](../../README.md#installation))
- `codex` and `claude` CLIs installed and logged in
- the app's tooling and its own git repository, once:

```sh
cd examples/example04/app && npm install && git init -q && cd ..
```

The Skill is installed in step 1, after the definitions exist.

## Steps

Run every command inside `examples/example04`.

### 1. Install

```sh
persimmon init                                    # wrote persimmon.yaml, the shipped Adapters, the built-in SDLC pack (its `local-reviewer` is the approve step), then AGENTS.md, CLAUDE.md and .gitignore
persimmon validate templates.yaml sdlc.yaml       # every line ok
persimmon apply templates.yaml sdlc.yaml          # 25 created
persimmon skill install vitest-style --into app   # installed into app/.agents/skills and app/.claude/skills
```

### 2. Run it

```sh
persimmon run idea-to-verified --input idea="A CLI that counts words, lines and characters in a text file" --follow
```

About fifteen seconds later the run parks on you:

```text
created WorkflowRun/idea-to-verified-<hex>
WorkflowRun   idea-to-verified-<hex>   Running
write-idea   TaskRun   claude-code/v1   Running
write-idea   TaskRun   claude-code/v1   Succeeded
approve   TaskRun   cli-human/v1   Waiting human

WorkflowRun   idea-to-verified-<hex>                Running     15s
├─ write-idea   TaskRun   claude-code/v1            Succeeded   15s
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
`approve? [y/n]`. On `y` the run continues in the same command: spec, code, Gate, report. Five to
nine minutes, one or two rounds; the tree prints when it ends. On `n` it asks for your findings, one per line, and
the run ends `Failed idea_rejected`.

Scripted (no terminal): `--file` with `{passed: true, findings: [], evidence: []}` as in
[example01](../example01/README.md#4-approve-or-reject).

### 4. Read the results

```sh
persimmon tree WorkflowRun/idea-to-verified-<hex>        # every run, every artifact by name, the Gate verdicts
open app/reports/verification.html                       # the report from your template (macOS)
persimmon get AppSpec/idea-to-verified-<hex>-write-spec-appspec.r1             # EARS requirements, GWT ACs
persimmon get GateRun/idea-to-verified-<hex>-rounds-1-gate                 # results.acceptance.findings: one per AC, info verified, error missing
persimmon logs TaskRun/idea-to-verified-<hex>-rounds-1-gate-acceptance-task   # what codex read and concluded
persimmon get VerificationReport/idea-to-verified-<hex>-report-verification.r1   # passed, verified/total, coverage, rounds
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
| a different test style | `skills/vitest-style/SKILL.md`, then `persimmon digest skills/vitest-style` into `sdlc.yaml` | apply, then `persimmon skill install vitest-style --into app` |
| skip the approval | remove the `approve` step and route `write-idea` to `write-spec` | apply |

## Reset

```sh
rm -rf .persimmon persimmon.yaml AGENTS.md CLAUDE.md .gitignore app/src app/test app/coverage app/reports app/.agents app/.claude
git checkout app/package.json
```

## Known limits

- The idea is not revised on rejection; the run ends. Rerun with a better line.
- Same as example02: the HTML report is a file. Same as example03: scripts get artifact references.
