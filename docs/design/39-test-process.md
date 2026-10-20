# Test process

status: draft · layer: 2 (`35-build-process.md`, `36-test-levels.md`, `31-architecture-process.md`, `29-design-process.md`) · schema: the `TestHarness`, `TestDesign` and `TestReport` kinds, to be added to `packs/sdlc/global/10-artifact-kinds.yaml`

Testing is decided and written apart from the code. A Tester records the project's test tools once,
in a TestHarness. Per Spec, it designs the test cases before any task is built, in a TestDesign a
human confirms. Inside each `build-one` round it writes the `api` tests before the code and the
`e2e` tests after it; the Builder writes the code and its `unit` and `integration` tests. Every test
carries the id of the test case it runs, and the Gate matches by that id. After `build-all` a script
writes the TestReport: each case's result, coverage per scenario and requirement, and a verdict.

```text
Architecture, the app skeleton
  ─▶ Workflow setup-tests (once per product)
       Task write-harness (Executor tester) ─▶ TestHarness <product>-harness
       Task run-levels (every level, seed tests only) ─▶ TestOutcome
       Gate harness-gate = Validator harness-evidence (sdd/v1)
Spec, Designs, TestHarness
  ─▶ ReviewLoop test-design-one per Spec, repeated by Workflow test-design-all
       produce: Task design-tests (Executor tester) ─▶ TestDesign <spec>-tests
                Task audit-test-design (Executor auditor)
       review:  Gate test-design-gate = test-design-consistency (sdd/v1) + test-design-audited (cel)
                                        + test-design-confirmed (human)
Plan, TestDesign, TestHarness
  ─▶ Workflow build-all
       baseline, level-baselines                                     as 36-test-levels.md
       each: ReviewLoop build-one per T-n, produce Workflow build-work:
         Task write-api-tests  (Executor tester)   the task's api cases, before the code
         Task implement        (Executor builder)  the code, its unit and integration cases ─▶ AcceptanceRecord
         Task write-e2e-tests  (Executor tester)   the task's e2e cases, against the running app
         Task run-tests, Task run-levels                             as 36-test-levels.md
         Task audit-acceptance (Executor auditor)  each case's tests against the case
       review: Gate build-gate = acceptance-evidence (sdd/v1, by case id) + acceptance-audited (cel)
       final, final-levels                                           as 36-test-levels.md
       Task evaluate-tests (Executor auditor) ─▶ evaluation
       Task report-tests (Executor test-reporter, script) ─▶ TestReport <plan>-test-report
       Gate plan-gate = plan-regression (sdd/v1) + report-verdict (cel); refused ─▶ Failed plan_regressed
```

The run order becomes `author-prd`, `domain-discovery`, `architect`, `spec-all`, `design-all`,
`design-system` before a `ui` `design-all`, `setup-tests`, `test-design-all`, `plan-all`,
`build-all`. Without a TestDesign bound, `build-one` is the build of
`35-build-process.md`, so a project adopts the Test process when it is ready.

## Kinds

| Kind | Content |
|---|---|
| `TestHarness` | `product`, `architecture` (artifact id); `levels` a map by test level, each `{tool, run, one, affected?, fullOn?, junit, paths[], testDir, seed, conventions}`: the tool's name and version, the suite command, the command for one test with `{test}`, the Change set command of `36-test-levels.md`, the globs, the JUnit XML path, where its tests live, the seed test's name, and how a test of this level is written here (fixtures, test data reset, how a title carries a case id); `app?` `{start, ready, stop?}`: the command that starts the app the `api` and `e2e` levels need and the URL that answers once it is up; `coverage?` `{report}` and `mutation?` `{program, report}` for `unit`; `openQuestions[]` |
| `TestDesign` | `spec`, `harness` (artifact ids); `cases[]` (`TC-n` from 1): `title`, `verifies[]` (`AC-n`, `QS-n`, `BR-n`, `FR-n`; at least one `AC-n` or `QS-n`), `level`, `priority` (`P0` to `P3`), `execution` (`automated`, `manual`), `preconditions[]`, `data?`, `steps[]` (`{action, expected?}`), `expected`; `openQuestions[]` |
| `TestReport` | `plan`, `spec`, `testDesign`, `harness` (artifact ids), `head`; `verdict` (`result`: `pass`, `concerns`, `fail`; `rule`: the clause that decided it; `thresholds`); `cases[]` (`case`, `level`, `priority`, `status`, `tests[]` `{name, status}`); `coverage[]` (`ref`: an `AC-n`, `QS-n`, `BR-n` or `FR-n`; `status`; `cases[]`); `levels[]` (`level`, `passed`, `failed`, `skipped`, `selection`); `measures[]` (`task`, `coverage?`, `mutation?`); `defects[]` (`record`, `defect`); `evaluation` (`summary`, `residualRisks[]`) |
| `AcceptanceRecord` | `verifies` becomes optional and is not read when a TestDesign is bound: the test names carry the case ids |
| `TestOutcome` | adds `changed[]`: the Tester's files whose content is not what the Tester wrote |

A case of level `unit` or `integration` may leave `steps` empty: its `AC-n`'s Given/When/Then is
then the case, not restated. A case of level `api` or `e2e`, or a `manual` one, has its steps.

A test runs a case when its name, `classname > name`, holds the case's qualified id `<CAP-n>/TC-n`
as a whole token, `CAP-n` the Spec's capability: `TC-n` alone repeats across Specs. One test may
run several cases; one case may have several tests.

## Members

| Member | Content |
|---|---|
| Executor `tester` | `cli-human/v1`, `type: human`, as `builder` (`35-build-process.md`): the developer's agent answers the form in a fresh subagent, never in the Builder's context; an unattended Namespace overrides it by name |
| Prompt `harness-rules` | per test level, the tool the Architecture's `testing` concepts or its Adrs name, else the one the repository already has, else a `Q-n`, never one chosen; a level the Architecture's quality scenarios or the Designs' interfaces need (an `http-api` Design: `api`; a `ui` Design: `e2e`) and the project lacks is scaffolded; every level gets one seed test that passes on the app as it is; the commands are the project's, written once in its own scripts |
| Task `write-harness` | inputs `architecture`, `adrs`, `designs` (artifacts), `repository`, `previous`, `feedback`; output `harness`, id `<product>-harness`; `workspace: {input: repository}`; `sideEffects: nonIdempotent` |
| Validator `harness-evidence` | `sdd/v1` over `harness` and the seed run's `levelOutcomes`: every level of the harness ran, its seed test passed, no `Q-n` open |
| Prompt `test-design-rules` | at least one case per `AC-n` and per `build` `QS-n` the Spec cites; a case whose scenario's When crosses the API is `api`, the UI `e2e`, a rule inside one block `unit`, a store or a queue `integration`; steps and data from the Designs' operations and screens, the Glossary's terms; `P0` when a failure loses data, money or access or stops the capability's main path, `P1` a variant of the main path or a rule's edge, `P2` a secondary path, `P3` the rest; `P0` is `automated`; a case the tools cannot automate is `manual`, with the reason in `preconditions` |
| Task `design-tests` | inputs `spec`, `architecture`, `designs` (artifacts), `glossary`, `rules`, `harness`, `previous`, `feedback`; output `testDesign`, id `<spec>-tests`; read only |
| Validator `test-design-consistency` | `sdd/v1`, `checkTestDesign`, below |
| Task `audit-test-design`, Validator `test-design-audited` | the Auditor judges what the check cannot: a case's level fits the boundary its scenario's When crosses, its steps reach its expected, its expected is the scenario's Then with its values (`case-unfit`); `cel` over the audit as `acceptance-audited` |
| Validator `test-design-confirmed` | human, `cli-human/v1`: the developer reads the cases before code exists |
| ReviewLoop `test-design-one`, Workflow `test-design-all` | `maxRounds: 2`; `repeat` over `capabilities` as `plan-all` |
| Prompt `test-writing-rules` | write only the cases given, one test per case unless its `data` holds several rows; the test's title holds `<CAP-n>/TC-n`; follow the level's `conventions` and its seed test; use the level's tool as the harness names it, never another; run the test with the level's `one`; a test of a case the code does not yet do is red, never skipped; never edit code outside `testDir` |
| Task `write-api-tests` | inputs `plan`, `taskId`, `testDesign`, `harness`, `spec`, `designs`, `repository`, `previous`, `feedback`; the task's `api` cases; output `written` (value: `files[]` `{path, sha256}`, `cases[]`); before `implement` |
| Task `write-e2e-tests` | as `write-api-tests` over the task's `e2e` cases, after `implement`; starts the app with the harness's `app.start`, replays each step in the browser before it writes the test, as Playwright's generator does |
| Task `implement` | adds inputs `testDesign`, `harness`, `written` (the `api` tests, read only); `build-rules` names the task's `unit` and `integration` cases as the Builder's, the others as the Tester's; a Tester's test the Builder holds wrong is a `Q-n` naming the case, never an edit |
| Tasks `run-tests`, `run-levels` | add inputs `harness` and `written`; `junit/v1` reads the levels from the harness when bound (the Executor keeps only the minimums of coverage and mutation), and `prepare` hashes every file in `written` into `changed[]` |
| Prompt `audit-rules` | reads each case of the task and the tests that carry its id: they set up its preconditions, do its steps and assert its expected; `test-unfit` names the case |
| Validator `acceptance-evidence` | with a TestDesign bound, by case: findings below; the rest of `35-build-process.md` and `36-test-levels.md` holds |
| Task `evaluate-tests` | Executor `auditor`, read only; inputs the TestDesign, every level's final TestOutcome, the task records; output `evaluation`: a summary in the Glossary's words and the residual risks (`manual` and `notrun` cases, flaky tests, reported `D-n`) |
| Executor `test-reporter`, Task `report-tests` | `subprocess/v1` running the pack's `report.mjs` over `buildReport` in `adapters/sdd/check.mjs`; configuration `{thresholds: {p0: 100, p1: 90, p1Concerns: 80, overall: 80}}`, a project overriding it by name; inputs `plan`, `spec`, `testDesign`, `harness`, `records` (the `<plan>-<t-n>` artifacts), `finals`, `evaluation`; output `report`, id `<plan>-test-report` |
| Validator `report-verdict` | `cel` over `report`: refused when `verdict.result` is `fail` |

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
| `question-open` | an open question without a `resolution` |
| `id-sequence` | `TC-n` not unique and increasing |

## `acceptance-evidence` by case

A task's cases are the TestDesign's cases that verify a scenario in the task's `verifiedBy`.

| Code | Finding |
|---|---|
| `case-untested` | an `automated` case of the task that no test carries, in its level's outcome |
| `case-level` | a test carrying the case is in another level's outcome |
| `case-failed`, `case-skipped` | a test carrying the case failed, errored or was skipped |
| `case-dropped` | a case a test carried last round that none carries now |
| `tester-file-changed` | a file in `changed[]`: the Builder edited a Tester's test |
| `level-held` | info, as `36-test-levels.md`: its cases are not `case-untested` |

`test-missing`, `test-ambiguous`, `test-dropped`, `scenario-unrecorded` and `unknown-scenario` are
not raised with a TestDesign bound: no row names a test.

## `buildReport`

| Status | Of a case | Of a scenario or requirement |
|---|---|---|
| `ok` | every test carrying it passed | every case verifying it `ok` |
| `nok` | a test carrying it failed or errored | a case verifying it `nok` |
| `notrun` | `manual`, its level not run, its tests skipped, or its task not built | no case `nok`, one `notrun` |
| `uncovered` | – | no case verifies it |

A case reads its tests in the `plan` tier's outcome of its level; `unit`, which the `plan` tier runs
only with `affected`, reads the last round's outcome over the same tree. A rate is the share of
cases `ok`.

| Verdict | Rule, first match |
|---|---|
| `fail` | a case `nok`; an `AC-n` or `build` `QS-n` `uncovered`; `P0` below `p0`; `P1` below `p1Concerns`; all cases below `overall` |
| `concerns` | `P1` below `p1` |
| `pass` | otherwise |

## Rules

| Rule | Enforcer |
|---|---|
| the tools are recorded once, by the Tester, and every runner and test-writing Task reads them from the TestHarness | `harness-rules`, `harness-evidence`, `junit/v1` |
| a level's tool comes from the Architecture or its Adrs, else the repository; never a choice the Tester makes | `harness-rules`; `question-open` |
| every acceptance scenario and `build` quality scenario has a case, its level decided before code | `checkTestDesign`, the Auditor, a human |
| the Tester writes the `api` and `e2e` tests, the Builder the code and the `unit` and `integration` tests | Tasks, `build-rules`, `test-writing-rules` |
| the Builder never edits a Tester's test; one it holds wrong is a `Q-n` | `tester-file-changed`, `question-open` |
| a test carries the qualified id of the case it runs; the Gate matches by it | `acceptance-evidence` |
| the report is computed, not written: an agent writes only its evaluation | `report-tests` on a script Executor |
| a `fail` verdict fails the run, and a regression still does | `plan-gate` |

## Changes to other files, when this file becomes active

| File | Change |
|---|---|
| `23-pack-sdlc.md` | the three kinds; a TestDesign verifies a Spec's `AC-n`, `QS-n`, `BR-n`, `FR-n` (N:M); the Plan stays the only link from a Spec to Designs |
| `35-build-process.md` | `build-work` as above; `build-rules` loses "at least one test per scenario" to the cases; the record's `verifies` optional; findings by case; prose says "test" for a JUnit entry (`CONTEXT.md`) |
| `36-test-levels.md` | the levels from the harness; the Executors keep the minimums; a test the record names is a test carrying a case of the task |
| `37-progress.md` | the map gains the Test design and the Test report phases |
| `38-autopilot.md` | the app skeleton before `setup-tests`, not before `build-all`; a tester subagent per Tester form; a Reviewer subagent at `test-design-confirmed` |
| `packs/sdlc/files/AGENTS.md` section 6 | the run order above; a Tester form is answered in a fresh subagent |
| `91-roadmap.md` | "tester as its own Task" and "the verification layer" leave it |

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
  running each level's seed test once. Found in design review.
- Test cases are designed per Spec before the Plan, in one TestDesign a human confirms: the level of
  each case is decided before code, as BMAD's `test-design` and Playwright's `specs/*.md` plan do,
  not judged by the Auditor after it. One artifact holding the cases, not a `TestCase` per case (the
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
- The TestReport is computed by a script, and an agent writes only its evaluation: a count from an
  agent is a guess. Statuses are Xray's (`ok`, `nok`, `notrun`, `uncovered`; its `unknown` is not
  needed, the vocabulary being ours). The verdict thresholds are BMAD's `trace` gate: `P0` 100,
  `P1` 90 for `pass` and 80 for `concerns`, all cases 80. Found in design review.
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
