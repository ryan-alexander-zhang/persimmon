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
| the run order is `AGENTS.md` section 6's; each run takes the latest revision whose Gate passed, `persimmon get <Kind>/<id> --passed` (`08-store.md`), never the latest revision: a rejected or cancelled round leaves its draft in the store | skill |
| before the first run the skill applies `files/.claude/skills/autopilot/autopilot.yaml`: Executors `local-reviewer`, `builder` and `tester` in the project's Namespace, `claude-code/v1`, the owner on `claude-opus-5-5` read-only, the builder and the Tester on `claude-sonnet-5-5` `workspace-write` with the stack's commands in `allowedTools`; the report says they are in place, and `persimmon delete Executor/<name> -n default` gives a role back to the human | skill; `autopilot.yaml` |
| a question is decided where it is raised: the writer's open `Q-n` by the owner inside the round (`decide-<kind>`), the builder's or Tester's by the owner inside the build round (`decide-build`), the ones the confirm finds itself at the Gate, as a rejection `Q-n: decided.` the next round records; every decision an agent took is in the report | pack (`23-pack-sdlc.md`); skill |
| a form that parks is a Task on a human Executor the overrides do not cover: the Autopilot stops and reports it, never answers it | skill |
| a loop out of rounds whose last verdict left the writer something to act on (a finding opening `<id>: decided.`, or an error naming an id the writer can fix) is continued once from its last round (`previous`, `feedback`, its carried inputs, `21-composition.md`), as a developer gives one more round; its passed revision is the artifact and a `*-all` of documents does not run again, while `build-all` and `domain-discovery` run again with the same inputs, `memo` reusing every loop or phase that passed, the continuation too (`11-workflow.md`), and running the tail only the whole run has (the derivation; the final tests, the evaluation, the TestReport); a loop ended below `maxRounds` with `passed` false repeated its verdict and is stuck, reported, never continued (`21-composition.md`); a continuation out of rounds again with no new decision, a Failed run for another reason than a loop out of rounds (`*_inconsistent`) or `plan_regressed`, or a reconcile error stops the Autopilot with a report | skill |
| the brief states the build machine's toolchain as a constraint (the runtime and package manager versions on `PATH`: `node --version`, `python3 --version`, `go version`, `java -version`, `docker --version`, whichever answer), so the Architecture names versions the machine runs; before scaffolding, the orchestrator checks the runtime the Architecture names is the one on `PATH` at that major, and a mismatch is an upstream answer naming the block (`<architecture id> BB-n: the build machine runs <tool> <version>`) applied through `architect` with `base` and `changes`, then its impact; it never changes the machine and never scaffolds on a version the Architecture does not name | skill |
| before the first `build-all` the orchestrator does what the pack leaves to the developer: when the project has no app, it scaffolds one on the Architecture's technology and Adrs, with a unit test command that writes JUnit XML; then `setup-tests` and `test-design-all`; the project must already be a git repository | skill |
| a `D-n` whose task passed becomes an `Issue` (its `reproduction` a test already red for that reason, else `why` with the record's evidence), its fix a `build-one` on the task the Issue names (`blocks[].items` under the Plan), with `baseline` and `levelBaselines` the TestOutcomes `build-all` took first, then `build-all` for the Plan again so the plan tier runs over the fix, then the Issue's `resolved` revision; one fix attempt per Issue, then stop; an Issue that finds the Spec wrong or missing revises the Spec first as an upstream answer (`spec-one` with `base` and `changes`, then its impact), then fixes the task; a build round's `question-upstream` is applied when its run ends, and `build-all` runs again for every Plan whose Plan, a Design it lists, its TestDesign or the harness has a new passed revision: `memo` reuses each task whose inputs but the harness are unchanged and passed, builds the rest (a task the Plan added, one whose Design or TestDesign changed; a harness revision alone rebuilds none, the plan tier runs every level under it, a red there an Issue), and the plan tier runs again; never `build-one` by hand for an impact | skill |
| `plan_regressed` is an Issue with the red test as its `reproduction`, fixed the same way, never a stop; a `level-deferred` harness, once the screens are built, is run again with `base`, then `test-design-one` for the Specs with screen cases, then `build-all` again for each Plan already built whose TestDesign moved a case, so its e2e cases are written, run and reported | skill |
| a `question-upstream` warning naming a Spec, the TestHarness, a Design or a Plan is applied before the next run: that artifact's `-one` loop with `base` its latest passed revision (`get --passed`) and the answers as `changes`, Specs first; then by impact: the revision diffed against its base, each artifact below whose own statements rest on what changed (judged sentence by sentence, a citation alone impacting nothing) revised through its `-one` loop with `base` and `changes` naming the changed parts, the rest left behind and right (`get --behind`), and the order continued from the first phase not yet run; as often as a run tells new answers; one naming the Architecture or an Adr goes through `architect` the same way, with `base` and `baseAdrs`, its impact applied the same way; one naming a Glossary term or fact type, a DomainModel attribute or a BoundedContext goes through `derive-one` for that context with `base`, `baseGlossary`, `baseContext` and `changes`; one naming a DomainModel's command, event, read model or aggregate goes through `storm-design` with `base` the design-level model and `changes`, then `derive-one` for each context the model changed; one naming the Prd or a `BR-n` goes through `author-prd` with `base`, `rules` and `changes` (`28-prd-process.md`); one naming the DesignSystem goes through `design-system` with `base` and `changes` (`32-ui-design-process.md`); the Prd first, then the model, the derivation, the Architecture, Specs, the harness, Designs and Plans; the impact of each applied the same way (`26-domain-discovery.md`) | skill |
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
- The owner keeps the pack's strongest model, `claude-opus-5-5`, as the writers do: the owner's
  decisions are the product's, and a cheaper model for it was weighed against the live run's cost
  and refused, since the time went to rounds and reruns, not to the model. The builder and the
  Tester run on `claude-sonnet-5-5`, as the auditor does: a build or a test file follows a Plan
  task and a TestDesign the owner already confirmed, and the retest's wall clock was the ask. An
  earlier cut had all three on the strongest model. Chosen by the developer.
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
- `base` is the latest passed revision, read with `get --passed`, never the latest revision: the
  retest's cancelled chain left an unapproved draft as the latest revision of four artifacts, and
  the skill's "latest passed" had no verb behind it, so `get <Kind>/<id>` gave the draft and four
  revisions were based on it. Found in the Autopilot retest.
- A `question-upstream` naming a Glossary is applied through `derive-one` with `base`,
  `baseGlossary`, `baseContext` and `changes`, as an Architecture's is through `architect`. The
  stop that came before it held that a term is the developer's; in the retest the owner agent had
  decided the answer already (a fifth `outcome` value of a read model, raised by a TestDesign and
  decided in its round), and the stop left the Autopilot one Glossary enum value short of
  `build-all` with nothing for the developer to decide. The derivation stays a projection: the
  labels are the model's and `domain-consistency` still refuses drift; only what an answer adds,
  in its words, is new. Chosen by the developer in the Autopilot retest.
- Every upstream kind has a revision path: the Prd and its rules through `author-prd`, the storming
  model through `storm-design`, the derivation through `derive-one`, the Architecture through
  `architect`, the rest through their `-one` loops, each with `base` and `changes` and its impact
  applied by the same rule. After the Glossary stop went, the Prd and the storming model were the
  two kinds an answer could still name with no loop to apply it; an agent improvising there runs
  the phase from scratch, and everything below reads as behind, the rerun the developer asked to
  be rare. Chosen by the developer in the Autopilot retest.
- `build-all` is run again, by `memo`, wherever a Plan's build must change: a task out of rounds
  continued by hand, an Issue fixed, a `plan_regressed`, a Plan, Design, TestDesign or harness
  revised after the build, e2e cases moved once the screens exist. The first rule applied the
  document loops' "never run the `*-all` again" to the build and named `build-one` for the
  impacted tasks, and the walkthroughs found the rest: a stuck task left the Plan's other tasks
  unbuilt and its final tests, TestReport and regression Gate never run, a task the revised Plan
  added had no rule to build it, and a fix proved one task while the TestReport kept its failing
  verdict. The tail only `build-all` has (the final suite, `evaluate-tests`, `report-tests`,
  `regression-gate`) is the plan tier, and `memo` with `ignore: [baseline, levelBaselines]` makes
  the run again cost only the tasks whose inputs changed. The same holds for `domain-discovery`,
  whose derivation is its tail. Found in a pack walkthrough.
- A `*-all` of documents is still never run again: its loops are independent, its memo reuses the
  continuation, and the next phase reads the latest passed revisions. The stop rule names the
  reasons it excludes (`*_inconsistent`, `plan_regressed`), since a `*-all` ends Failed exactly
  when a loop runs out and an orchestrator reading "a run ends Failed: stop" first stopped there.
- The brief states the build machine's toolchain and the scaffold checks it. In the retest the
  Architecture named Node 22 from its own judgement, the machine's `PATH` ran Node 26, the store
  library would not build on it, and `setup-tests` spent three rounds on the same deterministic
  `seed-missing` finding that no writer could fix. The Architecture writer cannot see the machine;
  the brief can, and a mismatch found at scaffold is an answer the Architecture owes, applied like
  every other upstream answer, so the Autopilot neither changes the machine nor builds on a version
  nothing named. Found in the Autopilot retest.
- The Autopilot never runs git, as no agent in the pack does: the developer commits the diff once,
  after reading the report.
