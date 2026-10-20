# Test process

status: active · layer: 2 (`35-build-process.md`, `36-test-levels.md`, `31-architecture-process.md`, `29-design-process.md`) · schema: the `TestHarness`, `TestDesign` and `TestReport` kinds in `packs/sdlc/global/10-artifact-kinds.yaml`

Testing is decided and written apart from the code. A Tester records the project's test tools once,
in a TestHarness. Per Spec, an agent designs the test cases before any task is built, in a
TestDesign a human confirms. Inside each `build-one` round the Tester writes the `api` tests before
the code and the `e2e` tests after it; the Builder writes the code and its `unit` and `integration`
tests. Every test carries the id of the test case it runs, and the Gate matches by that id. After
`build-all` a script writes the TestReport: each case's result, coverage per scenario and
requirement, and a verdict.

```text
Architecture, the app skeleton
  ─▶ ReviewLoop setup-tests (once per product)
       produce: Workflow harness-work
                Task write-harness (Executor tester) ─▶ TestHarness <architecture>-harness
                Task run-seed (test-runner), Task run-seed-levels (level-runner) ─▶ TestOutcomes
       review:  Gate harness-gate = harness-evidence (sdd/v1), then harness-confirmed (a human)
Spec, Plan, Designs, TestHarness
  ─▶ ReviewLoop test-design-one per Spec, repeated by Workflow test-design-all
       produce: Task design-tests (Executor test-design-agent) ─▶ TestDesign <spec>-tests
       review:  Gate test-design-gate = test-design-consistency (sdd/v1), then test-design-audited
                (Task audit-test-design), then test-design-confirmed (a human)
Plan, TestDesign, TestHarness
  ─▶ Workflow build-all
       baseline, level-baselines                                     as 36-test-levels.md
       each: ReviewLoop build-one per T-n, produce Workflow build-work:
         Task select-cases     (Executor case-selector)  the task's cases by level, and which the Tester writes
         Task write-api-tests  (Executor tester)   the task's api cases, before the code; when it has some
         Task implement        (Executor builder)  the code, its unit and integration cases ─▶ AcceptanceRecord
         Task write-e2e-tests  (Executor tester)   the task's e2e cases, against the running app; when it has some
         Task run-tests, Task run-levels                             as 36-test-levels.md
         Task audit-acceptance (Executor auditor)  each case's tests against the case
       review: Gate build-gate = acceptance-evidence (sdd/v1, by case id) + acceptance-audited (cel)
       final, final-levels                                           as 36-test-levels.md, unit in full
       Task evaluate-tests (Executor auditor) ─▶ evaluation
       Task report-tests (Executor test-reporter) ─▶ TestReport <plan>-test-report
       Gate regression-gate = plan-regression (sdd/v1) + report-verdict (cel); refused ─▶ Failed plan_regressed
```

The run order becomes `author-prd`, `domain-discovery`, `architect`, `spec-all`, `design-all`,
`design-system` before a `ui` `design-all`, `plan-all`, `setup-tests`, `test-design-all`,
`build-all`: the Plan reads no case, and `setup-tests` needs the app's skeleton, which the build's
side of the order brings. Without a TestDesign bound, `select-cases` answers no case, both Tester steps are
passed by, and `build-one` is the build of `35-build-process.md`.

## Kinds

| Kind | Content |
|---|---|
| `TestHarness` | `architecture` (artifact id); `levels` a map by test level, `unit` required, each `{tool, run, one, affected?, fullOn?, junit, paths?, testDir, seed, conventions}`: the tool and its version, the suite command, the command for one test with `{test}`, the Change set command of `36-test-levels.md`, the globs, the JUnit XML path, where its tests live, the seed test's name as the JUnit XML gives it, and how a test of this level is written here (fixtures, test data reset, the title carrying a case id); `unit` also `coverage?` `{report}` and `mutation?` `{program, report, paths?}`; `app?` `{start, ready}`: the command that starts the app and the URL that answers once it is up; `openQuestions[]` |
| `TestDesign` | `spec`, `harness` (artifact ids); `cases[]` (`TC-n` from 1): `title`, `verifies[]` (`AC-n`, `QS-n`, `BR-n`, `FR-n`; at least one `AC-n` or `QS-n`), `level`, `priority` (`P0` to `P3`), `execution` (`automated`, `manual`), `preconditions[]`, `data[]?`, `steps[]` (`{action, expected?}`), `expected`; `openQuestions[]` |
| `TestReport` | `plan`, `spec`, `testDesign` (artifact ids), `head?`; `verdict` (`result`: `pass`, `concerns`, `fail`; `rule`: the clause that decided it; `thresholds`); `cases[]` (`case`, `level`, `priority`, `execution`, `status`, `reason?`, `tests[]` `{name, status}`); `coverage[]` (`ref`: an `AC-n`, `QS-n`, `BR-n` or `FR-n`; `status`; `cases[]`); `levels[]` (`level`, `selection`, `passed`, `failed`, `skipped`); `defects[]` (`record`, `defect`, `observed`); `evaluation` (`summary`, `residualRisks[]`) |
| `AcceptanceRecord` | `verifies` becomes optional and is not read when a TestDesign is bound: the test names carry the case ids |

A case of level `unit` or `integration` may leave `steps` empty: its `AC-n`'s Given/When/Then is
then the case, not restated. A case of level `api` or `e2e`, or a `manual` one, has its steps.

A test runs a case when its `classname > name` holds the case's qualified id `<CAP-n>/TC-n` as a
whole token, `CAP-n` the Spec's capability: `TC-n` alone repeats across Specs. One test may run
several cases; one case may have several tests.

## Members

| Member | Content |
|---|---|
| Executor `tester` | `cli-human/v1`, `type: human`, as `builder` (`35-build-process.md`): the developer's agent answers the form in a fresh subagent, never in the Builder's context; an unattended Namespace overrides it by name |
| Executor `test-design-agent` | `claude-code/v1`, read only, as `plan-agent` |
| Executors `case-selector`, `test-reporter` | `testdesign/v1`, `type: script`; `test-reporter`'s configuration `{thresholds: {p0: 100, p1: 90, p1Concerns: 80, overall: 80}}`, a project overriding it by name |
| Adapter `testdesign/v1` | an executor on the shared runner that runs no program: in `prepare` it reads the artifacts bound through `getArtifact` and answers `selectCases` or `buildReport` from `adapters/sdd/check.mjs`, by the Task's output port (`cases` or `report`) |
| Prompt `harness-rules` | per test level, the tool the Architecture's `testing` concepts or its Adrs name, else the one the repository already has, else a `Q-n`, never one chosen; a level the Designs need (an `http-api` Design: `api`; a `ui` Design: `e2e`) and the project lacks is scaffolded; every level gets one seed test that passes on the app as it is; the commands are the project's own scripts, written once; an `api` or `e2e` level's `conventions` say how a test asserts a refused request, its `4xx` or `5xx` status, so the client in use never throws on one; never a change to the app's code |
| Task `write-harness` | inputs `architecture`, `adrs`, `designs` (artifacts), `repository`, `previous`, `feedback`; output `harness`, id `<architecture>-harness`; `workspace: {input: repository}`; `sideEffects: nonIdempotent` |
| Tasks `run-seed`, `run-seed-levels` | as `run-baseline` and `run-levels` with no Plan: inputs `harness`, `repository`; ids `<harness>-seed`, `<harness>-seed-levels` |
| Validator `harness-evidence` | `sdd/v1`, `checkHarness`, below; with `previous?`, the last round's harness, so an answer already told is not told again |
| Task `confirm-harness`, Validator `harness-confirmed` | the human reads the harness once its seed tests pass and answers each open `Q-n`, on `local-reviewer` |
| Prompt `test-design-rules` | at least one case per `AC-n` and per `build` `QS-n` the Spec cites; the level from the boundary the scenario's When crosses: the API `api`, a screen `e2e`, a store or a queue `integration`, a rule inside one block `unit`; steps and data from the Designs' operations and screens, the Glossary's terms; `P0` when a failure loses data, money or access or stops the capability's main path, `P1` a variant of the main path or a rule's edge, `P2` a secondary path, `P3` the rest; `P0` is `automated`; a case the harness's tools cannot run is `manual`, the reason in `preconditions`; a case's steps use only the operations its Plan task, or a task before it, builds; a rule's threshold the Spec has no scenario at or beside is no case but a `Q-n` whose answer names the Spec in `upstream` |
| Task `design-tests` | inputs `spec`, `plan`, `base?` (the Spec's TestDesign before this run), `architecture`, `designs` (artifacts), `glossary`, `rules`, `harness`, `previous`, `feedback`; output `testDesign`, id `<spec>-tests`; read only |
| Validator `test-design-consistency` | `sdd/v1`, `checkTestDesign`, below; inputs add `plan`, `designs`, `base?` and `previous?`, the last round's TestDesign, so an answer already told is not told again |
| Task `audit-test-design`, Validator `test-design-audited` | `draft-audit-rules`, its part for a TestDesign: a case's level stops short of the boundary its scenario's When crosses, its steps do not reach its expected, its expected is not the scenario's Then with its values (`case-unfit`); a rule's threshold with no case beside it is `boundary-untested` when the Spec has a scenario there and `spec-gap` when it has none, both warnings |
| Task `confirm-test-design`, Validator `test-design-confirmed` | the human reads the cases before code exists, on `local-reviewer` |
| ReviewLoop `test-design-one`, Workflow `test-design-all` | `maxRounds: 3`; `repeat` over `capabilities` as `plan-all`, the Spec of `CAP-n` bound by id, and `base` to its TestDesign `<spec>-tests` when one exists (`fromArtifact`, `onMissing: omit`) |
| Task `select-cases` | inputs `plan`, `taskId`, `spec`, `testDesign?`, `feedback?`; output `cases` (value): the task's qualified case ids by level, the `manual` ones, and `write: {api, e2e}`, true in round one when the task has cases of that level and later when an `error` finding names one; a warning (`question-upstream`, `defect-reported`) refuses no round, so it calls no Tester back |
| Prompt `test-writing-rules` | write only the cases given, one test per case unless its `data` holds several rows; the test's title holds `<CAP-n>/TC-n`; follow the level's `conventions` and its seed test; the level's tool as the harness names it, never another; run each test with the level's `one`; a test of a case the code does not yet do is red, never skipped; never edit a file outside the level's `testDir` |
| Tasks `write-api-tests`, `write-e2e-tests` | inputs `plan`, `taskId`, `spec`, `designs`, `testDesign`, `harness`, `cases`, `repository`, `feedback?`; output `written` (value: `files[]`, `cases[]`); `write-e2e-tests` starts the app with the harness's `app.start` and walks each step in the browser before it writes the test, as Playwright's generator does |
| Task `implement` | adds inputs `testDesign`, `harness`, `cases`, `written`; `build-rules`: with cases bound, the task's `unit` and `integration` cases are the Builder's and `verifies` is left out; a Tester's test the Builder holds wrong is a `Q-n` naming the case, never an edit |
| Tasks `run-tests`, `run-levels`, `run-baseline`, `run-final` | add input `harness`: `junit/v1` reads the levels from it when bound, the Executor keeping the coverage and mutation minimums (90 when it names none); `run-tests`, `run-levels` add `cases`: the case ids a level must run, as the record's names did; `run-final` adds `testDesign`: the `plan` tier then runs `unit` in full, since the report reads every case |
| Prompt `audit-rules` | with cases bound, reads each case of the task and the tests that carry its id: they set up its preconditions, do its steps and assert its expected; `test-unfit` names the case |
| Validator `acceptance-evidence` | adds `testDesign`: by case, below |
| Task `evaluate-tests` | Executor `auditor`, read only; inputs `testDesign`, `final`, `finals`, `records`; output `evaluation`: a summary in the Glossary's words and the residual risks (`manual` and `notrun` cases, flaky tests, reported `D-n`) |
| Task `report-tests` | Executor `test-reporter`; inputs `plan`, `tasks` (the ones built), `spec`, `testDesign`, `final`, `finals`, `records` (the Plan's AcceptanceRecords, `fromQuery`), `evaluation`; output `report`, id `<plan>-test-report` |
| Validator `report-verdict` | `cel` over `report?`: refused when `verdict.result` is `fail`; passes with no report |

## `checkHarness`

Every finding `error`:

| Code | Finding |
|---|---|
| `not-a-harness` | content without `levels.unit`; the only finding then |
| `architecture-mismatch` | `architecture` is not the artifact bound |
| `level-unrun` | a level of the harness with no outcome among the seed runs |
| `suite-empty` | a level's seed run read no test |
| `seed-missing`, `seed-failed` | a level's seed test is not in its outcome, or is not green |

## `checkTestDesign`

Every finding `error`:

| Code | Finding |
|---|---|
| `not-a-test-design` | content without `cases` or `spec`; the only finding then |
| `spec-mismatch`, `harness-mismatch` | `spec` or `harness` is not the artifact bound |
| `scenario-uncovered` | an `AC-n`, or a `build` `QS-n` the Spec cites, that no case verifies |
| `unknown-reference` | a `verifies` id the Spec, its rules or its `qualities` lack |
| `case-unanchored` | a case that verifies no `AC-n` and no `QS-n` |
| `level-unavailable` | a case's level the harness has not |
| `steps-missing` | an `api`, `e2e` or `manual` case without steps |
| `p0-manual` | a `P0` case that is `manual` |
| `case-renumbered` | with `base` bound, a `TC-n` of the base whose `AC-n` and `QS-n` share none with the case holding that id now |
| `step-premature` | an `api` step whose `METHOD /path` is a Design element only a Plan task after the case's task realises; the case's task is the first whose `verifiedBy` holds a scenario it verifies |
| `id-sequence` | `TC-n` not unique and increasing |

## `acceptance-evidence` by case

A task's cases are the TestDesign's cases that verify a scenario in the task's `verifiedBy`.

| Code | Finding |
|---|---|
| `case-untested` | an `automated` case of the task that no test in its level's outcome carries, or whose level did not run |
| `case-level` | a test carrying the case is only in another level's outcome |
| `case-failed`, `case-skipped` | a test carrying the case failed or errored, or every one was skipped |
| `case-manual` | info: the task's `manual` cases, which no test runs |

`test-missing`, `test-ambiguous`, `test-dropped`, `scenario-unrecorded`, `scenario-duplicate` and
the record's `unknown-scenario` rows are not raised with a TestDesign bound: no row names a test.
The rest of `35-build-process.md` and `36-test-levels.md` holds, `suite-failed` reading every test
that carries a case of the task as named.

## `buildReport`

| Status | Of a case | Of a scenario or requirement |
|---|---|---|
| `ok` | every test carrying it passed | every case verifying it `ok` |
| `nok` | a test carrying it failed or errored | a case verifying it `nok` |
| `notrun` | `manual`, its level not run, no test carrying it, or every one skipped | no case `nok`, one `notrun` |
| `uncovered` | – | no case verifies it |

A case reads its tests in the `plan` tier's outcome of its level. A case only an unbuilt task of
the Plan verifies is `notrun`, reason `task not built`, and out of the rates and the verdict: a
run building `T-1` is judged on `T-1`'s cases. A rate is the share of cases `ok`; a priority with
no case has none to miss.

| Verdict | Rule, first match |
|---|---|
| `fail` | a case `nok`; an `AC-n` or `build` `QS-n` `uncovered`; `P0` below `p0`; `P1` below `p1Concerns`; all cases below `overall` |
| `concerns` | `P1` below `p1` |
| `pass` | otherwise |

## Rules

| Rule | Enforcer |
|---|---|
| the tools are recorded once, by the Tester, and every runner and test-writing Task reads them from the TestHarness | `harness-rules`, `harness-evidence`, `junit/v1` |
| a level's tool comes from the Architecture or its Adrs, else the repository; never a choice the Tester makes | `harness-rules`; the human at `harness-gate` |
| an open `Q-n` of a TestHarness or a TestDesign is answered by the human at its Gate; an agent never writes a `resolution` the inputs and the feedback do not give | `harness-rules`, `test-design-rules`; `confirm-harness`, `confirm-test-design` |
| every acceptance scenario and `build` quality scenario has a case, its level decided before code | `checkTestDesign`, the Auditor, a human |
| a case tests only what a scenario of the Spec says; a threshold no scenario covers is the Spec's gap, raised as a `Q-n` on the Spec, never a case | `test-design-rules`, `case-unfit`, `spec-gap` |
| the Tester writes the `api` and `e2e` tests, the Builder the code and the `unit` and `integration` tests | Tasks, `build-rules`, `test-writing-rules` |
| the Builder never edits a Tester's test; one it holds wrong is a `Q-n` | `build-rules`; the Auditor holds each test to its case; the developer's diff review |
| a test carries the qualified id of the case it runs; the Gate matches by it | `acceptance-evidence` |
| the report is computed, not written: an agent writes only its evaluation | `report-tests` on a script Executor |
| a `fail` verdict fails the run, and a regression still does | `regression-gate` |

## Decisions

- Testing is its own process with its own role, the Tester, not a part of the Builder's prompt. The
  Builder was asked to choose each scenario's level, write every level's tests and name them, with
  no word on the project's tools: asked how an api test knows it is Bruno, the answer was that it
  does not. Every shipped system separates them: BMAD's Test Architect, addyosmani's
  `test-engineer` persona, Playwright's planner, generator and healer, Octomind and QA Wolf. Found in
  UAT review.
- The tools are one artifact, the TestHarness, read by the runners and the Tasks alike. BMAD's
  `framework` step and `test_framework` setting, Playwright's seed test, spec-kit's `Testing` field
  and addyosmani's "discover the stack first" each record the stack once. The Executor override per
  level was the only record, and no Task reads an Executor (decision 451). The harness is checked by
  running each level once and finding its seed test green. Found in design review.
- Test cases are designed per Spec before the build, in one TestDesign a human confirms: the level of
  each case is decided before code, as BMAD's `test-design` and Playwright's `specs/*.md` plan do,
  not judged by the Auditor after it. An agent writes it, read only, as the Plan's: it needs the
  Spec and the Designs, not the app. One artifact holding the cases, not a `TestCase` per case (the
  roadmap's): the cases of a Spec revise together under one Gate. The Plan does not cite cases: a
  task's cases are those verifying its `verifiedBy`, so the Plan and its check stay as they are.
  Found in design review.
- A test carries its case's id in its title, `<CAP-n>/TC-n`, and the Gate matches by it, as BMAD's
  criterion registry, TestRail's case ids and Allure's `@AllureId` do. The Builder's hand-written
  name mapping, which `test-missing` and `test-dropped` chased round after round, goes. Qualified by
  capability, since each Spec numbers its cases from 1. Found in design review.
- The Tester writes the `api` tests before the code and the `e2e` tests after it. An `api` test
  needs only the http-api Design's contract, so it is written red first, as BMAD's ATDD red mode
  does; an `e2e` test needs the screens' real selectors, so it is written against the running app,
  as Playwright's generator does. The Builder writes `unit` and `integration` tests: they test what
  it builds inside a block, which no test written before the code can name. Found in design review.
- The Tester is `cli-human/v1`, answered by the developer's agent in a fresh subagent: writing
  `api` and `e2e` tests needs the app, the browser and the network, as building does (decision 440),
  and a fresh context keeps the Builder's view out of the tests. Found in design review.
- A script step, `select-cases`, opens each round: a Workflow skips a step only by routing around
  it from a step before it (`11-workflow.md`), and a `when` reads values, not an artifact's content.
  It answers the task's cases and whether the Tester writes this round: in round one when the task
  has cases of the level, later only when a finding names one, so a round refused for the code alone
  does not wait on the Tester. Found in implementation.
- `select-cases` and `report-tests` run on their own Adapter, `testdesign/v1`, not `subprocess/v1`:
  a script on `subprocess/v1` gets the payload without the Engine callbacks, so it cannot read an
  artifact's content; the shared runner's `prepare` has `getArtifact` and may answer without running
  a program, as `junit/v1`'s does for a level it selects out. Found in implementation.
- No hash check on the Tester's files. Hashing each file when the Tester answers needs one more step
  per Tester step, and the Auditor already refuses a test that no longer does its case's steps; the
  developer reads the diff before committing. Found in implementation.
- The TestReport is computed by a script, and an agent writes only its evaluation: a count from an
  agent is a guess. Statuses are Xray's (`ok`, `nok`, `notrun`, `uncovered`; its `unknown` is not
  needed, the vocabulary being ours). The verdict thresholds are BMAD's `trace` gate: `P0` 100,
  `P1` 90 for `pass` and 80 for `concerns`, all cases 80. The `plan` tier runs `unit` in full under
  a TestDesign, so every case has a result over the last tree. Found in design review.
- An open question of a TestHarness or a TestDesign goes to the human at the Gate, not to the
  check. In the live run `question-open` refused each TestDesign with an open `Q-n` before the human
  saw it, and in round two the agent closed six questions itself, under the human's name. The
  upstream checks (`checkPrd`, `checkSpec`, `checkPlan`) leave a question to the confirm Task as
  well. `harness-gate` had no human at all, so a harness `Q-n` could not be answered in an
  unattended run; it gains one after the seed runs. Found in UAT.
- The TestDesign reads the Plan, and a case's steps use only what its task, or one before it,
  builds. In the live run a `P0` case of `T-1` checked submission and the claim list, which `T-3`
  and `T-4` build, so its test could not pass after `T-1`. `plan-all` already runs before
  `test-design-all`. An operation no task realises is the Plan's gap and `checkPlan`'s, not this
  check's. Found in UAT.
- An `api` level's conventions say how a test asserts a refused request. In the live run the Bruno
  seed and conventions covered only a `2xx` answer; the Tester's test of a `403` failed on the
  client throwing, the builder answered `204` to make it pass and raised a question, and a round
  went to settle what one line of the harness should have said. Found in UAT.
- A TestDesign written again starts from the one it replaces, `base`, and keeps every case's id.
  In the live run a fresh `test-design-one` wrote the cases from scratch: `TC-5` became `TC-4`
  and `TC-10` became `TC-11`, and the Tester had to retitle tests that already passed, since a
  test is found by its case's id. Within one loop `previous` already kept the ids; across runs
  nothing did. The check compares by the scenarios a case verifies, since a case's title and steps
  may rightly change. Found in UAT.
- A rule's threshold the Spec has no scenario for is the Spec's gap, not a case. In the live run
  the auditor warned `boundary-untested` on BR-4's accepted side, the writer added a case citing a
  scenario that did not say it, the auditor then refused that case `case-unfit`, and the loop ran
  out of rounds with the gap never reaching the human: the writer was asked for a case nothing
  could back. Now the writer raises a `Q-n` on the Spec, the auditor tells the two apart
  (`boundary-untested` a missing case, `spec-gap` a missing scenario), and the answer at the Gate
  names the Spec in `upstream`, told as `question-upstream`. The answer is recorded and nothing
  rests on it yet: in the live run a reviewer asked in one breath for the scenario and a case citing
  it, which the check would refuse until the Spec's revision exists; the case comes with the next
  run's `base`. A case kept from `base` is held to the same rule: one that tests what no scenario
  says is removed and becomes the question, since the live rerun kept such a case from a TestDesign
  written before the rule and lost its last round to it. Found in UAT.
- `select-cases` reads only the `error` findings of the last round. In the live run a
  `question-upstream` warning quoting `TC-11` called the Tester back to a round refused for an open
  question alone; the Tester re-ran its tests and changed nothing. Found in UAT.
- `harness-evidence` and `test-design-consistency` read the last round's document. Without it
  `question-agent-resolved` warned of every resolution in every round, the human's own answers
  from round one among them, since the warning names only what the last round did not have
  (`23-pack-sdlc.md`). Found in UAT.
- Not adopted: `TestRun` and `TestResult` kinds (a TestOutcome is already one run of one level at
  one commit); a test plan document (ISO 29119-3's agile example puts its content in the plan, here
  the Plan and the harness); a `waived` verdict (it needs a human sign-off of its own, later); a test
  quality score and an NFR assessment (the Auditor judges each test; non-build quality scenarios are
  the `release` tier's). Found in design review.

## References

BMAD Test Architect, https://github.com/bmad-code-org/bmad-method-test-architecture-enterprise ;
Playwright Test Agents, https://playwright.dev/docs/test-agents ; spec-kit,
https://github.com/github/spec-kit ; addyosmani/agent-skills,
https://github.com/addyosmani/agent-skills ; Xray coverage statuses,
https://docs.getxray.app/display/XRAY/Understanding+coverage+and+the+calculation+of+Test+and+requirement+statuses ;
TestRail automation linking, https://github.com/gurock/trcli ; Allure test keys,
https://docs.qameta.io/allure-testops/briefly/test-cases/test-keys/ ; ISO/IEC/IEEE 29119-3:2021,
https://standards.ieee.org/ieee/29119-3/7499/
