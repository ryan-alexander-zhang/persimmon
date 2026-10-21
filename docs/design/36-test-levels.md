# Test levels and tiers

status: draft · layer: 2 (`35-build-process.md`) · schema: the `TestOutcome` and `AcceptanceRecord` kinds in `packs/sdlc/global/10-artifact-kinds.yaml`

The build process runs one test command per round. This file splits the project's tests by test level
(`unit`, `fitness`, `integration`, `api`, `e2e`), holds the `unit` level to coverage and mutation minimums,
and decides when each level runs. A `round` tier runs on every `build-one` round, but only the
levels the Change set touches and the tests the record names. Levels run cheapest first, and a
level after a new red is held. A `plan` tier runs every configured level in full once after the
last task, as the backstop for what selection missed. A `release` tier is declared and deferred. A
project configures the levels it has; `unit` alone is the build of `35-build-process.md`. Under the
Test process (`39-test-process.md`) a TestHarness bound names the levels and their commands, the
Executors keeping only the minimums, and a round's case ids stand for the record's names: a level runs
whatever its cases need, and a narrowed run that missed one runs in full again.

```text
Workflow build-all
  baseline:        Task run-baseline (Executor test-runner, unit, full)          ─▶ TestOutcome <plan>-baseline
  level-baselines: Task run-levels   (Executor level-runner, every level, full)  ─▶ TestOutcome <plan>-baseline-levels-<n>
  each:            repeat over tasks ─▶ ReviewLoop build-one per T-n                                    tier round
  final:           Task run-final    (Executor test-runner)                      ─▶ TestOutcome <plan>-final      tier plan
  final-levels:    Task run-levels   (Executor level-runner, every level, full)  ─▶ TestOutcome <plan>-final-levels-<n>
  plan:            Gate regression-gate = Validator plan-regression (sdd/v1); refused ─▶ Failed plan_regressed

Workflow build-work (one round)
  implement ─▶ AcceptanceRecord
  tests:  Task run-tests  (Executor test-runner: unit, then coverage, then mutation) ─▶ TestOutcome <record>-tests
  levels: Task run-levels (Executor level-runner: fitness, integration, api, e2e, in order) ─▶ TestOutcome <record>-levels-<n>
  audit ─▶ ValidationResult
  each level: Change set ─▶ selection none | affected | full; held after a new red
```

## Kinds

| Kind | Change |
|---|---|
| `TestOutcome` | adds `level?` (`unit`, `fitness`, `integration`, `api`, `e2e`; absent is `unit`), `selection?` (`mode`: `none`, `affected`, `full`; `reason`), `newRed?` (red cases its baseline did not have red; every red one without a baseline), `coverage?` (`min`; `covered`, `total`: executable lines of the Change set; `uncovered[]` `{file, lines}`; or `error`), `mutation?` (`min`; `killed`, `survived`, `noCoverage`, `timeout`, `score`: mutants on the Change set's lines; `survivors[]` `{file, line, mutator}`; or `error`); `outputTail` is not required of a `none` outcome |
| `AcceptanceRecord` | a `verifies[].tests[]` item is a string (a `unit` test) or `{name, level}` |

## Members

| Member | Content |
|---|---|
| Executor `test-runner` | the `unit` level, as today; `junit/v1` configuration adds `paths`, `fullOn`, `affected`, `coverage` and `mutation` (below); its name stays, so an existing override keeps working |
| Executor `level-runner` | `exclusive: tests` (`13-executor.md`), so the levels of two worktrees never share the app, browser and containers at once; `junit/v1`, configuration `{levels: {fitness?, integration?, api?, e2e?}}`, each `{program, junit, paths?, fullOn?, affected?}`; the pack's `levels: {}` runs nothing, and a project overrides it by name with the levels it has: `[npm, run, test:integration]` (Testcontainers inside the language's own runner), `[npm, run, test:api]` (a script that starts the app and runs `bru run --reporter-junit`), `[npx, playwright, test]` with its `junit` reporter and `affected: [npx, playwright, test, --only-changed={base}]` |
| Task `run-tests` | adds input `baseline`, for the Change set's base and `newRed` |
| Task `run-levels` | inputs `plan`, `repository`, `record?`, `testOutcome?` (the round's `unit` one), `baselines?` (artifacts); output `outcomes`, an `artifacts` list of TestOutcome, one per configured level in order; id prefix `<record>-levels` in a round, `<plan>-baseline-levels` without a record or baselines, `<plan>-final-levels` with baselines and no record |
| Task `run-final` | inputs `plan`, `repository`, `baseline`; output `final`, id `<plan>-final`; Executor `test-runner` |
| `build-work`, `build-one` | `run-levels` after `run-tests`; outputs and Gate inputs `levelOutcomes` and `levelBaselines` |
| Validator `acceptance-evidence` | takes `levelOutcomes` and `levelBaselines`, paired by `level`; resolves a row's test in its level's outcome; findings below |
| Gate `regression-gate`, Validator `plan-regression` | `sdd/v1` over `final`, `baseline`, `levelOutcomes`, `levelBaselines`: `checkRegression`, `suite-empty`, `suite-failed`, `suite-baseline`, `suite-exit` per level, as `checkAcceptance` reads them |
| Task `audit-acceptance` | adds `levelOutcomes`, so the auditor reads every level's names |
| Prompt `audit-rules` | adds: a scenario whose When crosses the API or the UI, proven only by a `unit` test, is `test-unfit` |

## Selection

`junit/v1` selects in `prepare`, before the program runs. The shared runner awaits `prepare` before
`command`, passes it the Engine callback `call`, and takes an answer from it in place of running the
program. A level's configuration:

| Field | Rule |
|---|---|
| `paths[]` | globs, relative to the workspace, of the code this level tests; default `["**"]` |
| `fullOn[]` | globs whose change runs the level in full: lockfiles, build files, the test setup; default none |
| `affected[]` | optional: the program narrowed to the Change set; `{base}` becomes the baseline's `head`, a `{files}` argument one argument per changed file under `paths`, `{files}` inside an argument those files joined by commas; absent, the level runs `program` |
| `coverage?` | `{report, min}`: a Cobertura or JaCoCo XML file the program writes, the minimum percent of the Change set's executable lines it covers; `unit` only |
| `mutation?` | `{program, report, min, paths?}`: the mutation command, `{files}` as in `affected` (Stryker's `--mutate={files}`), the report it writes (mutation-testing-elements JSON, PIT's `html2/report.js`, or Gremlins' JSON), the minimum score over the Change set's lines, the source to mutate (default the level's `paths`; never the tests); `unit` only, run after the tests when `newRed` is 0 and a changed file under its `paths` is left |

The Change set is `git diff --unified=0 <baseline head>` plus every untracked, unignored file
(`git ls-files --others --exclude-standard`), all its lines changed. A Task with a record runs a
round, one without a record or baselines a baseline, one with baselines and no record the `plan`
tier. Each level decides once:

| Case | `selection.mode` |
|---|---|
| a baseline or the `plan` tier | `full`; `unit` in the `plan` tier without `affected`: `none`, the last round ran it in full over the same tree |
| the round's `unit` outcome, or a level before it, has `newRed` above 0 | `none`, reason `held: <level>` |
| no baseline, or the baseline has no `head` (not a git repository) | `full` |
| a changed file matches `fullOn` | `full` |
| a changed file matches `paths`, or the record names a test of this level | `affected` with `affected[]`, else `full` |
| otherwise | `none`, reason `untouched` |
| `affected` ran and a test the record names for this level is not in the outcome | runs again `full`; the outcome is the second run's |

A `none` outcome answers `tests: []` without running the program. Coverage and mutation take only
the Change set's files under `paths`.

## `checkAcceptance` findings

The table in `35-build-process.md` holds, read per level. New or changed:

| Code | Finding |
|---|---|
| `suite-empty` | not raised for a `none` outcome |
| `level-held` | info: a level held back by a red one; its rows are not `test-missing`, and the round already fails |
| `test-missing` | a test a row names is not in its level's outcome, or that level did not run |
| `coverage-low` | `covered / total` is below `min`; its message names the uncovered changed lines; no finding when `total` is 0 |
| `coverage-unread` | `coverage.error`: the report was not read |
| `mutation-low` | `score` is below `min`; its message lists each survivor, file, line and mutator; no finding with no mutant |
| `mutation-exit` | `mutation.error`: the mutation report was not read |

## Rules

| Rule | Enforcer |
|---|---|
| a test the record names always runs, whatever selection says | `junit/v1` re-runs `full`; `test-missing` |
| a level not touched by the Change set does not run in a round | `junit/v1` selection |
| when unsure, run more: no baseline head, a `fullOn` match, a named test not selected | selection table |
| a level after a new red is held, cheapest first: `unit`, its mutation, `fitness`, `integration`, `api`, `e2e` | `newRed`; `level-held` |
| coverage and mutation are measured over the Change set, never the whole repository | `junit/v1`; `coverage-low`, `mutation-low` |
| the minimums are the project's: the Executor sets them, the outcome records them, the Gate reads them from the outcome | Executor override by name |
| the project's command starts what its tests need: the app, a browser, a container; persimmon starts nothing | convention; the Executor's `program` |
| every configured level runs in full once after the last task; a red case its baseline lacks fails the run `plan_regressed` and is investigated as an `Issue` | `run-final`, `run-levels`, `plan-regression`; AGENTS.md section 6 |
| a project configures only the levels it has; `unit` alone is the build of `35-build-process.md` | `level-runner` override |

## Decisions

- The project's tests split by test level, not one command running every level: a level is
  triggered, held and tolerated on its own, and its baseline is its own. Bruno, Playwright and a
  runner using Testcontainers all write JUnit XML, so `junit/v1` reads every level; persimmon adds no
  dependency for them. Testcontainers is a library inside the integration tests, not a runner.
  Found in design review.
- `test-runner` stays the `unit` level's name: every project that overrides it keeps working, and a
  project with one command for every kind of test stays a `unit`-only build. Found in design review.
- The other levels share one Executor, `level-runner`, a map by level, and one Task answering an
  `artifacts` list, not an Executor and a Task per level enabled by a `levels` input: a Workflow
  cannot keep steps in order and skip one, since a `when`-skipped step's dead Transition skips every
  step after it (`11-workflow.md`), and a binding cannot gather several steps' outputs into a list
  (`10-ports.md`). The list is empty when the project configures no level, so a project enables a
  level by naming it. The first cut, an Executor per level, was found in implementation.
- Selection lives in the runner's `prepare`, not in Workflow `when`s: a `when` reads a step's
  outputs, which are references, not the content of a TestOutcome, and the globs are the Executor's,
  which no Workflow reads. Found in design review.
- The runner's `prepare` moves before `command`, is awaited and gets `call`: it was synchronous,
  ran after the command was chosen and had no callback, so it could neither read the record nor
  pick `affected[]`. A spike made the move and fetched the record there with `getArtifact`: its
  content reached the command line, and every adapter test passed with the move. `junit/v1` is the
  only driver with a `prepare`. The engine already serves `getArtifact` to a call token. Found in a spike.
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
  itself from a Cobertura or JaCoCo report, with `@xmldom/xmldom` already in `junit/v1`. A changed file
  the report omits counts no line, so a project reports every source file (vitest's `coverage.all`,
  coverage.py's `source`). Found in design review.
- The minimums default to 90 percent, coverage and mutation both, as the user set them. A mutation
  score that high on changed code meets equivalent mutants, which no test can kill; a project lowers
  `min` in its override, and the survivor list in `mutation-low` says which mutants to judge. Found
  in design review.
- Mutation is a measure in the `unit` TestOutcome, as coverage is, not its own kind, Adapter and
  step: it runs the unit tests, only once they have no new red, and holds the `unit` level to a
  minimum. Its report is mutation-testing-elements JSON, read with `JSON.parse`; Stryker, PIT
  (through its plugin), Stryker.NET and Infection write it; Gremlins' own JSON is read for Go;
  Python's tools write neither, a known gap. A
  `MutationOutcome` kind, `mutation/v1` and a step of their own were the first cut, found in
  implementation to add a kind, an Adapter and a Gate input for one more number.
- Levels run one after the other, cheapest first, and a level after a new red is held: a red `unit`
  round needs no browser to tell the builder so, and levels sharing one workspace would contend for
  its ports and containers. `newRed` on the outcome carries the verdict to the next runner, which
  has not its baseline; the Gate recomputes it. Parallel levels in their own workspaces is the
  upgrade. Found in design review.
- The `plan` tier fails the run, `plan_regressed`, and the developer investigates it as an Issue:
  no task can be blamed for it, since every task passed its round and nothing was committed in
  between to bisect. It re-runs `unit` only when `affected` narrows it: without, the last round ran
  every unit test over the same tree. A full mutation run is not in it: that is the `release` tier,
  which needs a release process first. Found in design review.
- A level's baseline is taken in full, once per `build-all`, as `unit`'s is: a slow `e2e` suite costs
  one more run, and without it an old red `e2e` test blocks every task. Found in design review.
- `{files}` inside an argument joins the files with commas, and mutation takes its own `paths`:
  Stryker's `--mutate` is one comma-separated argument, and the unit level's `paths` name the tests
  too, since a changed test should run them, while a test file is never mutated. Mutation is skipped
  when no changed source is left to mutate. Found in UAT preparation, against Stryker 10.
- Proven live, no agent: `build-all` over the worked example's `T-1` on a claims app with all four
  levels, real tools: vitest 3 with its JUnit reporter and v8 coverage as Cobertura, Stryker 10 on its
  vitest runner, a Testcontainers test on `alpine`, a Bruno collection behind a script starting the
  app, Playwright 1.64 with its `webServer`. The baselines ran every level in full. The round, one
  changed source file: `vitest related src/claim.js`, coverage 6 of 6 changed lines, Stryker mutating
  that file only, 92.86 percent over 14 mutants on the changed lines; `integration` and `e2e`
  `untouched`; `api` in full for the test the record named, `{name, level: api}`. The plan tier ran
  every level in full, the Gate passed, the run succeeded. Bruno names a case by its `test()` with
  the request URL as `classname`, so a record names it by `name`. Found in UAT.
- A report path resolves to the changed file it is a suffix of, or that is a suffix of it, and a
  report naming a file like a changed one that still resolves to none is an error: PIT names
  `com/x/Claim.java` and Gremlins `claim.go`, not the Change set's `src/main/java/com/x/Claim.java`
  or `claims/claim.go`, so the reader counted no line and the minimum passed unmeasured. A `roots`
  setting was weighed and dropped: the suffix is unambiguous in every report met, and an ambiguous
  one is the error. Found in design review, after the JavaScript trial.
- JaCoCo's own XML and Gremlins' own JSON are read as they are, not converted: no maintained,
  packaged tool converts JaCoCo to Cobertura, and no Go mutation tool writes mutation-testing-elements,
  so a converter would leave Java with no coverage minimum and Go with no mutation one. Each reader
  is a few lines on what the others already score. PIT's plugin writes its report only as a script
  assigning it, `html2/report.js`; the reader takes the object it assigns. Go's coverage still goes
  through `gocover-cobertura`, a `go install` beside `gotestsum`, which Go's JUnit already needs.
  Found in UAT.
- A mutation run that tested none of the change is an error, `mutation-exit`, not a score: mutants on
  the changed lines of which none ran (skipped, ignored, not compiling), or of which every one timed
  out. Gremlins' `--diff` compares commits and skipped every mutant of the uncommitted change; with
  Go's cached test results its timeout was too tight and every mutant timed out, and a timeout
  counts as detected, so both read as a pass. Found in UAT.
- Proven live per language, no agent, `build-all` over `T-1`, `examples/example09` replaying each
  from a fresh copy. Java: Maven, JUnit 5, Failsafe with Testcontainers 2.0.5 (1.x cannot reach
  Docker 29), JaCoCo 3 of 3 changed lines, PIT through a script mapping files to classes: round one
  refused `mutation-low` at 87.5 percent by a real survivor, round two with the test that kills it
  at 100, the plan tier passed. Go: `gotestsum`, `gocover-cobertura` 6 of 6, Gremlins over the
  package with `--timeout-coefficient=30`, testcontainers-go, passed in one round. JavaScript re-run on
  the final readers, unchanged. Bruno and Playwright served all three. Found in UAT.

- `fitness` is a level of its own, run on `level-runner` first, before `integration`: a test that
  reads the code's structure (no Booking write bypassing the Room aggregate, no dependency across
  contexts) starts nothing and is the cheapest after `unit`. The Architecture proves a `build`
  quality scenario by a `test` or a `fitness` method, and the four levels had no place for the
  second: in the live Autopilot run the harness could not record a `fitness` level, the schema
  closing `levels` over four names, so `QS-2` and `QS-3` had no case. Folding them into `unit` was
  rejected: `unit`'s `affected` run selects tests by the files they import, and a test that reads
  source files imports none, so it would run only in full; and `unit` is held to coverage and
  mutation minimums a structural test does not move. Found in UAT.

## Units

1. `TestOutcome` `level`, `selection`, `newRed`, `coverage` and `mutation`; the record row's `{name, level}`; examples.
2. The runner's `prepare` awaited before `command`, with `call`, and able to answer without running; the Change set and selection in `junit/v1`.
3. Coverage over the Change set from a Cobertura report.
4. Mutation over the Change set from a mutation-testing-elements report.
5. `checkAcceptance` per level: `level-held`, `coverage-low`, `coverage-unread`, `mutation-low`, `mutation-exit`.
6. `level-runner` and `run-levels` in `junit/v1`; `levelOutcomes` through `build-work`, `build-one`, `build-gate` and `audit-acceptance`.
7. The `plan` tier: `run-final`, `checkRegression`, `plan-regression`, `regression-gate`, `plan_regressed` in `build-all`; AGENTS.md section 6.
8. `audit-rules`: a boundary-crossing scenario proven by a `unit` test is `test-unfit`.
9. A live UAT: a project with all four levels and Stryker, a task touching only the domain (`unit` and mutation run, the rest `untouched`), then one touching the API.
10. Per language: a report path by suffix; JaCoCo's XML, PIT's `report.js` and Gremlins' JSON read as they are; a mutation run that tested none of the change refused; `examples/example09` in JavaScript, Java and Go.
