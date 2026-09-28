# example02: from a spec to tested code, behind a quality Gate

You store a spec artifact. Codex implements it in `app/` with tests. A Gate runs two Validators:
a script measures test coverage (every metric at least 90%), and Claude reads the code to check
that every acceptance criterion (AC) is implemented and has a test. A rejected round feeds its
findings back to the coder, up to three rounds. Claude then writes an HTML test report.

```text
spec ─▶ implement (codex) ─▶ Gate: coverage script + AC check (claude) ─┐
          ▲                                                             │ rejected: next round with the findings
          └─────────────────────────────────────────────────────────────┘
        accepted or 3 rounds ─▶ write-report (claude) ─▶ reports/test-report.html
```

Files:

- [`spec.yaml`](spec.yaml): the `AppSpec` artifact, a todo CLI with 3 features and 6 ACs
- [`spec-to-code.yaml`](spec-to-code.yaml): three artifact kinds, four Executors, four Tasks, two
  Validators, the Gate, the round Workflow and the outer Workflow with the loop
- [`scripts/coverage.mjs`](scripts/coverage.mjs): the coverage Validator's script
- [`app/`](app/): the agents' workspace (every Task declares `workspace: {path: app}`), so they
  never see this directory or the persimmon checkout above it. Checked in: `package.json`,
  `vitest.config.mjs` and `AGENTS.md` (workspace rules for the agents, `CLAUDE.md` links to it).
  Everything a run creates there is ignored by git.

## Prerequisites

- persimmon built: `npm install && npm run build` in the repository root
- `codex` and `claude` CLIs installed and logged in
- the alias from [example01](../example01/README.md#prerequisites)
- the app's test tooling, once (the coder runs with the network off), and its own git repository,
  so the agents' `git` and `AGENTS.md` lookups stop at the workspace instead of climbing into the
  persimmon checkout:

```sh
cd examples/example02/app && npm install && git init -q && cd ..
```

`npm install` also writes `package-lock.json`; it is ignored by git.

## Steps

Run every command inside `examples/example02`.

### 1. Create the project and install the definitions

```sh
persimmon init                             # wrote persimmon.yaml, then the shipped Adapters and the built-in SDLC pack (23 created; unused here)
persimmon validate spec-to-code.yaml       # every line ok
persimmon apply spec-to-code.yaml          # 16 created
```

### 2. Store the spec

```sh
persimmon create spec.yaml                 # created AppSpec/todo-cli.r1
persimmon get AppSpec/todo-cli.r1
```

An artifact is a revision: `metadata.name` is `<id>.r<n>`, the content sits under `spec.content`.
A Workflow input of kind `artifact` takes a reference to it.

### 3. Run it

```sh
persimmon run spec-to-code --input 'spec={kind: artifact, ref: {apiVersion: engineering.persimmon.ai/v1, kind: AppSpec, namespace: default, id: todo-cli, revision: 1}}' --follow
```

Expected shape (round numbers vary):

```text
created WorkflowRun/spec-to-code-<hex>
WorkflowRun/spec-to-code-<hex>  Running
WorkflowRun/spec-to-code-<hex>-rounds-1  Running
TaskRun/spec-to-code-<hex>-rounds-1-implement  Running
TaskRun/spec-to-code-<hex>-rounds-1-implement  Succeeded
GateRun/spec-to-code-<hex>-rounds-1-gate  Running
ValidationRun/spec-to-code-<hex>-rounds-1-gate-coverage  Running
ValidationRun/spec-to-code-<hex>-rounds-1-gate-acceptance  Running
TaskRun/spec-to-code-<hex>-rounds-1-gate-coverage-task  Succeeded
TaskRun/spec-to-code-<hex>-rounds-1-gate-acceptance-task  Succeeded
...
GateRun/spec-to-code-<hex>-rounds-1-gate  Succeeded
WorkflowRun/spec-to-code-<hex>-rounds-1  Succeeded
TaskRun/spec-to-code-<hex>-report  Succeeded
WorkflowRun/spec-to-code-<hex>  Succeeded
```

Lines that commit in the same tick print parent before child (WorkflowRun, GateRun, ValidationRun,
TaskRun), not in time order, so a `rounds-1  Succeeded` line can precede its Gate's. About three
minutes in all: the coder takes two and a half, the two Validators run in parallel in twenty
seconds, the report in twenty.

A Gate that rejects still `Succeeded`: its result says `passed: false`, and the `rounds` step starts
`rounds-2` with that result as the `previous` input of `implement`. After three rejected rounds the
report is still written and the run ends `Failed quality_not_met`.

### 4. Read the results

```sh
open app/reports/test-report.html                                    # the HTML report (macOS)
persimmon get TestReport                                             # spec-to-code-<hex>-report-testreport.r1
persimmon get GateRun/spec-to-code-<hex>-rounds-1-gate               # status.outputs.result.results.coverage / .acceptance
persimmon get ImplementationReport                                   # one per round: spec-to-code-<hex>-rounds-1-implement-report.r1
persimmon logs TaskRun/spec-to-code-<hex>-rounds-1-implement         # the RunLog: events, and under logs: what codex printed
persimmon logs TaskRun/spec-to-code-<hex>-rounds-1-gate-coverage-task  # under logs: the vitest output
cd app && npm run coverage                                           # run the tests yourself
```

`logs` prints the RunLog as YAML: one entry per event, each with a `logs:` list holding the
agent's or program's output lines, at most 5000 per attempt. The Claude Tasks show nothing:
`claude -p` prints its transcript nowhere the Adapter reads yet (roadmap).

## Change it

| Want | Edit | Then |
|---|---|---|
| another threshold | `threshold` in `scripts/coverage.mjs` | nothing, the script is read at run time |
| more rounds | `--input maxRounds=5` on `run` | |
| your own spec | copy `spec.yaml`, change `identity.id` and the content | `persimmon create`, pass its ref |
| Claude as the coder | Executor `coder`: `adapter: claude-code/v1`, `configuration: {model: claude-sonnet-5, sandbox: full}` | `persimmon apply spec-to-code.yaml`; `workspace-write` cannot run `npm test` without prompts |

## Reset

```sh
rm -rf .persimmon persimmon.yaml app/src app/test app/coverage app/reports
git checkout app/package.json              # a coder may add a bin entry despite AGENTS.md
```

## Known limits

- The HTML report is a file the agent writes; the `TestReport` artifact holds its path and summary.
  Storing the HTML as an artifact representation is designed but not wired into the agent Adapter.
- `persimmon create` of a revision stamps no provenance or content digest; the Workflow reads it fine.
- The coder's sandbox has no network, so `npm install` runs before the workflow.
- Without the workspace, the coder once found the persimmon checkout's `.git` and `AGENTS.md` above
  this directory and committed to it. `workspace: {path: app}`, the app's own git repository and its
  `AGENTS.md` are the three fences.
