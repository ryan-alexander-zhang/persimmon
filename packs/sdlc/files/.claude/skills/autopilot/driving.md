# Driving a run unattended

How the Autopilot (`autopilot`, `autopilot-doc`, `autopilot-code`) starts one persimmon run and takes
it to its end with no human. You are the orchestrator: you run every `persimmon` command, from the
project directory. You answer no form and you never run git.

## Before the first run

```sh
persimmon apply .claude/skills/autopilot/autopilot.yaml -n default
```

It overrides the pack's three human Executors in the project's Namespace with agents: `local-reviewer`
(the owner, who decides a draft's open questions inside its round and confirms a document at its
Gate), `builder` and `tester`. From then on the engine runs those Tasks itself, with the instructions,
context and `feedback` a human would read, and nothing parks. Tell the developer in the report that
the overrides are in place; `persimmon delete Executor/<name> -n default` gives a role back to them.

## Start

```sh
persimmon run <Workflow> --input <port>=<yaml | @file> ... --follow
```

Run it in the background or with no time limit: it returns when the run ends. Write long inputs to
files under `.persimmon/autopilot/` and pass them with `@`.

Input shapes:

- one artifact: `'prd={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Prd, namespace: default, id: <id>, revision: <n>}}'`
- a list of artifacts: a file of `- {apiVersion: sdd.persimmon.ai/v1, kind: <Kind>, id: <id>, revision: <n>}` lines, `--input designs=@designs.yaml`
- a value: `--input productId=<id>`, `--input 'capabilities=[CAP-1, CAP-2]'`
- the repository: `--input repository=<path>`

## Parked

A park (`parked on you: persimmon complete <taskRun>`) means a Task reached a human Executor the
overrides do not cover. Stop and report it: never answer the form yourself.

## End

`persimmon tree WorkflowRun/<run>` names what the run produced and each Gate's result. A ReviewLoop
out of rounds still publishes its rejected revision: take a revision only from a round whose
review `passed`. The next run takes those revisions. A `*-all` run's loops run side by side and
one rejected does not stop the others; its tree says which capability or block failed.

A step that found the same work done already (same inputs, same definitions, a passed loop) is
reused, not run again: `tree` shows it as reused. So a `*-all` run after an upstream change redoes
only the capabilities or blocks that change touched.

## Upstream answers

A run whose tree warns `question-upstream` naming an artifact (`<artifact id>` or `<artifact id>
Q-n`) carries an answer that artifact does not have yet: a scenario the Spec lacks, a level the
harness lacks, an operation a Design lacks, a task the Plan moves. Apply it before the next run of
the order:

1. Revise the artifact through its own loop with `base` its latest passed revision and
   `changes=@<file>` listing each answer as `<artifact id> Q-n: <resolution>`, from the warnings:
   `spec-one` with the inputs `spec-all` gave it (`prd`, `capabilityId`, `architecture`, `context`,
   `domainModel`, `glossary`, `rules`); `setup-tests` with the inputs it had (`architecture`, `adrs`,
   `designs`, `repository`); `design-one` with the inputs `design-all` gave it; `plan-one` with the
   inputs `plan-all` gave it. Specs first, then the harness, Designs and Plans; one answer may name
   several artifacts.
2. Its Gate passed: run the order again from the first `*-all` after the revised kind (`design-all`
   for a Spec; `plan-all`; `test-design-all`), with the same inputs as before. Unchanged capabilities
   and blocks are reused; the ones the revision touched run again.
3. As often as a run tells new answers: each is told only in the round that writes it.

A `question-upstream` naming the Architecture, an Adr or a Glossary has no revision the Autopilot
runs: an architecture decision is the developer's. It stops the Autopilot after that run, and the
report names the answer and the artifact as the revision the developer owes before resuming.

## Stop

Stop and report, never work around it, when:

- a run ends Failed, or prints a reconcile error (`PERSIMMON_DEBUG=1` shows it);
- a ReviewLoop runs out of rounds and its last verdict decided nothing (no finding opening `<id>: decided.`).
  One whose last verdict did decide something, a question or a conflict the owner settled, is
  continued from its last round, so the decisions reach the artifact: run the loop that ran out (`persimmon describe WorkflowRun/<loop run>` names
  its inputs) with the same inputs plus `previous`, the last round's subject, `feedback`, the `value`
  of its review's result (`persimmon get GateRun/<loop run>-rounds-<n>-review`,
  `status.outputs.result`, in a file passed with `@`), and each input its `carry` names
  (`persimmon get ReviewLoop/<name>`) from that round's output; then the `*-all` run again;
- a form parks (above);
- an `Issue`'s fix fails its Gate (`autopilot-code`);
- an upstream revision fails its Gate, or a run names the Architecture, an Adr or a Glossary in a
  `question-upstream` (above).

## Report

At the end, or at a stop: the runs, the revisions each produced (Prd, BusinessRules, the domain
kinds, Architecture, Adrs, DesignSystem, Designs, Specs, Plans, TestHarness, TestDesigns,
AcceptanceRecords, TestOutcomes, TestReports with their verdicts and residual risks, Issues), every
`Q-n` the owner agent decided (each `decide-*` TaskRun's `decisions`, and each confirm verdict's
`Q-n: decided.` finding), every `question-agent-resolved` and `defect-reported` warning, every
`question-upstream` warning as an upstream revision the developer owes, the files changed, the
Executor overrides in place, and, at a stop, what stopped it and the command that resumes. The
developer reads it, reviews the diff and commits.
