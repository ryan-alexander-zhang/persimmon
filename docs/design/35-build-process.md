# Build process

status: draft · layer: 2 (`23-pack-sdlc.md`, `27-spec-process.md`, `30-plan-process.md`) · schema: the `AcceptanceRecord` and `TestOutcome` kinds in `packs/sdlc/global/10-artifact-kinds.yaml`

From a Plan task to code and the evidence that it does what the Spec says: the builder writes the
code and tests of one `T-n` in the project's repository and names the test that proves each `AC-n`
and `build` `QS-n` the task is verified by; the project's own tests run; a Validator checks the names against the
outcome. By default the builder is the developer with their own coding agent, as spec-kit, Kiro and
BMAD hand `/implement` to the developer's session; a Namespace that wants it unattended overrides
one Executor. Persimmon owns what is built and the proof; the builder owns how.

```text
Workflow build-all: Task run-baseline (Executor test-runner) ─▶ TestOutcome <plan>-baseline; repeat over `tasks` ─▶ ReviewLoop build-one per T-n
ReviewLoop build-one
  produce: Workflow build-work
             Task implement (Executor builder: cli-human/v1; a Namespace override: claude-code/v1) ─▶ AcceptanceRecord
             Task run-tests (Executor test-runner: junit/v1, the project's command) ─▶ TestOutcome
             Task audit-acceptance (Executor auditor: claude-code/v1, read only) ─▶ audit (ValidationResult)
  review:  Gate build-gate = Validator acceptance-evidence (sdd/v1: record, testOutcome, plan, spec, previous, previousOutcome, taskId, baseline?)
                           + Validator acceptance-audited (cel: audit)
  previous, the last testOutcome (carried) and feedback fed back; maxRounds 3
```

## Kinds

| Kind | Content |
|---|---|
| `AcceptanceRecord` | `plan`, `spec` (artifact ids), `task` (`T-n`), `verifies[]` (`scenario`: `AC-n` or `QS-n`, `tests[]`, `minItems: 1`: test names as JUnit gives them), `summary`, `openQuestions[]` (`Q-n`, `resolution?`); what the builder says proves each scenario |
| `TestOutcome` | `command`, `exitCode`, `head?` (the commit), `dirty?` (uncommitted changes), `tests[]` (`classname`, `name`, `status`: `passed`, `failed`, `errored`, `skipped`, `message?`), `outputTail?`, present exactly when no test case was read; what the project's tests did, read from JUnit XML |

## Process

| Member | Content |
|---|---|
| Prompt `build-rules` | one task per round, its block only; at least one test per `AC-n` and `QS-n`, named in `record`; a failing test is never deleted, skipped or weakened; a dependency the Architecture and its Adrs do not name is a `Q-n`, never installed; an unknown is a `Q-n`, never a guess; no git; the code uses the Glossary's terms |
| Executor `builder` | `cli-human/v1`, `type: human`: the form in `.persimmon/inbox/<taskRun>.yaml` is the task brief, every context entry with its content (`20-pack.md`); the developer's agent reads it, builds, and answers with `persimmon complete <taskRun> --file record.yaml` holding `{outputs: {record: <content>}}` |
| Executor `test-runner` | `junit/v1`, `type: script`, configuration `{program, junit}`: the project's test command and the JUnit XML it writes (a file, or a directory of `.xml` files); the pack's `{program: [npm, test], junit: junit.xml}` is a placeholder a project overrides by name (`mvn test` with `target/surefire-reports`, `pytest --junitxml=junit.xml`) |
| Task `implement` | inputs `plan`, `taskId` (value), `spec`, `architecture`, `designs` (artifacts), `glossary`, `rules`, `repository` (the workspace), `previous`, `previousOutcome` (what the tests did last round), `feedback`, `baseline` (the tests before `build-all`, optional); output `record`, id `<plan>-<t-n>`; `workspace: {input: repository}`; `sideEffects: nonIdempotent` (it writes the repository); `timeout: 72h`, a human's |
| Task `run-baseline` | inputs `plan`, `repository`; output `baseline`, a TestOutcome, id `<plan>-baseline`; Executor `test-runner`; `workspace: {input: repository}`; `sideEffects: idempotent`; `timeout: 2h`; the project's tests before any task is built |
| Task `run-tests` | inputs `record`, `repository`; output `testOutcome`, id `<record>-tests`; `workspace: {input: repository}`; the `record` input pins the record in the outcome's provenance; `sideEffects: idempotent`; `timeout: 2h`, a ceiling an Executor override cannot raise |
| Prompt `audit-rules` | for each row of the record, read the named tests in the repository and judge whether they prove the scenario: an `AC-n`'s Given/When/Then with its values, a `QS-n`'s stimulus and its response and measure as one run decides it (the Spec's `delta` replacing what it tightens), a `fitness` one the structure; a test that asserts nothing the scenario says, mocks the thing under test or proves another scenario is `test-unfit`; pass and fail are `acceptance-evidence`'s, not the auditor's; never edit a file |
| Executor `auditor` | `claude-code/v1`, `type: agent`, `sandbox: read-only`, `model: claude-sonnet-5`: an auditor reads a few tests; a Namespace overrides it by name for another model or agent |
| Task `audit-acceptance` | inputs `record`, `testOutcome`, `plan`, `taskId`, `spec`, `architecture`, `repository` (the workspace, read only); output `audit`, a `ValidationResult` value; `workspace: {input: repository}`; `sideEffects: none`; `timeout: 1h` |
| Validator `acceptance-evidence` | `sdd/v1` over `record`, `testOutcome`, `plan`, `spec`, optionally `previous` and `previousOutcome` (the last round's record and tests) and `baseline`, and the value `taskId`; the findings below |
| Validator `acceptance-audited` | `cel` over the value `audit`: passed when no finding is an `error`, the auditor's findings as they are; the auditor's own `passed` is not read |
| Gate `build-gate` | `acceptance-evidence` and `acceptance-audited`, policy `all`; a human review of the diff is the project's, before it commits |
| ReviewLoop `build-one` | `produce` the Workflow `build-work` (implement, then run-tests, then audit-acceptance), `review` `build-gate` with `previous`, `previousOutcome` and an optional `baseline` bound, `carry: {testOutcome: previousOutcome}`, `maxRounds: 3`; the findings go back as `feedback` with the last `record` as `previous` and its `testOutcome` as `previousOutcome` |
| Workflow `build-all` | `run-baseline` first, then `repeat` over `tasks` with the baseline bound to every `build-one`, `T-n` ids in ascending order, as `spec-all` repeats over capabilities; a task the loop could not build ends the run `build_inconsistent`, an iteration that died before its Gate, or a baseline whose test command could not run, `step_failed`; output `built` |

An unattended Namespace overrides Executor `builder` by name with `adapter: claude-code/v1`,
`type: agent`, `sandbox: workspace-write`, `networkAccess: allowlist` to `api.anthropic.com` as the
pack's other agents, and `allowedTools` for its own test command, so the agent runs the tests it
writes. The Task, its instructions and every other member stay the pack's, and an upgrade reaches
them.

## `junit/v1`

An executor Adapter on the shared runner (`adapters/lib/agent.mjs`), beside `subprocess/v1`. Per
attempt, in the workspace: refuse a `junit` that is the workspace or outside it (`invalid_input`),
delete the stale reports there (only files whose root is `testsuite` or `testsuites`; a `pom.xml`
stays), read `head` and `dirty` before the run, run `program` with its output as the log, read every file
`junit` names (`<testsuites>` or `<testsuite>` root), and answer the Task's one output port; XML
that does not parse counts as no test case read, its error in `outputTail`. The
command's exit code is recorded, never an error, `128` plus the signal number when a signal killed
it (the shell's convention; a killed suite may leave reports written so far, so `suite-exit`
catches it, and with a baseline whose reds explain a non-zero exit, when the exit differs from the baseline's): failing tests exit non-zero, which is an outcome
the Gate judges, not a failed attempt; a run with no test case read (a compile error) answers
`tests: []` and the last 50 lines of output as `outputTail`. `head` and `dirty` come from
`git rev-parse HEAD` and `git --no-optional-locks status --porcelain`, so no index lock is taken;
outside a repository both are absent. `outputTail` and every failure `message` pass through the
runner's credential redaction: the program had the credentials, and what it printed is stored. A
test case without a `name` takes its `classname`. Under `anyExit` the runner keeps the last 1 MiB
of output, and an attempt stopped with the Adapter (engine shutdown) is `agent_failed`, never an
outcome.
The runner gains two driver hooks for this: `prepare`, run in the workspace before the program,
and `anyExit`, an exit code that is the program's answer, not a failure. `junit/v1` takes no
executor conformance suite: E3 expects the fixture's answer and E10 an `agent_failed` on a
non-zero exit, both contrary to its contract; its own tests cover it (`test/adapters/agent.test.ts`).

## `checkAcceptance`

`adapters/sdd/check.mjs`, pure, `checkAcceptance({record, testOutcome, plan, spec, previous, previousOutcome, baseline, ids})`,
`ids` holding the bound `plan`, `spec` and `taskId`; `evaluate` checks for `artifacts.record`
before `artifacts.plan`, since this Validator binds a Plan too; `previous` without `previousOutcome`,
or the reverse, is `invalid_input`. Every finding `error` but `suite-baseline` (info) and `baseline-dirty` (warning):

| Code | Finding |
|---|---|
| `not-a-record` | content without `task` or `verifies`; the only finding then |
| `suite-empty` | the outcome holds no test case; the only finding then, its message the `outputTail` |
| `task-mismatch` | `task` is not the `taskId` the record was written for |
| `plan-mismatch`, `spec-mismatch` | `plan` or `spec` is not the artifact bound, or the Plan's `spec` is not the Spec bound |
| `unknown-task` | `task` is no `T-n` of the Plan |
| `scenario-unrecorded` | an `AC-n` or `QS-n` in the task's `verifiedBy` with no `verifies[]` row |
| `scenario-duplicate` | two rows for one scenario |
| `unknown-scenario` | a row's scenario not in the task's `verifiedBy`; or one the task's `verifiedBy` names that the Spec lacks (an `AC-n` it has not, a `QS-n` its `qualities` do not cite): the Spec was revised after the Plan |
| `test-missing` | a test a row names matches no test case |
| `test-ambiguous` | a test a row names matches two test cases |
| `test-failed`, `test-skipped` | a test a row names failed, errored or was skipped |
| `test-dropped` | a test the previous round's record named, which ran in the previous round's outcome and which the current record no longer names, matches no test case now (one it still names is `test-missing`; a name that never ran was a wrong name, not a test) |
| `suite-failed` | a test case no row names failed or errored, and was not red in the baseline: a change broke another test |
| `suite-baseline` | info: the test cases no row names that were red in the baseline and are red still; tolerated, never failing |
| `question-agent-resolved` | warning, from every `sdd/v1` document check: a `Q-n` with a `resolution` in a document an Adapter published (`provenance.actor.kind: service`), an agent's answer in a human's place |
| `baseline-dirty` | warning: a red was tolerated and the baseline ran over uncommitted changes, so that red may be one an earlier build left |
| `suite-exit` | `exitCode` is not 0 while no test case failed or errored, or only tolerated ones did and the baseline exited otherwise: the suite was killed part way, or failed after its tests (a coverage threshold, a build step) |
| `question-open` | an open question without a `resolution`: code built on an unknown is not done |

A row names a test by string equality with the test case's `name`, or with `classname + ' > ' +
name`; a name is never split (vitest's own `name` holds ` > `). Cases with the same `classname` and
`name` (a retried or parameterized test JUnit writes twice) are one test, red if any of them is.

## Rules

| Rule | Enforcer |
|---|---|
| the Gate trusts the outcome, not the record: a test the record names passes only if the outcome says so | `acceptance-evidence` |
| the tests run in the workspace the work was done in, after it | `build-work` order |
| a test red before `build-all` is not the build's to fix: only a red case the baseline lacks, or did not have red, is `suite-failed` | `run-baseline`, `acceptance-evidence`; for `build-one` run alone, the suite is green before it (convention) |
| whether a named test verifies its `AC-n` or `QS-n` is judged by a reader, not by the check | `audit-acceptance`, through `acceptance-audited`; the developer reading the diff |
| persimmon never commits: the developer reviews the diff and commits | convention; AGENTS.md section 8 for an Executor's agent |
| `tasks` in ascending `T-n`: `dependency-forward` makes document order the build order (`23-pack-sdlc.md`) | `plan-consistency` |
| a bug is a Spec revision with a new `AC-n`, then a Plan revision, then `build-one` | convention (`23-pack-sdlc.md`: a brownfield change is a Spec revision) |
| `persimmon complete` drains the run: `run-tests`, the auditor (an agent call of up to an hour), the Gate and the next round run inside the call, so the developer's agent runs it in the background or without a time limit | AGENTS.md section 6 |

## Decisions

- The developer's own coding agent builds by default, not a pack agent: real code needs the
  dev environment, the network and a human steering it, which a one-shot sandboxed agent under a
  timeout does not have (example02 ran `npm install` before its workflow for that reason). The
  Executor `builder` is the switch, overridden by name as every pack process's Executor is: a Task
  override would freeze a copy of the pack's instructions. Found in design review and audit.
- The Gate runs the tests through `run-tests` instead of reading a result the record carries: an
  agent's "passed" is a claim, an outcome is evidence. JUnit XML is the result format because
  vitest, jest, maven, gradle and pytest all write it, so one reader serves every stack. Found in
  design review.
- The test runner is its own Adapter, `junit/v1`, not a script under `subprocess/v1`: a script's
  path in an Executor's `program` is relative to the user's repository, `subprocess/v1` takes only
  `args` as parameters, and a non-zero exit is an attempt failure there, so a red suite would end
  the run instead of feeding a round back. Found in audit.
- `junit/v1` reads XML with `@xmldom/xmldom` 0.9.12: a maintained DOM parser with no dependencies,
  imported in that Adapter only, as `designmd/v1` imports its linter; `getElementsByTagName` reads
  JUnit's `testcase` elements under either root, and a hand-written reader would break on entities
  and CDATA. `fast-xml-parser` was chosen first on the belief it had no dependencies; 5.11.2 pulls
  in six, so the user chose again. `sax` (event stream, more code to assemble test cases) was
  compared. Found in audit and implementation.
- `persimmon complete --file` takes `{outputs: {<port>: <content>}}` for an artifact port and
  publishes it under the form's `outputIds`: the full `{taskResult, publish}` envelope is the
  engine's, not something a coding agent should write. Found in audit.
- The record and the outcome are two kinds: the record is what the builder says proves each
  `AC-n`, the outcome is what happened. The outcome records the commit and whether the tree was
  dirty, since persimmon never commits and the code tested may be uncommitted; it pins the
  evidence, not the code. Found in design review and audit.
- The task brief is the `cli-human/v1` form, not a new verb: it already carries every context
  entry with its content. Found in design review.
- Deferred: an auditor reviewing a draft before a human confirms it, which needs a Gate's Validators to run in order (all run at once, `14-gate.md`).
  Each lands on this process once it runs. Found in design review.
- The Executor's command is `configuration.program`, not `command`: the shared runner reserves
  `configuration.command` for the conformance suite's stand-in and refuses it on an applied
  Executor. A glob in `junit` was dropped: maven and gradle write one directory, and a directory
  covers both. Found in implementation.
- `test-dropped` reads the last round's `TestOutcome`, carried beside its record: judged against the
  record alone, it fired for a name the last round got wrong, a test that never ran, so a builder
  who fixed the name was refused again and the loop could not pass. The builder's form shows the
  last outcome too, so a human sees what failed. Found in implementation (the build scenario test).
- AGENTS.md section 8 binds an agent an Executor spawns; the developer's own agent answering the
  builder's form is under section 6: it may ask the developer, it reads the repository, and it runs
  `persimmon complete`, all of which section 8 forbids a pack agent. Found in audit.
- The builder uses the project's test setup as it is and never changes it: the command the Gate
  runs is the `test-runner` Executor's, which no Task reads, so an agent builder on a repository
  without a test script guessed `node --test`, set it as `scripts.test`, and lost a round to the
  Gate's vitest run; round two learnt the runner from the carried TestOutcome. A `testCommand`
  input was weighed and refused: it would copy the Executor's configuration and drift from it.
  Found in UAT.
- Proven live on T-1 of the worked example: the default builder (the developer's agent answering
  the form with `complete --file`) passed in round 1; the `builder` override to `claude-code/v1` on
  `claude-sonnet-5` passed unattended in round 1 (3m20s) once the test-setup rule was in, the Gate
  running the project's `npm test` with vitest's JUnit reporter; before the rule it took 2 rounds,
  round 2 fixed from the carried TestOutcome. The agent never ran git. `persimmon init` on the
  project updated its unedited AGENTS.md to the new pack text. Found in UAT.

- A quality scenario names its `method` (`test`, `fitness`, `load`, `chaos`, `observe`) and its
  `provenAt` (`build`, `release`, `runtime`), both required, so the architect says how and when each
  measure is proven. A `build` scenario is a `test` or a `fitness` one, the two methods a JUnit test
  can prove; the schema refuses another. `release` and `runtime` are declared and checked by
  nothing yet: no release process exists. The method names are the template's verification axis;
  the field is `provenAt`, not the template's `stage`, which the glossary avoids for a Phase. The
  worked example and examples 07 and 08 were labelled by hand after their runs. Both are required,
  so a project holding an Architecture revision without them is refused when `persimmon init`
  re-applies the pack, with no migration (`01-kind-definition.md`): the pack is pre-release, and an
  optional pair would let an architect skip the question. Found in design review and audit.
- A `build` quality scenario the Spec cites is a scenario of the Plan like an `AC-n`: a task's
  `verifiedBy` names it, the record proves it with a row, and `checkAcceptance` holds the row to a
  passing test with no new rule. The record's row key is `scenario`, not `ac`, for both; the Plan
  check already called an `AC-n` a scenario. When it is proven is the Plan check's to read, since it has the
  Architecture; the Gate checks only that the Spec still cites the `QS-n`. The Plans of examples 07
  and 08 predate the rule and verify no `QS-n`. Found in design review.

- An Adr is `enforcedBy` quality scenarios of its Architecture proven at `build`, not by test
  names: an Adr is immutable and written before any code, so a test name in it would mean revising
  the decision after the build. A structural decision gets a `fitness` scenario; a Spec whose
  capability changes the code it holds cites it, the Plan verifies it by a task, and the record
  names the test, as any `build` scenario. Once that test exists, `suite-failed` turns it red at
  every later Gate, so the decision stays held with no rule of its own. Whether a decision binds
  structure is the architect's call: the Prompt asks for a scenario or a negative consequence saying
  why none, which no check can tell. An Adr taken before its Architecture names no scenario until a
  revision; a `fitness` scenario no Spec cites is never planned, and the `enforcedBy` of an Adr only a
  Design lists is checked by nothing, known gaps. The check takes any `build` scenario, a `test` one
  too: a decision on behaviour (receipts never overwritten) is held by a behaviour test. The template's
  `enforced_by` lists test paths; persimmon keeps the names in the record. Found in design review.

- The auditor is a Task in `build-work`, after the tests, not a `task` Validator in the Gate: a
  Gate's and a Validator's inputs exclude `externalResource` (`14-gate.md`), so a Validator's Task
  cannot have the repository as its workspace, and the auditor must read the tests. Its verdict is
  a `ValidationResult` value the Gate's `cel` Validator reads, so the builder gets its findings as
  any other. A value, not a new kind: the verdict is run state the GateResult already carries.
  `passed` is recomputed from the findings, so an auditor answering `passed: true` beside an
  error cannot pass the round. It runs every round, a red one too: one agent call a round, the
  price of an auditor. It judges the names `acceptance-evidence` resolves, not whether a test
  passed. The default model is `claude-sonnet-5`, not the pack's `claude-opus-5`: it reads a few
  tests and answers one finding list. A test it cannot find in the source (a generated or
  parameterized name) is a warning, never an error the builder could not fix. An auditor that
  fails (three failed attempts in its hour, or an answer the schema refuses) fails `build-work` and
  so `build-one`, as a failed test run does: a judgement missing is not a pass. A human auditor is
  not offered: the Task's hour is an agent's, and the developer's agent answering it would grade
  its own tests. Found in design review and audit.
- `build-all` takes a baseline: the project's tests once, before `T-1`, as a TestOutcome. A red
  case the baseline had red is tolerated, listed as `suite-baseline` info; a case red now that the
  baseline lacks or did not have red (green or skipped) is `suite-failed`, a regression or a new break. A test a row names
  passes or is `test-failed`, red in the baseline or not. Without it, a project with one known red
  test could build no task. Taken once per `build-all`, a known ceiling: a case red at the start,
  fixed by `T-1` and broken by `T-3` is tolerated; a baseline per task would carry each task's
  outcome to the next. Always taken, one more test run for a green suite, so no switch. `build-one`
  takes it as an optional input and the builder reads it, so an old red test is not mistaken for
  its own. A `build-all` re-run after a refused one takes its baseline over the tree that run left,
  since persimmon never reverts: a red it caused is then tolerated, so a tolerated red over a
  dirty baseline is a `baseline-dirty` warning. A tolerated red would hide `suite-exit`, so a
  non-zero exit other than the baseline's is still one. Found in design review and audit.
- A question an agent answered is told, not refused: every `sdd/v1` document check warns of a
  `Q-n` resolved in a document an Adapter published, naming the agent and its answer, so the
  human reads it at a confirmation Gate or in the build's tree before the diff is committed. The
  build rules let an agent builder answer what it can, and an unattended Namespace runs on that.
  Who produced the document is its `provenance.actor` (`05-revisioned-kind.md`), never a field
  the agent fills: an agent could not be trusted to mark its own answers. A warning, not an error:
  refusing them is a policy an unattended Namespace may want later, by its own Validator. The
  template's `decided_by: agent`. Found in design review.
- Proven live on `claude-sonnet-5`: `build-one` over `T-1`, the human builder naming for `QS-3` a real,
  passing test that never applies its stimulus. `acceptance-evidence` passed it; the auditor refused
  it in 18s with `test-unfit`, naming what the test lacks and the test that proves `QS-3`. Round two
  named that test and passed, 1m13s in all. The auditor wrote no file. Found in UAT.

## Examples

- `docs/design/examples/sdlc-domain.yaml`: `AcceptanceRecord/submit-a-claim-plan-t-1`, the tests
  proving `AC-1`, `AC-3` and `QS-3` of `T-1`, and `TestOutcome/submit-a-claim-plan-t-1-tests`, the
  vitest run they are named in, four test cases passed; pass `checkAcceptance` (`test/adapters/sdd.test.ts`).

## Units

1. The `AcceptanceRecord` and `TestOutcome` kinds, with examples beside the worked domain example.
2. `persimmon complete --file` with `{outputs}` for an artifact port.
3. `junit/v1` with `@xmldom/xmldom`, the runner's `prepare` and `anyExit` hooks, Executor `test-runner`, Task `run-tests`.
4. `checkAcceptance`, the `acceptance-evidence` Validator and `build-gate`.
5. `build-rules`, Executor `builder`, Task `implement`, `build-work`, `build-one`, `build-all`.
6. AGENTS.md: section 8 scoped to an Executor's agent, section 6 the builder's steps.
7. A live UAT: one Plan task of a small project, built the default way, then by the override.
8. A quality scenario's `method` and `provenAt`.
9. A `build` quality scenario verifies a Plan task and is proven by a record row.
10. An Adr's `enforcedBy`.
11. The auditor: Prompt `audit-rules`, Executor `auditor`, Task `audit-acceptance` in `build-work`, Validator `acceptance-audited` in `build-gate`.
12. The baseline: Task `run-baseline`, `checkAcceptance`'s `baseline`, the wiring through `build-all`.
13. A question an agent answered: the producer in `provenance.actor`, the `question-agent-resolved` warning.
