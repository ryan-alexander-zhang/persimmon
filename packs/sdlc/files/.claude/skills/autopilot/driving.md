# Driving a run unattended

How the Autopilot (`autopilot`, `autopilot-doc`, `autopilot-code`) starts one persimmon run and takes
it to its end with no human. You are the orchestrator: you run every `persimmon` command, from the
project directory. You never answer a form yourself and you never run git.

## Start

```sh
persimmon run <Workflow> --input <port>=<yaml | @file> ... --follow
```

Run it in the background or with no time limit: it returns when the run ends or parks on a human.
Write long inputs to files under `.persimmon/autopilot/` and pass them with `@`.

Input shapes:

- one artifact: `'prd={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Prd, namespace: default, id: <id>, revision: <n>}}'`
- a list of artifacts: a file of `- {apiVersion: sdd.persimmon.ai/v1, kind: <Kind>, id: <id>, revision: <n>}` lines, `--input designs=@designs.yaml`
- a value: `--input productId=<id>`, `--input 'capabilities=[CAP-1, CAP-2]'`
- the repository: `--input repository=<path>`

## Parked

A park prints `parked on you: persimmon complete <taskRun>`; its form is
`.persimmon/inbox/<taskRun>.yaml`. Several may park at once: answer each. Tell the form by its
`outputs`:

- a value port whose schema requires `passed`, `findings`, `evidence`: a human Gate. Start a new
  Reviewer subagent for it (below).
- an artifact port `record` (an AcceptanceRecord): a builder form. Start a new builder subagent for
  it (`autopilot-code`).
- an artifact port `harness` (a TestHarness) or a value port `written`: a Tester form. Start a new
  tester subagent for it (`autopilot-code`), never the builder subagent of that task.

Each subagent writes `.persimmon/autopilot/<taskRun>.answer.yaml` and stops. Then you run, in the
background or with no time limit:

```sh
persimmon complete <taskRun> --file .persimmon/autopilot/<taskRun>.answer.yaml
```

It drains the engine and returns at the next park or at the run's end. A refused answer file
prints why: give the reason to a new subagent of the same kind, never edit the answer yourself.

## Reviewer subagent

One per form, new each time, never one that wrote or saw an earlier round. Give it this prompt and
nothing about how the document came to be:

> You are the human reviewer at a persimmon Gate, the domain owner. You did not write what you
> review. Read `.persimmon/inbox/<taskRun>.yaml`: its `instructions`, then every `reading` entry in
> order; the Prompt entries are the checklist, the artifact entries are what is under review. Read
> what the checks before you found: `persimmon tree WorkflowRun/<run>` output below.
> This is round <n> of at most <max>; a rejection in round <max> ends the loop unapproved.
> Approve only if the document is right for its product, consistent with what it cites, and the
> checks left no error. Reject only for what is wrong: a behaviour, number, rule or citation that
> later work would build on wrongly, or an open `Q-n`. Wording, grammar and style are `info` notes
> on an approval. From round 2 the tree holds the earlier rounds' findings: check those were fixed
> first; what an earlier round left unflagged stands unless it is wrong in that sense.
> Every open `Q-n` you settle: reject, with a finding naming it, the
> decision and what to change (`Q-1: decided. <decision>. Remove Q-1 and <where it goes>.`).
> Decide as a careful owner of this product would, the simplest choice that serves the Prd. Every
> finding names the id it is about. Do not run `persimmon` or git.
> Write `.persimmon/autopilot/<taskRun>.answer.yaml`:
> `outputs: {<the value port>: {kind: value, value: {passed: <bool>, findings: [{severity: error | info, code: blocking_<n> | note_<n>, message}], evidence: [<the ref of every artifact entry you read>]}}}`.
> A rejection's findings are `error`; an approval's notes are `info`. Reply with `passed` and
> every `Q-n` you decided, one line each.

Fill in the round from the task name (`rounds-<n>`), its `<max>` from the ReviewLoop's `maxRounds`
(`persimmon get ReviewLoop/<name>`), and append the tree's output to the prompt.
Keep every `Q-n` decision it replies with for the report.

## End

`persimmon tree WorkflowRun/<run>` names what the run produced and each Gate's result. A ReviewLoop
out of rounds still publishes its rejected revision: take a revision only from a round whose
review `passed`. The next run takes those revisions.

## Stop

Stop and report, never work around it, when:

- a run ends Failed, or prints a reconcile error (`PERSIMMON_DEBUG=1` shows it);
- a ReviewLoop runs out of rounds a second time. The first time, start the same Workflow again
  over only what did not pass (the capabilities, blocks or tasks left), with the same inputs: a
  loop's agent may pass from a fresh start, and its Gate still judges;
- a subagent's answer is refused twice for the same form;
- an `Issue`'s fix fails its Gate (`autopilot-code`).

## Report

At the end, or at a stop: the runs, the revisions each produced (Prd, BusinessRules, the domain
kinds, Architecture, Adrs, DesignSystem, Designs, Specs, Plans, TestHarness, TestDesigns,
AcceptanceRecords, TestOutcomes, TestReports with their verdicts and residual risks, Issues), every `Q-n` an agent decided, every `question-agent-resolved` and `defect-reported`
warning, every `question-upstream` warning as an upstream revision the developer owes, the files changed, and, at a stop, what stopped it and the command that resumes. The
developer reads it, reviews the diff and commits.
