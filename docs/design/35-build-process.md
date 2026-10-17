# Build process

status: draft · layer: 2 (`23-pack-sdlc.md`, `27-spec-process.md`, `30-plan-process.md`) · schema: the `AcceptanceRecord` and `TestOutcome` kinds in `packs/sdlc/global/10-artifact-kinds.yaml`

From a Plan task to code and the evidence that it does what the Spec says: the builder writes the
code and tests of one `T-n` in the project's repository and names the test that proves each `AC-n`
the task is verified by; the project's own tests run; a Validator checks the names against the
outcome. By default the builder is the developer with their own coding agent, as spec-kit, Kiro and
BMAD hand `/implement` to the developer's session; a Namespace that wants it unattended overrides
one Executor. Persimmon owns what is built and the proof; the builder owns how.

```text
Workflow build-all: repeat over `tasks` ─▶ ReviewLoop build-one per T-n
ReviewLoop build-one
  produce: Workflow build-work
             Task implement (Executor builder: cli-human/v1; a Namespace override: claude-code/v1) ─▶ AcceptanceRecord
             Task run-tests (Executor test-runner: junit/v1, the project's command) ─▶ TestOutcome
  review:  Gate build-gate = Validator acceptance-evidence (sdd/v1: record, testOutcome, plan, spec, previous)
  previous and feedback fed back; maxRounds 3
```

## Kinds

| Kind | Content |
|---|---|
| `AcceptanceRecord` | `plan`, `spec` (artifact ids), `task` (`T-n`), `verifies[]` (`ac`: `AC-n`, `tests[]`, `minItems: 1`: test names as JUnit gives them), `summary`, `openQuestions[]` (`Q-n`, `resolution?`); what the builder says proves each scenario |
| `TestOutcome` | `command`, `exitCode`, `head?` (the commit), `dirty?` (uncommitted changes), `tests[]` (`classname`, `name`, `status`: `passed`, `failed`, `errored`, `skipped`, `message?`), `outputTail?`, present exactly when no test case was read; what the project's tests did, read from JUnit XML |

## Process

| Member | Content |
|---|---|
| Prompt `build-rules` | one task per round, its block only; at least one test per `AC-n`, named in `record`; a failing test is never deleted, skipped or weakened; a dependency the Architecture and its Adrs do not name is a `Q-n`, never installed; an unknown is a `Q-n`, never a guess; no git; the code uses the Glossary's terms |
| Executor `builder` | `cli-human/v1`, `type: human`: the form in `.persimmon/inbox/<taskRun>.yaml` is the task brief, every context entry with its content (`20-pack.md`); the developer's agent reads it, builds, and answers with `persimmon complete <taskRun> --file record.yaml` holding `{outputs: {record: <content>}}` |
| Executor `test-runner` | `junit/v1`, `type: script`, configuration `{program, junit}`: the project's test command and the JUnit XML it writes (a file, or a directory of `.xml` files); the pack's `{program: [npm, test], junit: junit.xml}` is a placeholder a project overrides by name (`mvn test` with `target/surefire-reports`, `pytest --junitxml=junit.xml`) |
| Task `implement` | inputs `plan`, `taskId` (value), `spec`, `architecture`, `designs` (artifacts), `glossary`, `rules`, `repository` (the workspace), `previous`, `feedback`; output `record`, id `<plan>-<t-n>`; `workspace: {input: repository}`; `sideEffects: nonIdempotent` (it writes the repository); `timeout: 72h`, a human's |
| Task `run-tests` | inputs `record`, `repository`; output `testOutcome`, id `<record>-tests`; `workspace: {input: repository}`; the `record` input pins the record in the outcome's provenance; `sideEffects: idempotent`; `timeout: 2h`, a ceiling an Executor override cannot raise |
| Validator `acceptance-evidence` | `sdd/v1` over `record`, `testOutcome`, `plan`, `spec`, optionally `previous` (the last round's record), and the value `taskId`; the findings below |
| Gate `build-gate` | `acceptance-evidence` only; a human review of the diff is the project's, before it commits |
| ReviewLoop `build-one` | `produce` the Workflow `build-work` (implement, then run-tests), `review` `build-gate` with `previous` bound, `maxRounds: 3`; the findings go back as `feedback` with the last `record` as `previous` |
| Workflow `build-all` | `repeat` over `tasks`, `T-n` ids in ascending order, as `spec-all` repeats over capabilities; a task the loop could not build ends the run `build_inconsistent`, an iteration that died before its Gate `step_failed`; output `built` |

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
catches it): failing tests exit non-zero, which is an outcome
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

`adapters/sdd/check.mjs`, pure, `checkAcceptance({record, testOutcome, plan, spec, previous, ids})`,
`ids` holding the bound `plan`, `spec` and `taskId`; `evaluate` checks for `artifacts.record`
before `artifacts.plan`, since this Validator binds a Plan too. Every finding `error`:

| Code | Finding |
|---|---|
| `not-a-record` | content without `task` or `verifies`; the only finding then |
| `suite-empty` | the outcome holds no test case; the only finding then, its message the `outputTail` |
| `task-mismatch` | `task` is not the `taskId` the record was written for |
| `plan-mismatch`, `spec-mismatch` | `plan` or `spec` is not the artifact bound, or the Plan's `spec` is not the Spec bound |
| `unknown-task` | `task` is no `T-n` of the Plan |
| `ac-unrecorded` | an `AC-n` in the task's `verifiedBy` with no `verifies[]` row |
| `ac-duplicate` | two rows for one `AC-n` |
| `unknown-ac` | a row's `AC-n` not in the task's `verifiedBy`; one not in the Spec says the Spec was revised after the Plan |
| `test-missing` | a test a row names matches no test case |
| `test-ambiguous` | a test a row names matches two test cases |
| `test-failed`, `test-skipped` | a test a row names failed, errored or was skipped |
| `test-dropped` | a test the previous round's record named matches no test case now |
| `suite-failed` | a test case no row names failed or errored: a change broke another test |
| `suite-exit` | `exitCode` is not 0 while no test case failed or errored: the suite was killed part way, or failed after its tests (a coverage threshold, a build step) |
| `question-open` | an open question without a `resolution`: code built on an unknown is not done |

A row names a test by string equality with the test case's `name`, or with `classname + ' > ' +
name`; a name is never split (vitest's own `name` holds ` > `).

## Rules

| Rule | Enforcer |
|---|---|
| the Gate trusts the outcome, not the record: a test the record names passes only if the outcome says so | `acceptance-evidence` |
| the tests run in the workspace the work was done in, after it | `build-work` order |
| the suite is green before `build-all`: `suite-failed` cannot tell an old red test from a new one | convention; a baseline outcome later |
| whether a named test verifies its `AC-n` is judged by a reader, not by the check | the developer; an auditor Validator later |
| persimmon never commits: the developer reviews the diff and commits | convention; AGENTS.md section 8 for an Executor's agent |
| `tasks` in ascending `T-n`: `dependency-forward` makes document order the build order (`23-pack-sdlc.md`) | `plan-consistency` |
| a bug is a Spec revision with a new `AC-n`, then a Plan revision, then `build-one` | convention (`23-pack-sdlc.md`: a brownfield change is a Spec revision) |
| `persimmon complete` drains the run: `run-tests`, the Gate and the next round run inside the call, so the developer's agent runs it in the background or without a time limit | AGENTS.md section 6 |

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
- Deferred: a quality scenario's `method` and `stage`, so a build-stage `test` scenario needs a
  passing test too; an Adr's `enforcedBy` tests; an auditor Validator judging whether a test
  verifies its `AC-n`; a baseline outcome for a suite already red. Each lands on this process once
  it runs. Found in design review.
- The Executor's command is `configuration.program`, not `command`: the shared runner reserves
  `configuration.command` for the conformance suite's stand-in and refuses it on an applied
  Executor. A glob in `junit` was dropped: maven and gradle write one directory, and a directory
  covers both. Found in implementation.

## Examples

- `docs/design/examples/sdlc-domain.yaml`: `AcceptanceRecord/submit-a-claim-plan-t-1`, the tests
  proving `AC-1` and `AC-3` of `T-1`, and `TestOutcome/submit-a-claim-plan-t-1-tests`, the vitest
  run they are named in, three test cases passed; pass `checkAcceptance` (`test/adapters/sdd.test.ts`).

## Units

1. The `AcceptanceRecord` and `TestOutcome` kinds, with examples beside the worked domain example.
2. `persimmon complete --file` with `{outputs}` for an artifact port.
3. `junit/v1` with `@xmldom/xmldom`, the runner's `prepare` and `anyExit` hooks, Executor `test-runner`, Task `run-tests`.
4. `checkAcceptance`, the `acceptance-evidence` Validator and `build-gate`.
5. `build-rules`, Executor `builder`, Task `implement`, `build-work`, `build-one`, `build-all`.
6. AGENTS.md: section 8 scoped to an Executor's agent, section 6 the builder's steps.
7. A live UAT: one Plan task of a small project, built the default way, then by the override.
