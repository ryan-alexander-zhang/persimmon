# Driving a rewrite run

How the `rewrite` skill starts each persimmon run and answers its forms. Start, park, complete, End,
Stop and the Reviewer subagent are `.claude/skills/autopilot/driving.md`'s; read it first. This file
adds what a rewrite run differs in. You run every `persimmon` command from the project directory;
you never run git and never touch the source checkout.

## Inputs

- the source: `--input source=<checkout path>`, as `repository` is passed
- the project: `--input repository=<project path>`
- a Slice: `--input slice=SL-<n>`
- the inventory as a value, for `domain-discovery`: write the `spec.content` of
  `persimmon get SourceInventory/<productId>-inventory` (the passed revision) to
  `.persimmon/rewrite/inventory.yaml` and pass `--input inventory=@.persimmon/rewrite/inventory.yaml`

## Forms

Tell a form by its `outputs`:

- a value port `decisions`: a human decision (`cut-slices`, `decide-recovery`, `review-parity`).
  Attended, the developer answers it: show them the form's path and what the Task asks. With
  `--autopilot`, a Reviewer subagent answers it (below).
- a value port `written` or `mutants`: a Tester form (`write-characterization`, `write-mutants`,
  `write-rewrite-driver`). A new tester subagent per form, as `autopilot-code` says, with this
  prompt in place of its own:

  > You are the Tester of a persimmon rewrite. Read `.persimmon/inbox/<taskRun>.yaml`: its
  > `instructions`, then every `reading` entry; the Prompt entries are your rules. The Source system
  > is the checkout at the `source` input's `locator.path`: read it, run it only through the suite's
  > level commands, never change it. Write tests and drivers in the project only. Do not run
  > `persimmon complete`; write the answer file to `.persimmon/autopilot/<taskRun>.answer.yaml` and
  > stop. Never run git or `persimmon`. Reply with the files you wrote and anything you could not.

- anything else: the SDLC pack's, as `autopilot`'s `driving.md` says.

## Reviewer subagent for a decision

With `--autopilot`, one per form, new each time, with `autopilot`'s Reviewer prompt and these lines
added to it:

> You answer a typed decision, not a verdict: write
> `outputs: {decisions: {kind: value, value: <the object the port's schema asks>}}`. `approved` is
> your verdict; `findings` the errors that block it, each naming its id.

and, per Task:

- `cut-slices`: take the reader's proposed Slices unless one breaks the Survey rules (an entry
  point in no Slice or in two, a Slice beyond one agent's context); `SL-1` the least connected.
- `decide-recovery`: every Disposition is the brief's default unless a recorded answer shows the
  rule is a bug the brief says to fix; `dead` only with the evidence named in the form's
  `unreachable` or the ledger; accept an open item only with why no test can reach it; settle
  each reader disagreement by reading the code at both `where`s.
- `review-parity`: approve only on a `pass` verdict, or `concerns` you accept with a reason naming
  each unverified item or unreached entry point; confirm the driver only after reading every method
  of it against `driver-rules`.

Keep every decision it replies with for the report.
