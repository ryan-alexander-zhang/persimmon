---
name: autopilot-code
description: Build approved persimmon Plans into tested code with no human - scaffold when there is no app, set up the test levels and design each Spec's test cases, build-all per Plan; the owner, the builder and the Tester are agents inside the engine; every reported defect investigated as an Issue and fixed. Use when the developer asks to autopilot the build, the code, or the Plans.
---

# Autopilot: Plans to code

Read `.claude/skills/autopilot/driving.md` first: it says how to start and end each run below,
how an upstream answer is applied, and when to stop. The Executor overrides it names are applied:
the owner decides every open question inside its round, the builder builds each task and the
Tester sets up and writes the tests, all inside the engine.

## 0. Before

- The project directory is a git repository (`.git` present). If not, stop: the developer creates
  it. You never run git.
- The Plans: from `autopilot-doc`, or the latest passed revisions in `persimmon get Plan`.

## 1. The app and its tests

When the project has no app yet, stand in for the developer once:

- Scaffold the app the Architecture describes, on the technology its Adrs chose, in the repository
  root unless the Architecture says otherwise. Add no dependency the Architecture or an Adr does not name.
- Give it a unit test command that writes JUnit XML and passes on the empty app, and a health
  check the api and e2e seed tests can reach. When no Adr names a test tool, the runtime's own
  runner is the command (`node --test`, `go test`, `pytest`), and the command creates the
  directory its XML goes in: a reporter does not.

An app already there: use it as it is.

Then, once per product:

1. `setup-tests`: `architecture`, `adrs` (the Adrs it applies), `designs` (every Design),
   `repository`. Gives the TestHarness.
2. `test-design-all`, one run: `prd`, `capabilities` (one entry per capability with its context,
   `{id: CAP-n, context: <context id>}`, as `spec-all` took), `architecture`, `designs` (every
   Design), `rules`, `harness`; each capability's Glossary is bound from its context. Each Spec's TestDesign,
   `<spec>-tests`. Then apply its upstream answers (`driving.md`, Upstream answers) before any
   build.

## 2. Build each Plan

Plans in the order of their capabilities, `CAP-1` first. Per Plan, `build-all`: `plan`, `tasks`
(every `T-n`, in order), `spec`, `architecture`, `adrs` (the Adrs it applies), `designs` (the Designs
the Plan lists), `glossary` and `rules` of its context, `repository` (the app's path), `testDesign`
(the Spec's) and `harness`.

Each task's round runs on the engine: the Tester writes the api cases before the code and the e2e
ones after it, the builder builds the task, a question either leaves open goes to the owner inside
the round, the tests run and the Gate judges. A rejected round starts the next with the findings in
`feedback`. After the last task the TestReport follows (`persimmon get TestReport/<plan>-test-report`):
its verdict and every residual risk go in the report.

`setup-tests` warned `level-deferred` and this `build-all` built the screens of the `ui` Design it
names: before the next Plan, run `setup-tests` again with the same inputs and `base` the TestHarness,
which adds the `e2e` level, then `test-design-one` for each Spec with a screen case, `base` its
TestDesign, so those cases move to `e2e`. Once per Autopilot run.

## 3. Defects

Once a task's Gate passed, each `D-n` its record reports (`defect-reported`), and a run ended
`plan_regressed` (a red no round showed, or a `fail` verdict), is an `Issue`, as `AGENTS.md` section 6
says: investigate it yourself, write it with `persimmon create`, schema from
`persimmon get KindDefinition/issues.sdd.persimmon.ai`. One Issue per root cause, however many
records report it.

The fix: when the Issue finds the Spec wrong or missing, the Spec is revised first as an upstream
answer (`driving.md`, Upstream answers: `spec-one` with `base` and `changes` naming the Issue's
finding, then its impact, the Plan and the TestDesign). Then `build-one` on the task the Issue
`blocks` (inputs as `build-all`, `taskId`, and `baseline`, the TestOutcome `build-all` took first).
Its Gate passed: write the Issue's `resolved` revision citing that record in `fixedBy`. Its Gate
failed: stop.

## 4. End

Every Plan built and every Issue resolved: report as `driving.md` says.
