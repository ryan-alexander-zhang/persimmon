---
name: copilot
description: Build a product from one idea with persimmon, step by step, with the developer deciding - you drive every run of the SDLC order and ask before each one; every open question and every Gate confirm comes to the developer with a recommended answer and the alternatives; the builder and the Tester are agents inside the engine. Use when the developer says "copilot", wants to be led through the persimmon flow, wants to answer the questions themselves, or asks what to do next.
---

# Copilot

The developer gives an idea and stays in this chat. You drive the runs; the developer decides.
Follow `skills/autopilot-doc/SKILL.md` and `skills/autopilot-code/SKILL.md` for
the runs, their inputs, the brief, the scaffold, the upstream answers, the Issues and the report,
and `skills/autopilot/driving.md` for how one run is started, read and ended. This file
says only where you stop and what you ask. You never run git.

## 0. Before the first run

```sh
persimmon apply skills/autopilot/autopilot.yaml -n default
persimmon delete Executor/local-reviewer -n default
```

The builder and the Tester are agents; the owner stays the developer: every `decide-*` and
`confirm-*` Task parks a form in `.persimmon/inbox/`, which you relay (section 3). Tell the
developer the two overrides are in place.

## 1. Where the product stands

Read it from the store, never from this chat, at the start, after a context compaction and in a
new session:

1. `persimmon get TaskRun -n default`: one `Waiting human (.persimmon/inbox/<taskRun>.yaml)` is a
   form to relay (section 3). `persimmon get WorkflowRun -n default`: one `Running` with no form
   parked: `persimmon resume --follow`, then its tree.
2. No run open: the next run is the first of the order (`autopilot-doc` section 2, then
   `autopilot-code`) whose artifact has no passed revision, `persimmon get <Kind> --passed`:
   Prd, EventStorming and the derived kinds, Architecture, Spec, Design, DesignSystem (when the
   Architecture has client blocks), Plan, TestHarness, TestDesign, then `build-all` per Plan with no
   passed AcceptanceRecord for every task. The brief is `.persimmon/autopilot/brief.md`, the
   `productId` the Prd's.
3. Tell the developer in a few lines what passed and what you propose next.

## 2. Before each run

Name the run, what it takes (the passed revisions, by id and revision) and what it gives. Start
it only on a yes, with `--follow` as `driving.md` says. "go on until a question" is a yes for every
run up to the next park, stop or end. A no, or another ask: do that instead, then propose again.

## 3. A parked form

`run --follow` ends with `parked on you: persimmon complete <taskRun>`; the form is
`.persimmon/inbox/<taskRun>.yaml`: `instructions`, `reading` (the documents the owner reads),
`inputs` (each value input as `{kind: value, value}`), `outputs`. Read it all. Then:

**`decide-<kind>`** (`decisions` output). One question at a time, each `Q-n` in `inputs.open.value`:

- the question as the draft states it, and the context the draft gives it;
- your recommended resolution and the reason, in two or three lines, judged as the Prompt
  `owner-decisions` in the form's `reading` says, over the same reading: what the Autopilot's owner
  would answer, shown before it is taken;
- the alternatives you see, lettered, the recommendation first as (a).

Every alternative is judged by `owner-decisions` too, from the scenario the question is about:
what the product must do there and which artifact owns the thing. Avoided rework is never a
reason to rank one above another: when the right answer changes an upstream artifact (a Glossary
term, a Spec scenario, a Design field), (a) is that answer with its `upstream` named, and the
reruns below it are stated as its cost, not held against it. "No upstream change needed" is (a)
only when no upstream artifact owns the thing. The test: would (a) be the same if every artifact
were free to change?

The developer picks a letter or types a resolution. An answer that changes an upstream artifact
(settles its open question, or corrects its words) carries `upstream`, `<artifact id>` or
`<artifact id> Q-n`. Then the file, under `.persimmon/autopilot/`:

```yaml
outputs:
  decisions:
    kind: value
    value:
      - {id: Q-1, resolution: "<the developer's answer>"}
      - {id: Q-2, resolution: "<…>", upstream: "<artifact id> Q-n"}
```

**`confirm-<kind>`** (`result` output). One decision:

- what the document says, in a few lines; the check's and the auditor's findings (`inputs.audit.value`);
  from round two, what the last round asked (`inputs.feedback.value`) and whether it was fixed;
- your recommendation, approve or reject, with the findings you would raise, each naming an id
  (`G-n`, `CAP-n`, `US-n`, `BB-n`, …), judged as the Prompt `owner-review` in the reading says.

The developer approves, rejects with their own findings, or takes yours. `evidence` is the refs of
every `reading` entry shown (`ref`, without `error`):

```yaml
outputs:
  result:
    kind: value
    value:
      passed: false
      findings:
        - {severity: error, code: blocking_1, message: "CAP-2: <what must change>"}
      evidence:
        - {apiVersion: sdd.persimmon.ai/v1, kind: Prd, namespace: default, id: <id>, revision: 1}
```

An approval: `passed: true`, `findings` the notes as `{severity: info, code: note_1, message}` or
none. Then, from the project directory, in the background or with no time limit:

```sh
persimmon complete <taskRun> --file .persimmon/autopilot/<taskRun>.yaml
```

Never edit the form; never answer one the developer has not decided; a form that is neither
`decide-*` nor `confirm-*` is a Task on a human Executor the overrides do not cover: report it.
Before you ask, read the store again: a form the developer answered in `persimmon ui` is gone.
Tell the developer to watch with `persimmon ui --read-only`: a listening `persimmon ui` holds the
project lock, and `run`, `complete` and `resume` refuse to start while it runs.

## 4. After each run

Say what passed (the revisions, from `persimmon tree`), what was rejected and why, every
`question-upstream` you will apply (`driving.md`, Upstream answers, the same way, each run of it
confirmed as section 2 says), and the next run. At the end, or at a stop, the report `driving.md`
describes, every `Q-n` listed under the developer's answer.
