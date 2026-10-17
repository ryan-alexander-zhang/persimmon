# Guidelines

This project runs persimmon (`persimmon.yaml`). Its product and design artifacts live in the
persimmon store, not in files.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Reuse before build, in this order: this repo, the framework or starters,
  present dependencies, a maintained open-source library. Build only when none
  fits; record why: an `Adr` the next `architect` run takes.
- Every new dependency is an `Adr` for the next `architect` run: what it supplies,
  what was compared, why it won.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Language Consistency

**Use one canonical term for one concept.**

- Each bounded context's `Glossary` artifact is its glossary: `persimmon get Glossary`.
- A term conflicting with the Glossary: stop, resolve, then continue.
- A term the Glossary lacks: propose it for the Glossary's next revision; never a local synonym.
- Stated behavior conflicting with code or artifacts: call out the mismatch.

## 6. Artifact Workflow

- The run order: `author-prd`, `domain-discovery`, `architect`, `spec-all`, `design-all`,
  `design-system` before a `ui` `design-all`, `plan-all`, `build-all`. Each artifact cites
  upstream only.
- Read an artifact with `persimmon get <Kind>/<id>`; `--files <dir>` exports its representations,
  for a kind that has them. An exported file is a copy: change the artifact through its process, never the copy.
- A Gate's finding is fixed where it points, upstream; never worked around downstream. A
  `build-gate` finding points at the code, the tests or the record.
- An unknown is a `Q-n`, never an assumption. What only a domain owner can settle waits for
  the human at a Gate.
- Write code only against a revision its Gate passed: `persimmon tree <run>` shows `passed`;
  a loop out of rounds still publishes its rejected revision. `persimmon get <Kind> --behind`
  lists the revisions that read an outdated input.

Building a Plan task (`build-all`), as the developer's own agent reading an inbox form:
- The run waits on you at each task: `.persimmon/inbox/<taskRun>.yaml` is the brief, its
  `reading` the build rules, the Plan, the Spec, the Architecture, the Designs, the Glossary
  and the business rules; in a later round also the last record and what the tests did, with
  the findings in `inputs.feedback`.
- The build rules win over sections 1-5 for a build task: a dependency the Architecture does not
  name is a `Q-n`, never installed.
- Build in the directory `inputs.repository.ref.locator.path` names: the tests run there, with
  the project's own test setup, which you use as it is and never change. Ask the
  developer how to build; a domain unknown is a `Q-n` the Gate holds for the human.
- Answer with a file holding `outputs: {record: <the AcceptanceRecord>}` and run
  `persimmon complete <taskRun> --file <file>` from the project directory, in the background or
  with no time limit: it runs the tests and the Gate before it returns. The next round or task
  then waits on you, unless the tree it prints shows the run ended.
- Never run git; once the Gate passed, the developer reviews the diff and commits.

## 7. Output Discipline

One sentence when one sentence answers it; expand only on request. Formatting as
short as the content: prose for short answers, no headings or bullets over a single
conclusion. This governs replies to a human, not the documents a Task writes.

## 8. Persimmon Tasks

An agent whose prompt is a persimmon Task (it ends with `## Answer`), not the developer's agent
reading a `.persimmon/inbox/` file in section 6:
- follows its Task's Prompt where it differs from this file;
- never asks and never stops to ask: an unknown goes into its output, a `Q-n` or a hotspot,
  as its Prompt says;
- never runs git and runs no `persimmon` command: it reads only its Task's context;
- writes only where its Task allows, and answers through its output.
