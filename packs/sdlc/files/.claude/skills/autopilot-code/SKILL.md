---
name: autopilot-code
description: Build approved persimmon Plans into tested code with no human - scaffold when there is no app, set up the test levels and design each Spec's test cases, build-all per Plan with a fresh builder subagent per task and a fresh tester subagent per Tester form, every reported defect investigated as an Issue and fixed. Use when the developer asks to autopilot the build, the code, or the Plans.
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
- Give it a unit test command that writes JUnit XML and passes on the empty app, and a health
  check the api and e2e seed tests can reach.

An app already there: use it as it is.

Then, once per product:

1. `setup-tests`: `architecture`, `adrs` (the Adrs it applies), `designs` (every Design),
   `repository`. Its Tester form is a tester subagent's (below). Gives the TestHarness.
2. `test-design-all`, once per BoundedContext: `prd`, `capabilities` (the context's), `architecture`,
   `designs` (every Design), the context's `glossary`, `rules`, `harness`. Each Spec's TestDesign,
   `<spec>-tests`, confirmed at its Gate by a Reviewer subagent. Then apply its upstream answers
   (`driving.md`, Upstream answers) before any build.

## 2. Build each Plan

Plans in the order of their capabilities, `CAP-1` first. Per Plan, `build-all`: `plan`, `tasks`
(every `T-n`, in order), `spec`, `architecture`, `adrs` (the Adrs it applies), `designs` (the Designs the Plan lists), `glossary`
and `rules` of its context, `repository` (the app's path), `testDesign` (the Spec's) and `harness`.

Each task parks a builder form. Start a new builder subagent per form, each round too, with:

> You build one persimmon Plan task. Read `AGENTS.md` section 6, "Building a Plan task", and do
> exactly that for `.persimmon/inbox/<taskRun>.yaml`, except: no developer is there to ask, so
> what you would ask is a `Q-n`; do not run `persimmon complete` and write no Issue; write the
> answer file to `.persimmon/autopilot/<taskRun>.answer.yaml` and stop. Never run git or
> `persimmon`. Reply with the record's `verifies` and every `Q-n` and `D-n` you wrote.

A task with api or e2e cases parks Tester forms too, the api one before the builder's and the e2e
one after it. Start a new tester subagent per Tester form, never the task's builder subagent, with:

> You are the Tester of one persimmon Plan task. Read `AGENTS.md` section 6, "Setting up and
> writing tests", and do exactly that for `.persimmon/inbox/<taskRun>.yaml`, except: no developer is
> there to ask, so a case you cannot write goes in `notWritten`; do not run `persimmon complete`;
> write the answer file to `.persimmon/autopilot/<taskRun>.answer.yaml` and stop. Never run git or
> `persimmon`, never change the app's code. Reply with `written`.

`setup-tests`'s form is a Tester form too: the same prompt, its answer the TestHarness.

Then `persimmon complete` as `driving.md` says: it runs the tests and the Gate. A rejected round
parks the next round's forms with the findings in `inputs.feedback`: new subagents again.

A round refused on `question-open` asked a human, and none is there: before the next round's
subagents, start a new Reviewer subagent with this prompt, followed by the open questions
(`persimmon get AcceptanceRecord/<plan>-<t-n>`, its `openQuestions` without a `resolution`):

> You are the domain owner of this product. A build round of one Plan task stopped on the open
> questions below, raised by its builder or its Tester; nobody else will answer them. Read the next
> round's form `.persimmon/inbox/<taskRun>.yaml` (the task, its cases, the findings) and the
> repository as you need. Decide each as a careful owner would, the simplest choice that serves the
> Spec. Do not run `persimmon` or git, and write no file. Reply one line per question:
> `Q-n: decided. <decision>.`

Append its lines to the next round's builder and tester prompts: "The human decided: <lines>. Build
on these; the builder writes each as its `Q-n`'s `resolution`." Keep them for the report.
After the last task the TestReport follows (`persimmon get TestReport/<plan>-test-report`): its
verdict and every residual risk go in the report.

`setup-tests` warned `level-deferred` and this `build-all` built the screens of the `ui` Design it
names: before the next Plan, run `setup-tests` again with the same inputs, which adds the `e2e`
level, then `test-design-one` for each Spec with a screen case, `base` its TestDesign, so those
cases move to `e2e`. Once per Autopilot run.

## 3. Defects

Once a task's Gate passed, each `D-n` its record reports (`defect-reported`), and a run ended
`plan_regressed` (a red no round showed, or a `fail` verdict), is an `Issue`, as `AGENTS.md` section 6 says: investigate it yourself, write it
with `persimmon create`, schema from `persimmon get KindDefinition/issues.sdd.persimmon.ai`. One
Issue per root cause, however many records report it.

The fix: when the Spec was wrong or missing, stop and report; a Spec revision is the developer's
call. Otherwise `build-one` on the task the Issue `blocks` (inputs as `build-all`, `taskId`, and
`baseline`, the TestOutcome `build-all` took first). Its Gate passed: write the Issue's `resolved`
revision citing that record in `fixedBy`. Its Gate failed: stop.

## 4. End

Every Plan built and every Issue resolved: report as `driving.md` says.
