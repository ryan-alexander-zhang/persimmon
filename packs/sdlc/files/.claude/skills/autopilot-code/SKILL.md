---
name: autopilot-code
description: Build approved persimmon Plans into tested code with no human - scaffold when there is no app, build-all per Plan with a fresh builder subagent per task, every reported defect investigated as an Issue and fixed. Use when the developer asks to autopilot the build, the code, or the Plans.
---

# Autopilot: Plans to code

Read `.claude/skills/autopilot/driving.md` first: it says how to start, answer and end each run
below, and when to stop.

## 0. Before

- The project directory is a git repository (`.git` present). If not, stop: the developer creates
  it. You never run git.
- The Plans: from `autopilot-doc`, or the latest passed revisions in `persimmon get Plan`.

## 1. The app and its tests

When the project has no app yet, stand in for the developer once:

- Scaffold the app the Architecture describes, on the technology its Adrs chose, in the repository
  root unless the Architecture says otherwise. Add no dependency an Adr does not name.
- Give it a unit test command that writes JUnit XML and passes on the empty app.
- Override the Executor `test-runner` with that command (`persimmon apply <file>`):

```yaml
apiVersion: persimmon.ai/v1
kind: Executor
metadata: {name: test-runner}
spec:
  type: script
  adapter: junit/v1
  configuration: {program: [npm, test], junit: junit.xml}
  security: {networkAccess: deny}
```

An app already there: use its test setup as it is.

## 2. Build each Plan

Plans in the order of their capabilities, `CAP-1` first. Per Plan, `build-all`: `plan`, `tasks`
(every `T-n`, in order), `spec`, `architecture`, `designs` (the Designs the Plan lists), `glossary`
and `rules` of its context, `repository` (the app's path).

Each task parks a builder form. Start a new builder subagent per form, each round too, with:

> You build one persimmon Plan task. Read `AGENTS.md` section 6, "Building a Plan task", and do
> exactly that for `.persimmon/inbox/<taskRun>.yaml`, except: no developer is there to ask, so
> what you would ask is a `Q-n`; do not run `persimmon complete` and write no Issue; write the
> answer file to `.persimmon/autopilot/<taskRun>.answer.yaml` and stop. Never run git or
> `persimmon`. Reply with the record's `verifies` and every `Q-n` and `D-n` you wrote.

Then `persimmon complete` as `driving.md` says: it runs the tests and the Gate. A rejected round
parks the next round's form with the findings in `inputs.feedback`: a new builder subagent again.

## 3. Defects

Once a task's Gate passed, each `D-n` its record reports (`defect-reported`), and a run ended
`plan_regressed`, is an `Issue`, as `AGENTS.md` section 6 says: investigate it yourself, write it
with `persimmon create`, schema from `persimmon get KindDefinition/issues.sdd.persimmon.ai`. One
Issue per root cause, however many records report it.

The fix: when the Spec was wrong or missing, stop and report; a Spec revision is the developer's
call. Otherwise `build-one` on the task the Issue `blocks` (inputs as `build-all`, `taskId`, and
`baseline`, the TestOutcome `build-all` took first). Its Gate passed: write the Issue's `resolved`
revision citing that record in `fixedBy`. Its Gate failed: stop.

## 4. End

Every Plan built and every Issue resolved: report as `driving.md` says.
