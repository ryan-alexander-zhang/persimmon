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

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root ([Installation](../../README.md#installation))
- `codex` and `claude` CLIs installed and logged in
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
persimmon init                             # wrote persimmon.yaml, then the shipped Adapters and the built-in SDLC pack (unused here)
persimmon validate spec-to-code.yaml       # every line ok
persimmon apply spec-to-code.yaml          # 16 created
```

### 2. Run it

```sh
persimmon run spec-to-code --input spec=@spec.yaml --follow
```

`spec.yaml` is a revision document: `metadata.name` is `<id>.r<n>`, the content sits under
`spec.content`. `run` stores it as the artifact `AppSpec/todo-cli.r1` (once; a second run reuses
it) and passes its reference to the Workflow's `spec` input. `persimmon get AppSpec/todo-cli.r1`
shows it. Persimmon reads nothing from disk during a run: agents and Gates see the stored revision.

Expected shape (round numbers vary):

```text
created WorkflowRun/spec-to-code-<hex>
WorkflowRun   spec-to-code-<hex>   Running
rounds-1   WorkflowRun   Running
rounds-1/implement   TaskRun   codex/v1   Running
rounds-1/implement   TaskRun   codex/v1   Succeeded
rounds-1/gate   GateRun   Running
rounds-1/gate/coverage   ValidationRun   Running
rounds-1/gate/coverage/task   TaskRun   subprocess/v1   Running
rounds-1/gate/acceptance   ValidationRun   Running
rounds-1/gate/acceptance/task   TaskRun   claude-code/v1   Running
...
rounds-1/gate   GateRun   passed
rounds-1   WorkflowRun   Succeeded
report   TaskRun   claude-code/v1   Succeeded
WorkflowRun   spec-to-code-<hex>   Succeeded

WorkflowRun   spec-to-code-<hex>                    Succeeded 3m07s
├─ rounds-1   WorkflowRun                           Succeeded 2m48s
│  ├─ implement   TaskRun   codex/v1                Succeeded 2m28s
│  │     ImplementationReport/spec-to-code-<hex>-rounds-1-implement-report.r1
│  └─ gate   GateRun                                passed      20s
│     ├─ coverage   ValidationRun                   passed      20s
│     │  └─ task   TaskRun   subprocess/v1          Succeeded   20s
│     └─ acceptance   ValidationRun                 passed      20s
│        └─ task   TaskRun   claude-code/v1         Succeeded   20s
└─ report   TaskRun   claude-code/v1                Succeeded   19s
      TestReport/spec-to-code-<hex>-report-testreport.r1

outputs
  passed      true
  testReport  TestReport/spec-to-code-<hex>-report-testreport.r1
```

Each line is one run: its labels from the root down (`rounds-1/gate/coverage/task`), its kind, the
Adapter behind a TaskRun, its state. A Gate or Validator shows `passed` or `rejected`, a rejected
Validator lists its findings underneath. The tree at the end names every artifact as `get` takes
it. Lines that commit in the same tick print parent before child, not in time order. About three
minutes in all: the coder takes two and a half, the two Validators run in parallel in twenty
seconds, the report in twenty.

A Gate that rejects still `Succeeded`: its result says `passed: false`, and the `rounds` step starts
`rounds-2` with that result as the `previous` input of `implement`. After three rejected rounds the
report is still written and the run ends `Failed quality_not_met`.

### 3. Read the results

```sh
open app/reports/test-report.html                                    # the HTML report (macOS)
persimmon tree WorkflowRun/spec-to-code-<hex>                        # every run and every artifact, by name
persimmon get TestReport/spec-to-code-<hex>-report-testreport.r1     # content under spec.content
persimmon get GateRun/spec-to-code-<hex>-rounds-1-gate               # status.outputs.result.results.coverage / .acceptance
persimmon get ImplementationReport/spec-to-code-<hex>-rounds-1-implement-report.r1
persimmon logs TaskRun/spec-to-code-<hex>-rounds-1-implement         # the RunLog: events, and under logs: what codex printed
persimmon logs TaskRun/spec-to-code-<hex>-rounds-1-gate-coverage-task  # under logs: the vitest output
cd app && npm run coverage                                           # run the tests yourself
```

`logs` prints the RunLog as YAML: one entry per event, each with a `logs:` list holding the
agent's or program's output lines, at most 5000 per attempt. A Claude Task's lines are what it
said, `> <tool> <input>` for each call and `< <result>` for what came back.

## Change it

| Want | Edit | Then |
|---|---|---|
| another threshold | `threshold` in `scripts/coverage.mjs` | nothing, the script is read at run time |
| more rounds | `--input maxRounds=5` on `run` | |
| your own spec | copy `spec.yaml`, change `identity.id` and the content | `--input spec=@your.yaml` |
| Claude as the coder | Executor `coder`: `adapter: claude-code/v1`, `configuration: {model: claude-sonnet-5, sandbox: workspace-write, allowedTools: ["Bash(npm test:*)", "Bash(npm run coverage:*)"]}` | `persimmon apply spec-to-code.yaml`; `allowedTools` lets it run the tests without a prompt |

## Reset

```sh
rm -rf .persimmon persimmon.yaml app/src app/test app/coverage app/reports
git checkout app/package.json              # a coder may add a bin entry despite AGENTS.md
```

## Known limits

- The HTML report is a file the agent writes; the `TestReport` artifact holds its path and summary.
  Storing the HTML as an artifact representation is designed but not wired into the agent Adapter.
- The coder's sandbox has no network, so `npm install` runs before the workflow.
- Without the workspace, the coder once found the persimmon checkout's `.git` and `AGENTS.md` above
  this directory and committed to it. `workspace: {path: app}`, the app's own git repository and its
  `AGENTS.md` are the three fences.
