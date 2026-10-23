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
- a value: `--input productId=<id>`; a list of capability entries, one per capability with its
  bounded context, as a file: `- {id: CAP-1, context: room-bookings}` lines, `--input capabilities=@caps.yaml`
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
reused, not run again: `tree` shows it as reused. So a `*-all` run started again after a stop (a
usage limit, one failed iteration) redoes only the capabilities or blocks with no passed loop yet.

## Upstream answers

A run whose tree warns `question-upstream` naming an artifact (`<artifact id>` or `<artifact id>
Q-n`) carries an answer that artifact does not have yet: a scenario the Spec lacks, a level the
harness lacks, an operation a Design lacks, a task the Plan moves. Apply it before the next run of
the order:

1. Revise the artifact through its own loop with `base` its latest passed revision
   (`persimmon get <Kind>/<id> --passed`; never the latest revision, a rejected or cancelled round
   leaves its draft in the store) and `changes=@<file>` listing each answer as
   `<artifact id> Q-n: <resolution>`, from the warnings:
   `spec-one` with the inputs `spec-all` gave it (`prd`, `capabilityId`, `architecture`, `context`,
   `domainModel`, `glossary`, `rules`); `setup-tests` with the inputs it had (`architecture`, `adrs`,
   `designs`, `repository`); `design-one` with the inputs `design-all` gave it; `plan-one` with the
   inputs `plan-all` gave it; `architect` with the inputs it had (`prd`, `rules`, `contexts`,
   `domainModels`, `glossaries`), `base` the latest passed Architecture (`--passed`) and `baseAdrs` its Adrs.
   The Architecture first, then Specs, the harness, Designs and Plans; one answer may name several
   artifacts.
2. Its Gate passed, apply the revision by impact, never by running the order again. Diff the
   revision against `base` (`persimmon get <Kind>/<id>.r<n>` for both) and list the parts that
   changed, by id: a Spec's `AC-n`, `R-n` or story; an Architecture's `BB-n` (its `technology` or
   `interfaces` too), `REL-n`, `CC-n`, `QS-n`, an Adr; a Design's element; a harness level. An
   artifact below is impacted when something it states rests on what changed in the part, judged
   sentence by sentence, not by the citation alone: a Design realising a block whose interface
   changed, a Spec whose scenario states a rule a `CC-n` or `QS-n` now states otherwise, a Plan
   with a task on a changed Design or scenario, the harness on a `testing` concept or a block's
   technology, a TestDesign on a changed Spec, Plan or Design. A Design that lists an Adr in its
   `decisions`, or a Spec citing a `QS-n` whose changed sentence it never used, is not impacted.
   One that is not stays as it is: behind the new revision (`persimmon get <Kind> --behind`), not
   wrong. Say in the report which artifacts you judged impacted and why. Revise each impacted
   artifact through its `-one` loop with `base` its latest passed revision (`--passed`) and `changes=@<file>`
   listing each changed part as `<artifact id> <part id>: <what changed>`, in order: Specs, Designs,
   Plans, the harness (`setup-tests` with `base` and `changes`), then TestDesigns (`test-design-one`
   with `base`; its revised inputs are its change). Then continue the order from the first phase not
   yet run, with the latest revisions as inputs; a `*-all` run that passed is not run again.
3. As often as a run tells new answers: each is told only in the round that writes it.

A `question-upstream` naming a Glossary has no revision the Autopilot runs: a term is the
developer's. It stops the Autopilot after that run, and the report names the answer and the
artifact as the revision the developer owes before resuming.

## Stop

Stop and report, never work around it, when:

- a run ends Failed, or prints a reconcile error (`PERSIMMON_DEBUG=1` shows it);
- a ReviewLoop runs out of rounds twice. The first time, when its last verdict left the writer
  something to act on, a decision (a finding opening `<id>: decided.`) or an error naming an id the
  writer can fix, continue it from its last round, as a developer gives one more round: run the loop
  that ran out (`persimmon describe WorkflowRun/<loop run>` names its inputs) with the same inputs
  plus `previous`, the last round's subject, `feedback`, the `value` of its review's result
  (`persimmon get GateRun/<loop run>-rounds-<n>-review`, `status.outputs.result`, in a file passed
  with `@`), and each input its `carry` names (`persimmon get ReviewLoop/<name>`) from that round's
  output. Its passed revision is the artifact: the `*-all` run is not run again, the order goes on
  with it. A continuation that runs out again with no new decision stops;
- a form parks (above);
- an `Issue`'s fix fails its Gate (`autopilot-code`);
- an upstream revision fails its Gate, or a run names a Glossary in a `question-upstream` (above).

## Report

At the end, or at a stop: the runs, the revisions each produced (Prd, BusinessRules, the domain
kinds, Architecture, Adrs, DesignSystem, Designs, Specs, Plans, TestHarness, TestDesigns,
AcceptanceRecords, TestOutcomes, TestReports with their verdicts and residual risks, Issues), every
`Q-n` the owner agent decided (each `decide-*` TaskRun's `decisions`, and each confirm verdict's
`Q-n: decided.` finding), every `defect-reported` warning, every
`question-upstream` warning as an upstream revision the developer owes, the files changed, the
Executor overrides in place, and, at a stop, what stopped it and the command that resumes. The
developer reads it, reviews the diff and commits.
