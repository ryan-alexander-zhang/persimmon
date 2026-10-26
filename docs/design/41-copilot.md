# Copilot

status: draft · layer: 2 (`23-pack-sdlc.md`, `38-autopilot.md`, `20-pack.md` `files/`) · schema: none

The developer gives an idea and stays in their agent's chat; the agent drives the SDLC pack's run
order with the `persimmon` CLI, as the Autopilot does, and the developer decides what the pack gives
to the owner: every open `Q-n` and every Gate confirm. The agent proposes each next run and waits
for a yes, relays each parked owner form as a question with a recommended answer and the
alternatives, and answers the form with what the developer picked. The builder and the Tester are
the Autopilot's agents. One agent skill the pack ships in `files/`, reusing the Autopilot's run
order (`autopilot-doc`, `autopilot-code`) and `driving.md`; no new engine kind, verb or state.

```text
idea ─▶ brief.md ─▶ "run author-prd?" ─▶ yes ─▶ run --follow ─▶ parked decide-prd ─▶ Q-1: … recommended: … (a) … (b) …
                                                                                      ─▶ the developer picks ─▶ complete
                                                   ─▶ parked confirm-prd ─▶ "approve Prd r1? findings: …, recommended: approve"
                                                                                      ─▶ yes ─▶ complete ─▶ "Prd r1 passed. run domain-discovery?"
autopilot.yaml minus local-reviewer: builder and tester are agents; the owner is the developer, through the skill
```

## Roles

| Who | Does | Never |
|---|---|---|
| copilot (the developer's agent running the skill) | applies the builder and Tester overrides, writes the brief, proposes the next run of the order and starts it with `--follow` on a yes, reads each parked owner form and puts it to the developer with a recommendation, answers the form with the developer's choice through `persimmon complete`, applies upstream answers and writes Issues as the Autopilot does, says after each run what passed and what comes next | decides a `Q-n` or a Gate itself; starts a run the developer did not confirm; runs git |
| the developer (the **Owner**, on `local-reviewer`) | picks or types the answer to each `Q-n`, approves or rejects at each human Gate, says yes or no to each next run | types `persimmon` verbs; reads inbox forms |
| builder agent, tester agent (`builder`, `tester` overridden) | as under the Autopilot (`38-autopilot.md`) | as under the Autopilot |

## Rules

| Rule | Enforcer |
|---|---|
| the run order, the inputs of each run, the brief, the scaffold, the upstream answers, the Issues and the end report are the Autopilot's: `autopilot-doc` section 2 and `autopilot-code` give the runs, `driving.md` says how to start, read and end one; the skill adds only the stops below | skill |
| before the first run the skill applies `autopilot.yaml` and then `persimmon delete Executor/local-reviewer -n default`: the builder and the Tester run on agents, the owner stays the pack's human Executor, so every `decide-*` and `confirm-*` Task parks a `cli-human/v1` form in `.persimmon/inbox/` | skill |
| a run starts only on the developer's yes: before each run of the order the skill names it, what it takes (the passed revisions) and what it gives, and waits; "go on until a question" is a yes for every run up to the next park or end | skill |
| a parked `decide-<kind>` form (`decide-prd`, `decide-storming`, `decide-spec`, `decide-design`, `decide-design-system`, `decide-plan`, `decide-harness`, `decide-test-design`, `decide-build`) is put to the developer one question at a time: the `Q-n` as the draft states it, the context the draft gives, a recommended resolution with the reason, and the alternatives the skill sees, lettered; the developer picks a letter or types a resolution; the recommendation follows `owner-decisions`, the Prompt the owner agent reads under the Autopilot, over the form's `reading`, so the recommended answer is the one the Autopilot would have taken; every alternative is judged by the same Prompt from the question's scenario and the cost of a change is not an input, so when the right answer changes an upstream artifact the recommendation is that answer with its `upstream` named, and what runs next is reported after the decisions, never beside an alternative as a weight; an answer that changes an upstream artifact carries `upstream` as the owner's would | skill; the pack's `decide-*` Tasks |
| a parked `confirm-<kind>` form (`confirm-prd`, `confirm-storming`, `confirm-architecture`, `confirm-design-system`, `confirm-harness`, `confirm-test-design`) is put to the developer as one decision: what the document says in a few lines, the check's and the auditor's findings, from round two what the last round asked and whether it was fixed, and a recommendation, approve or reject with the findings the skill would raise, following `owner-review`; the developer approves, rejects with their own findings, or takes the recommendation; the form is answered as `askVerdict` builds it, `{passed, findings, evidence}` | skill; the pack's `confirm-*` Tasks |
| the form is answered through `persimmon complete <taskRun> --file <file>` from the project directory, the file written under `.persimmon/autopilot/`; the skill never edits the inbox form and never answers one the developer has not decided; a form of another kind than `decide-*` or `confirm-*` (a Task on a human Executor the overrides do not cover) is reported, not answered | skill |
| the next step is read from the store, never from the chat: on start, after a compaction or in a new session the skill asks `persimmon get WorkflowRun -n default` for open runs (a parked one: relay its form; a running one: `persimmon resume --follow`, then its tree) and, with none open, takes the first run of the order whose artifact kind has no passed revision (`persimmon get <Kind> --passed`); the brief is `.persimmon/autopilot/brief.md`, the `productId` the Prd's; the skill then tells the developer where the product stands and proposes that run; so the developer's chat holds no state the store does not | skill |
| after each run the skill says what passed (the revisions, from `persimmon tree`), what was rejected and why, every `question-upstream` it will apply, and the next run; `persimmon ui --read-only` shows the same map beside the skill's verbs (a listening `persimmon ui` holds the project lock the skill's `run`, `complete` and `resume` need, `25-ui.md`); a form answered in a listening `persimmon ui` is answered: the skill reads the store again before it asks | skill |
| the end report is the Autopilot's, with every `Q-n` listed under the developer's answer, not an agent's | skill |

## Decisions

- A skill over the Autopilot's skills, not a fourth mode of the engine and not a change to the
  pack's Tasks. The pack already gives the owner's questions and confirms to `local-reviewer` as
  `cli-human/v1` forms, the Inbox and `persimmon complete` already answer them, and `autopilot-doc`
  and `autopilot-code` already know the run order and inputs. The Copilot is the Autopilot with the
  owner override left out and a stop before each run; it reuses `driving.md` and the two skills by
  reference and adds the relay rules only. The developer's ask: the Autopilot decides everything,
  the CLI by hand is too much to learn, so the agent should lead step by step and recommend, while
  the developer decides.
- The owner stays human by deleting the override, not by a second override file: `autopilot.yaml`
  is applied as is and `local-reviewer` deleted, two commands, so the builder's and Tester's
  configuration lives in one file for both modes. A `copilot.yaml` holding two of the three
  Executors was weighed and refused as a copy that drifts.
- The recommendation is the Autopilot's owner reasoning, by the same Prompts: the skill reads
  `owner-decisions` and `owner-review` over the form's `reading`, so what it recommends is what the
  owner agent would have answered, and the developer sees that answer before it is taken. A
  recommendation from a shorter prompt of the skill's own was refused: two owners with two rule
  sets.
- No progress file: the store is the progress. Open runs, parked forms and passed revisions answer
  "what next" deterministically from the run order, and the Progress Tool reads the same store, so
  a compaction, a new session or a form answered in `persimmon ui` all leave the skill on the right
  step. A `.persimmon/copilot/state.yaml` was weighed and refused: a second truth beside the store.
- The builder and the Tester are agents, as under the Autopilot, chosen by the developer: the
  Tester must not see the builder's context (`39-test-process.md`), and twenty build tasks in the
  developer's own chat fill it. The developer decides `decide-build` questions as the owner; the
  code is read through the records and the diff, as under the Autopilot.
- Every run waits for a yes, with "go on until a question" as a standing yes: the developer wanted
  to be led one step at a time; a phase-at-a-time confirm was weighed and kept as that phrase.
