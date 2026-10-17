# Build process

status: draft · layer: 2 (`23-pack-sdlc.md`, `27-spec-process.md`, `30-plan-process.md`) · schema: the `AcceptanceRecord` and `TestRun` kinds in `packs/sdlc/global/10-artifact-kinds.yaml`

From a Plan task to code and the evidence that it does what the Spec says: someone writes the code
and tests of one `T-n` in the project's repository, names the test that proves each `AC-n` the task
is verified by, the project's own tests run, and a Validator checks the names against the run. By
default that someone is the developer with their own coding agent, as spec-kit, Kiro and BMAD hand
`/implement` to the developer's session; a Namespace that wants it unattended overrides one
Executor. Persimmon owns what is built and the proof; the coding agent owns how.

```text
Workflow build-all: repeat over `tasks` ─▶ ReviewLoop build-one per T-n
ReviewLoop build-one
  produce: Workflow build-work
             Task implement (developer: cli-human/v1, the default; code-agent: claude-code/v1, an override) ─▶ AcceptanceRecord
             Task run-tests (test-runner: subprocess/v1, the project's command) ─▶ TestRun
  review:  Gate build-gate = Validator acceptance (sdd/v1: record, testRun, plan, spec)
  previous and feedback fed back; maxRounds 3
```

## Kinds

| Kind | Content |
|---|---|
| `AcceptanceRecord` | `plan`, `spec` (artifact ids), `task` (`T-n`), `verifies[]` (`ac`: `AC-n`, `tests[]`: names as JUnit gives them), `summary`, `openQuestions[]` (`Q-n`); what the builder says proves each scenario |
| `TestRun` | `command`, `tests[]` (`classname`, `name`, `status`: `passed`, `failed`, `errored`, `skipped`, `message`); what the project's tests did, read from JUnit XML |

## Process

| Member | Content |
|---|---|
| Prompt `build-rules` | one task per round, its block only; one test per `AC-n` at least, named in the record; a failing test is never deleted, skipped or weakened to pass; an unknown is a `Q-n` in the record, never a guess; no git; the code cites the Glossary's terms |
| Executor `developer` | `cli-human/v1`: the form in `.persimmon/inbox/<taskRun>.yaml` is the task brief, every context entry with its content (`20-pack.md`); the developer's agent reads it, writes, and answers with `persimmon complete <taskRun> --file record.yaml` |
| Executor `code-agent` | `claude-code/v1`, `workspace-write`, network denied; not referenced by the pack's Task; a Namespace overrides Task `implement` with `executorRef: code-agent` to run unattended |
| Executor `test-runner` | `subprocess/v1` running `adapters/sdd/run-tests.mjs`: it runs `parameters.command` in the workspace, reads the JUnit XML at `parameters.junit`, answers a `TestRun`; a project overrides it with its command (`npm test -- --reporter=junit --outputFile=junit.xml`, `mvn test`, `pytest --junitxml=junit.xml`) |
| Task `implement` | inputs `plan`, `taskId` (value), `spec`, `architecture`, `designs` (artifacts), `glossary`, `rules`, `repository` (the workspace), `previous`, `feedback`; output `record`; `workspace: {input: repository}` |
| Task `run-tests` | inputs `record`, `repository`; output `testRun`; `workspace: {input: repository}`; the record is an input only so the run follows the work |
| Validator `acceptance` | `sdd/v1` over `record`, `testRun`, `plan`, `spec` and the value `taskId`; the findings below |
| Gate `build-gate` | acceptance only; a human review of the diff is the project's, before it commits |
| ReviewLoop `build-one` | `produce` the Workflow `build-work` (implement, then run-tests), `review` `build-gate`, `maxRounds: 3`; the findings go back as `feedback` with the last `record` as `previous` |
| Workflow `build-all` | `repeat` over `tasks`, the `T-n` ids in the caller's order, as `spec-all` repeats over capabilities; a task the loop could not build ends the run `build_rejected`, an iteration that died before its Gate `step_failed`; output `built` |

## `checkAcceptance`

`adapters/sdd/check.mjs`, pure, `checkAcceptance({record, testRun, plan, spec, ids})`, `ids` holding
the `taskId`; every finding `error`:

| Code | Finding |
|---|---|
| `not-a-record` | content without `task` or `verifies`; the only finding then |
| `task-mismatch` | `task` is not the `taskId` the record was written for |
| `unknown-task` | `task` is no `T-n` of the Plan |
| `ac-unrecorded` | an `AC-n` in the task's `verifiedBy` with no `verifies[]` row |
| `unknown-ac` | a row's `AC-n` not in the task's `verifiedBy`, or not in the Spec |
| `test-missing` | a test a row names is not in the run |
| `test-ambiguous` | a test a row names matches two test cases of the run |
| `test-failed`, `test-skipped` | a test a row names failed, errored or was skipped |
| `run-failed` | any test of the run failed or errored, named or not: a later task broke an earlier one |
| `run-empty` | the run holds no test |

A test is named as JUnit names it: `name`, or `classname > name` when `name` alone is ambiguous.

## Rules

| Rule | Enforcer |
|---|---|
| the Gate trusts the run, not the record: a test the record names passes only if the run says so | `acceptance` |
| the tests run in the same workspace the work was done in, after it | `build-work` order |
| whether a named test verifies its `AC-n` is judged by a reader, not by the check | the developer; an auditor Validator later |
| persimmon never commits: the developer reviews the diff and commits | convention; AGENTS.md section 8 for an agent |
| `tasks` lists `T-n` in an order where each task's `dependsOn` came earlier | caller; Validator later |
| a bug is a Spec revision with a new `AC-n`, then a Plan revision, then `build-one` | convention (`23-pack-sdlc.md`: a brownfield change is a Spec revision) |

## Decisions

- The developer's own coding agent builds by default, not a pack Executor: real code installs
  dependencies, needs the network and a human steering it, which a one-shot sandboxed agent under a
  timeout does not have (example02 ran `npm install` before its workflow for that reason). The
  Executor is the switch: `cli-human/v1` by default, `claude-code/v1` by a Namespace override of
  one Task, so the Task, the kinds, the Gate and the Workflow are shared. Found in design review.
- The Gate runs the tests itself through `run-tests` instead of reading a result the record
  carries: an agent's "passed" is a claim, a run is evidence. JUnit XML is the result format
  because vitest, jest, maven, gradle and pytest all write it, so one reader serves every stack.
  Found in design review.
- The record and the run are two kinds: the record is what the builder says proves each `AC-n`, the
  run is what happened; provenance pins both, so the evidence of a passed task stays readable.
  Found in design review.
- The task brief is the `cli-human/v1` form, not a new verb: it already carries every context
  entry with its content. Found in design review.
- Deferred: a quality scenario's `method` and `stage`, so a build-stage `test` scenario needs a
  passing test too; an Adr's `enforcedBy` tests; an auditor Validator judging whether a test
  verifies its `AC-n`. Each lands on this process once it runs. Found in design review.

## Units

1. The `AcceptanceRecord` and `TestRun` kinds, with examples beside the worked domain example.
2. `run-tests.mjs`, its JUnit reader, the `test-runner` Executor and the `run-tests` Task.
3. `checkAcceptance`, the `acceptance` Validator and `build-gate`.
4. `build-rules`, `developer`, `code-agent`, `implement`, `build-work`, `build-one`, `build-all`.
5. AGENTS.md section 6: how a developer builds a Plan task.
6. A live UAT: one Plan task of a small project, built the default way, then by the override.
