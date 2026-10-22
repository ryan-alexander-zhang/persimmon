# Autopilot

status: draft · layer: 2 (`23-pack-sdlc.md`, `20-pack.md` `files/`, `35-build-process.md`) · schema: none

The developer gives an idea; their own agent runs the SDLC pack's whole run order and leaves code,
evidence and every artifact in the store. The Autopilot is three agent skills the pack ships in
`files/`, read by the developer's agent, plus one file of Executor overrides. The skill drives the
runs with the `persimmon` CLI, the same verbs a developer types; the overrides put an agent on every
Executor the pack gives to a person, so the engine itself runs the owner, the builder and the
Tester, and no form parks.

```text
idea ─▶ autopilot-doc ───────────────────────────────────────────────────────────▶ autopilot-code ─────────────────────────▶ report
        brief.md, author-prd, domain-discovery, architect, spec-all, design-all,    scaffold, setup-tests, test-design-all,
        design-system, design-all (ui), plan-all                                    build-all per Plan, D-n ─▶ Issue ─▶ build-one,
                                                                                    Issue resolved
        autopilot.yaml: local-reviewer, builder, tester ─▶ claude-code/v1 agents in the project's Namespace
        every decide-* and confirm-* Task: the owner agent     every implement and Tester Task: the builder and tester agents
autopilot = autopilot-doc then autopilot-code
```

## Roles

| Who | Does | Never |
|---|---|---|
| orchestrator (the developer's agent running the skill) | applies `autopilot.yaml`, writes the brief, starts each run with `--follow`, reads `persimmon tree` for the artifacts the next run takes, applies upstream answers through the `-one` loops, writes Issues, reports | answers a form; runs git |
| owner agent (`local-reviewer` overridden) | decides a draft's open questions inside its round (`decide-*`, `owner-decisions`) and confirms a document at its Gate (`confirm-*`, `owner-review`), as the human would, with the same instructions, context and `feedback` | took part in the authoring (a fresh agent per Task); approves past a check's error; runs `persimmon` |
| builder agent (`builder` overridden) | builds one `implement` Task in the repository, as `AGENTS.md` section 6 says | runs git or `persimmon`; fixes a `D-n`; edits a Tester's test |
| tester agent (`tester` overridden) | answers one Tester Task (`write-harness`, `write-api-tests`, `write-e2e-tests`), as `AGENTS.md` section 6 says (`39-test-process.md`) | saw the builder's context; runs git or `persimmon`; changes the app's code |

## Rules

| Rule | Enforcer |
|---|---|
| the run order is `AGENTS.md` section 6's; each run takes the latest revision whose Gate passed | skill |
| before the first run the skill applies `files/.claude/skills/autopilot/autopilot.yaml`: Executors `local-reviewer`, `builder` and `tester` in the project's Namespace, `claude-code/v1`, `claude-opus-5`, the owner read-only, the builder and the Tester `workspace-write` with the stack's commands in `allowedTools`; the report says they are in place, and `persimmon delete Executor/<name> -n default` gives a role back to the human | skill; `autopilot.yaml` |
| a question is decided where it is raised: the writer's open `Q-n` by the owner inside the round (`decide-<kind>`), the builder's or Tester's by the owner inside the build round (`decide-build`), the ones the confirm finds itself at the Gate, as a rejection `Q-n: decided.` the next round records; every decision an agent took is in the report | pack (`23-pack-sdlc.md`); skill |
| a form that parks is a Task on a human Executor the overrides do not cover: the Autopilot stops and reports it, never answers it | skill |
| a loop out of rounds whose last verdict left the writer something to act on (a finding opening `<id>: decided.`, or an error naming an id the writer can fix) is continued once from its last round (`previous`, `feedback`, its carried inputs, `21-composition.md`), as a developer gives one more round; its passed revision is the artifact and no `*-all` runs again; a continuation out of rounds again with no new decision, a Failed run for another reason or a reconcile error stops the Autopilot with a report | skill |
| before the first `build-all` the orchestrator does what the pack leaves to the developer: when the project has no app, it scaffolds one on the Architecture's technology and Adrs, with a unit test command that writes JUnit XML; then `setup-tests` and `test-design-all`; the project must already be a git repository | skill |
| a `D-n` whose task passed becomes an `Issue`, its fix a `build-one`, then the Issue's `resolved` revision; one fix attempt per Issue, then stop; an Issue that finds the Spec wrong or missing revises the Spec first as an upstream answer (`spec-one` with `base` and `changes`, then its impact), then fixes the task | skill |
| `plan_regressed` is an Issue with the red test as its `reproduction`, fixed the same way | skill |
| a `question-upstream` warning naming a Spec, the TestHarness, a Design or a Plan is applied before the next run: that artifact's `-one` loop with `base` its latest passed revision and the answers as `changes`, Specs first; then by impact: the revision diffed against its base, each artifact below that cites, realises or rests on a changed part revised through its `-one` loop with `base` and `changes` naming the changed parts, the rest left behind and right (`get --behind`), and the order continued from the first phase not yet run; as often as a run tells new answers; one naming the Architecture or an Adr goes through `architect` the same way, with `base` and `baseAdrs`, its impact applied the same way; one naming a Glossary stops it, reported as the revision the developer owes | skill |
| the report names every Prd, Architecture, Adr, Spec, Plan and AcceptanceRecord revision, every `Q-n` the owner agent decided, every `question-upstream` warning, every Issue, the files changed and the overrides in place; the developer reviews the diff and commits | skill |

## Decisions

- A skill plus an Executor override, not a skill alone and not an engine mode. The first cut was a
  skill that put a fresh Reviewer subagent where the human sat, a builder subagent per task and a
  tester subagent per Tester form, each given a form path and a prompt the skill carried. It worked,
  and it was where the Autopilot's own bugs lived: a reviewer reopening recorded answers, one
  rejecting over an article, a wrong Tester prompt, reviewers reading the orchestrator's notes and
  the store's database, 4.6 minutes per verdict rereading a tree the skill pasted by hand. The
  pack already has the instructions, the context, the `feedback` and the Gate order for every one
  of those roles; only the Executor was a person. `autopilot.yaml` swaps the three Executors in the
  project's Namespace (`13-executor.md`: a Namespace overrides a pack Executor by name; the walk
  resolves every hop in the run's Namespace, `04-snapshot.md`), so the engine runs them as it runs
  the auditor, and the skill keeps what no override gives: the run order, the brief, the scaffold,
  the Issues, the upstream answers and the report. The earlier decision that an unattended
  Namespace alone was not enough still holds, for those parts. Found in UAT.
- The owner decides a draft's open questions inside the round, before the Gate (`23-pack-sdlc.md`).
  In the live run the human's place came after the check and the auditor, so a question was
  answered by rejecting and recorded a round later, and the next round raised the next: three
  rounds spent answering, loops dead at `maxRounds` with their answers in a GateResult alone. With
  `decide-<kind>` and `decide-build` the owner answers where the question is raised and the Gate
  judges a document with no open question of the writer's. The confirm still decides what it finds
  itself, by rejecting with `Q-n: decided.`, so no round is lost to a decision alone when the
  decide step had nothing to decide. Found in UAT.
- The owner, the builder and the Tester keep the pack's strongest model, `claude-opus-5`. A cheaper
  model for the owner was weighed against the live run's cost and refused: the owner's decisions
  are the product's, and the time went to rounds and reruns, not to the model. Chosen by the
  developer.
- A loop out of rounds is continued once when its last verdict left the writer something to act
  on: a decision, a finding opening `<id>: decided.` (`owner-review`), or an error naming an id the
  writer can fix, as a developer gives one more round; a continuation out of rounds again with no
  new decision is stuck, and a person reads why. Its passed revision is the artifact: the first cut
  ran the `*-all` again after it, which ran the same capability once more from nothing, its memo
  having no passed loop to reuse. An earlier cut continued only on a decision, so a Design loop,
  whose Gate has no owner, stopped the Autopilot on any second audit miss. Found in UAT and the
  Autopilot retest.
- Upstream answers are applied through the artifact's own loop and then by impact (above), not
  through a dependency table the skill keeps nor by the run order again. The first cut listed what
  each revised kind invalidates (a Design: its Plans, the `ui` Designs calling it, their
  TestDesigns) and still reran too much (CAP-1's TestDesign four times in ten hours with nothing
  changed); the second ran the `*-all` loops again under `memo`, which reuses only a capability
  whose input revisions are unchanged, so a global input's revision (the Architecture) reused
  nothing. `memo` still serves a `*-all` run started again after a stop (`11-workflow.md`). Found
  in UAT.
- The `*-all` loops run their capabilities side by side (`parallel: 4`), and one rejected stops
  none: the live run's agent time equalled its wall clock, and one failing capability blocked the
  ones after it. Found in UAT.
- An upstream revision is applied by impact, as a developer applies one: the parts that changed,
  the artifacts that cite or realise them, their `-one` loops with `base` and `changes`; the rest
  stay behind the revision and right. The first rule ran the order again from the first `*-all`
  below the revised kind and, for an Architecture, in full: `memo` keys on the inputs' revisions,
  so a new Architecture revision reused nothing, and one refusal code re-ran every Design and Plan
  for two hours. The Autopilot's agent does the diff and the impact reading; a deterministic
  impact check is a later step. Found in the Autopilot retest.
- Quality is capped by the checks: the Autopilot passes what `sdd/v1`, the Auditor, the tests and
  the owner agent pass, nothing more. Every `Q-n` the owner agent decided is listed in the report
  (each `decide-*` TaskRun's `decisions`), so the developer reads the guesses an idea alone forced.
- Shipped as `files/.claude/skills/<name>/SKILL.md` and `autopilot.yaml`, so `init` places them and
  updates untouched ones like `AGENTS.md`; `init` places files below `files/` at their relative
  path. Claude Code only: Codex reads `.agents/skills/`, a second copy added when a Codex user asks.
- An idea has no app, and the pack expects the developer's own app and test setup, which a builder
  never changes. The orchestrator stands in for the developer there too: one scaffold from the
  Architecture and its Adrs, with a unit test command. The test levels are then the Tester's:
  `setup-tests` records each level the Designs need with the tool the Architecture names, so the
  api and e2e levels exist before the first case needs them (`39-test-process.md`).
- The Autopilot never runs git, as no agent in the pack does: the developer commits the diff once,
  after reading the report.
