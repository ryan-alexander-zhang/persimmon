# Test levels and tiers

status: draft · layer: 2 (`35-build-process.md`) · schema: the `TestOutcome`, `AcceptanceRecord` and `MutationOutcome` kinds in `packs/sdlc/global/10-artifact-kinds.yaml`

The build process runs one test command per round. This file splits the project's tests by test level
(`unit`, `integration`, `api`, `e2e`), adds coverage and mutation as measures of the `unit` level,
and decides when each runs. A `round` tier runs on every `build-one` round, but only the levels the
Change set touches and the tests the record names. Levels run cheapest first, and a level after a
red one is held. A `plan` tier runs every enabled level in full once after the last task, as the
backstop for what selection missed. A `release` tier is declared and deferred. A project enables
the levels it has; `unit` alone is today's behaviour.

```text
Workflow build-all
  baseline: Task run-baseline per enabled level (full) ─▶ TestOutcome <plan>-baseline[-<level>]
  each:     repeat over tasks ─▶ ReviewLoop build-one per T-n                         tier round
  verify:   Workflow verify-all: every enabled level, full ─▶ TestOutcome <plan>-<level>   tier plan
            Gate plan-gate = Validator plan-regression (sdd/v1: outcomes, baselines)
            failed ─▶ run Failed, reason plan_regressed; investigated as an Issue

Workflow build-work (one round)
  implement ─▶ AcceptanceRecord
  tests:       Task run-tests        (Executor test-runner,        level unit, coverage)  ─▶ TestOutcome
  integration: Task run-integration  (Executor integration-runner, level integration)   ─▶ TestOutcome   when enabled
  api:         Task run-api          (Executor api-runner,         level api)           ─▶ TestOutcome   when enabled
  e2e:         Task run-e2e          (Executor e2e-runner,         level e2e)           ─▶ TestOutcome   when enabled
  mutation:    Task run-mutation     (Executor mutation-runner)                          ─▶ MutationOutcome when enabled
  audit ─▶ ValidationResult
  each runner: Change set ─▶ selection none | affected | full; held if an earlier outcome has a new red
```

## Kinds

| Kind | Change |
|---|---|
| `TestOutcome` | adds `level?` (`unit`, `integration`, `api`, `e2e`; absent is `unit`), `selection?` (`mode`: `none`, `affected`, `full`; `reason`; `changed?[]`: the Change set's files it selected by), `coverage?` (`covered`, `total`: lines of the Change set; `min`: percent, from the Executor) |
| `AcceptanceRecord` | a `verifies[].tests[]` item is a string (a `unit` test) or `{name, level}` |
| `MutationOutcome` | new: `command`, `exitCode`, `head?`, `dirty?`, `selection` (as TestOutcome's), `mutants[]` (`file`, `line`, `mutator`, `status`: `killed`, `survived`, `noCoverage`, `timeout`, `ignored`), `score` (killed and timed out over every status but `ignored`, percent), `min`, `outputTail?` |

## Members

| Member | Content |
|---|---|
| Executor `test-runner` | the `unit` level, as today; `junit/v1` configuration adds `paths`, `fullOn`, `affected` and `coverage` (below); its name stays, so an existing override keeps working |
| Executors `integration-runner`, `api-runner`, `e2e-runner` | `junit/v1`, `level` set; pack placeholders a project overrides by name: `[npm, run, test:integration]` (Testcontainers inside the language's own runner), `[npm, run, test:api]` (a script that starts the app and runs `bru run --reporter-junit`), `[npx, playwright, test]` with its `junit` reporter and `affected: [npx, playwright, test, --only-changed={base}]` |
| Executor `mutation-runner` | `mutation/v1`, configuration `{program, report, min, paths, fullOn}`; placeholder `[npx, stryker, run, --incremental, --mutate, "{files}"]`, `report: reports/mutation/mutation.json`, `min: 90`; PIT with its mutation-testing-elements plugin, Infection and Stryker.NET write the same report |
| Tasks `run-integration`, `run-api`, `run-e2e` | as `run-tests`, with inputs `record`, `repository`, `baseline` (the level's), `held` (the outcomes before it this round); output id `<record>-<level>` |
| Task `run-mutation` | inputs `record`, `repository`, `baseline` (the `unit` one, for `head`), `held`; output `mutation`, a MutationOutcome, id `<record>-mutation` |
| `build-work` | the runners after `implement`, in the order of the diagram, one after the other (they share the workspace and its ports); a runner's step `when: inputs.levels.exists(l, l == '<level>')`; `audit` reads every outcome present |
| `build-one`, `build-all` | input `levels` (array of `integration`, `api`, `e2e`, `mutation`; default `[]`): what the project has; `unit` always runs; `carry` adds each outcome as its `previous…` |
| Validator `acceptance-evidence` | takes one optional outcome per level and the MutationOutcome; resolves a row's test in its level's outcome; findings below |
| Workflow `verify-all` | every enabled level with `selection` forced `full`, mutation excluded (the `release` tier's) |
| Validator `plan-regression` | `sdd/v1`, `checkRegression({outcomes, baselines})`: `suite-empty`, `suite-failed`, `suite-baseline`, `suite-exit` per level, as `checkAcceptance` reads them |
| Prompt `audit-rules` | adds: a scenario whose When crosses the API or the UI, proven only by a `unit` test, is `test-unfit` |

## Selection

`junit/v1` and `mutation/v1` select in `prepare`, before the program runs. The shared runner
awaits `prepare` before `command`, passes it the Engine callback `call`, and takes an answer from it
in place of running the program (a `none` selection). Configuration:

| Field | Rule |
|---|---|
| `level` | `unit`, `integration`, `api`, `e2e`; default `unit` |
| `paths[]` | globs, relative to the workspace, of the code this level tests; default `["**"]` |
| `fullOn[]` | globs whose change runs the level in full: lockfiles, build files, the test setup; default the stack's manifest files |
| `affected[]` | optional: the program narrowed to the Change set; `{base}` becomes the baseline's `head`, `{files}` the changed files under `paths` joined by spaces; absent, the level runs `program` |
| `coverage?` | `{report, min}`: a Cobertura XML file the program writes and the minimum percent of the Change set's lines it covers; `unit` only |

The Change set is `git diff --unified=0 <baseline head>` plus every untracked, unignored file
(`git ls-files --others --exclude-standard`), all its lines changed. The runner decides once:

| Case | `selection.mode` |
|---|---|
| an outcome in `held` has a red case its baseline did not have red | `none`, reason `held: <level>` |
| no baseline, or the baseline has no `head` (not a git repository) | `full` |
| a changed file matches `fullOn` | `full` |
| a changed file matches `paths`, or the record names a test of this level | `affected` with `affected[]`, else `full` |
| otherwise | `none`, reason `untouched` |
| `affected` ran and a test the record names for this level is not in the outcome | runs again `full`; the outcome is the second run's |

A `none` outcome answers `tests: []` without running the program. Coverage and the mutation run
take only the Change set's files under `paths`.

## `checkAcceptance` findings

The table in `35-build-process.md` holds, read per level. New or changed:

| Code | Finding |
|---|---|
| `suite-empty` | not raised for a `none` outcome |
| `level-held` | info: a level held back by a red one; its rows are not `test-missing`, and the round already fails |
| `test-missing` | a test a row names is not in its level's outcome, or that level did not run |
| `coverage-low` | `covered / total` of the `unit` outcome is below `min`; its message names the uncovered changed lines, a file and its ranges; no finding when `total` is 0 |
| `coverage-unread` | `coverage` is configured and its report was not read |
| `mutation-low` | the MutationOutcome's `score` is below `min`; its message lists each surviving mutant, file, line and mutator |
| `mutation-exit` | `mutation/v1` read no report: the output tail |

## Rules

| Rule | Enforcer |
|---|---|
| a test the record names always runs, whatever selection says | `junit/v1` re-runs `full`; `test-missing` |
| a level not touched by the Change set does not run in a round | `junit/v1`, `mutation/v1` selection |
| when unsure, run more: no baseline head, a `fullOn` match, a named test not selected | selection table |
| a level after a red one is held, cheapest first | `held` input; `level-held` |
| coverage and mutation are measured over the Change set, never the whole repository | `junit/v1`, `mutation/v1`; `coverage-low`, `mutation-low` |
| the minimums are the project's: the Executor sets them, the outcome records them, the Gate reads them from the outcome | Executor override by name |
| the project's command starts what its tests need: the app, a browser, a container; persimmon starts nothing | convention; the Executor's `program` |
| every enabled level runs in full once after the last task; a red case its baseline lacks fails the run `plan_regressed` and is investigated as an `Issue` | `verify-all`, `plan-regression`; AGENTS.md section 6 |
| a project enables only the levels it has; `unit` alone is the build of `35-build-process.md` | `levels` input |

## Decisions

- One Executor per test level, not one command running every level: a level is triggered, held and
  tolerated on its own, and its baseline is its own. Bruno, Playwright and a runner using
  Testcontainers all write JUnit XML, so `junit/v1` reads every level; persimmon adds no dependency
  for them. Testcontainers is a library inside the integration tests, not a runner. Found in design review.
- `test-runner` stays the `unit` level's name: every project that overrides it keeps working, and a
  project with one command for every kind of test stays a `unit`-only build. Found in design review.
- Selection lives in the runner's `prepare`, not in Workflow `when`s: a `when` reads a step's
  outputs, which are references, not the content of a TestOutcome, and the globs are the Executor's,
  which no Workflow reads. The Workflow decides only whether a level is enabled. Found in design review.
- The runner's `prepare` moves before `command`, is awaited and gets `call`: it was synchronous,
  ran after the command was chosen and had no callback, so it could neither read the record nor
  pick `affected[]`. A spike made the move and fetched the record there with `getArtifact`: its
  content reached the command line, and every adapter test passed with the move. `junit/v1` is the
  only driver with a `prepare`. The engine already serves `getArtifact` to a call token. Not in the
  spike: `prepare` answering without running the program, and `run-baseline`, which has no record.
  Found in a spike.
- The Change set is measured from the baseline's `head`, not from the start of each task:
  persimmon never commits, so a task's own changes have no commit to diff from. `T-3`'s Change set
  holds `T-1`'s and `T-2`'s, which already passed, a known ceiling; a tree snapshot before each
  `implement` is the upgrade. Found in design review.
- Named tests run whatever the globs say, through a `full` re-run when `affected` missed one: the
  runner cannot run one test by name across vitest, Playwright and Bruno, and a re-run is
  tool-agnostic. A row names its level, `{name, level}`, so the runner knows which names are its own;
  a bare string stays a `unit` test, so committed records still validate. Found in design review.
- Coverage and the mutation score are measured over the Change set: a whole-repository minimum fails
  every task of a project that starts below it, as a red test the baseline had would without the
  baseline. The tools' own thresholds are whole-repository, so persimmon computes the changed lines
  itself from a Cobertura report, with `@xmldom/xmldom` already in `junit/v1`. JaCoCo's own XML is
  not read; a project converts it. Found in design review.
- The minimums default to 90 percent, coverage and mutation both, as the user set them. A mutation
  score that high on changed code meets equivalent mutants, which no test can kill; a project lowers
  `min` in its override, and the survivor list in `mutation-low` says which mutants to judge. Found
  in design review.
- Mutation is its own kind and Adapter, not a TestOutcome: it holds mutants, not test cases, and its
  report is mutation-testing-elements JSON, read with `JSON.parse`. Stryker, PIT (through its plugin),
  Stryker.NET and Infection write it; Python's tools do not, a known gap. Found in design review.
- Levels run one after the other, cheapest first, and a level after a new red is held: a red `unit`
  round needs no browser to tell the builder so, and levels sharing one workspace would contend for
  its ports and containers. Parallel levels in their own workspaces is the upgrade. Found in design review.
- The `plan` tier fails the run, `plan_regressed`, and the developer investigates it as an Issue:
  no task can be blamed for it, since every task passed its round and nothing was committed in
  between to bisect. A full mutation run is not in it: that is the `release` tier, which needs a
  release process first. Found in design review.
- A level's baseline is taken in full, once per `build-all`, as `unit`'s is: a slow `e2e` suite costs
  one more run, and without it an old red `e2e` test blocks every task. Found in design review.

## Units

1. `TestOutcome` `level`, `selection` and `coverage`; the record row's `{name, level}`; the `MutationOutcome` kind; examples.
2. The runner's `prepare` awaited before `command`, with `call`, and able to answer without running; then the Change set and selection in `junit/v1`'s `prepare`, the record and baselines read through `call`.
3. Coverage over the Change set from a Cobertura report.
4. `checkAcceptance` per level: `level-held`, `coverage-low`, `coverage-unread`.
5. Executors `integration-runner`, `api-runner`, `e2e-runner`; Tasks `run-integration`, `run-api`, `run-e2e`; `levels` through `build-work`, `build-one` and `build-all`.
6. `mutation/v1`, Executor `mutation-runner`, Task `run-mutation`, `mutation-low`, `mutation-exit`.
7. The `plan` tier: `verify-all`, `checkRegression`, `plan-gate`, `plan_regressed`; AGENTS.md section 6.
8. `audit-rules`: a boundary-crossing scenario proven by a `unit` test is `test-unfit`.
9. A live UAT: a project with all four levels and Stryker, a task touching only the domain (`unit` and mutation run, the rest `untouched`), then one touching the API.
