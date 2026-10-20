# Autopilot

status: draft · layer: 2 (`23-pack-sdlc.md`, `20-pack.md` `files/`, `35-build-process.md`) · schema: none

The developer gives an idea; their own agent runs the SDLC pack's whole run order and leaves code,
evidence and every artifact in the store. No engine change: the Autopilot is three agent skills the
pack ships in `files/`, read by the developer's agent. It drives the runs with the `persimmon` CLI,
the same verbs a developer types, and puts a fresh subagent where the human sat.

```text
idea ─▶ autopilot-doc ───────────────────────────────────────────────────────────────▶ autopilot-code ─────────────────────────────▶ report
        brief.md, author-prd, domain-discovery, architect, spec-all, design-all,        build-all per Plan, D-n ─▶ Issue ─▶ build-one,
        design-system, design-all (ui), plan-all                                        Issue resolved
        each human Gate form ─▶ Reviewer subagent                                       each builder form ─▶ builder subagent
autopilot = autopilot-doc then autopilot-code
```

## Roles

| Who | Does | Never |
|---|---|---|
| orchestrator (the developer's agent running the skill) | writes the brief, starts each run with `--follow`, reads `persimmon tree` for the artifacts the next run takes, hands each parked form to a subagent, runs `persimmon complete <taskRun> --file` on its answer, writes Issues, reports | answers a form itself; runs git |
| Reviewer subagent | reads one human Gate's form (`.persimmon/inbox/<taskRun>.yaml`) and the run's tree, writes the answer file: `{passed, findings, evidence}` on the form's value port | took part in the authoring; approves past a check's error; runs `persimmon` |
| builder subagent | builds one `implement` form's task and writes its answer file, as `AGENTS.md` section 6 says | runs git or `persimmon`; fixes a `D-n` |

## Rules

| Rule | Enforcer |
|---|---|
| the run order is `AGENTS.md` section 6's; each run takes the latest revision whose Gate passed | skill |
| a human Gate (`confirm-prd`, `confirm-storming`, `confirm-architecture`, `confirm-design-system`) is answered by a new Reviewer subagent per form, given only the form path and the review checklist | skill |
| the Reviewer subagent settles a `Q-n` only a domain owner could by rejecting with the decision as a finding, as the human would (`example07` step 2); every such decision is in the report | skill |
| a loop out of rounds is started again once over what did not pass, the same inputs, its Gate judging again; out of rounds a second time, a Failed run for another reason or a reconcile error stops the Autopilot with a report | skill |
| before the first `build-all` the orchestrator does what the pack leaves to the developer: when the project has no app, it scaffolds one on the Architecture's technology and Adrs, with a unit test command that writes JUnit XML, and overrides Executor `test-runner` with that command; the project must already be a git repository | skill |
| a `D-n` whose task passed becomes an `Issue`, its fix a `build-one`, then the Issue's `resolved` revision; one fix attempt per Issue, then stop; an Issue that finds the Spec wrong or missing stops it, a Spec revision being the developer's call | skill |
| `plan_regressed` is an Issue with the red test as its `reproduction`, fixed the same way | skill |
| the report names every Prd, Architecture, Adr, Spec, Plan and AcceptanceRecord revision, every `Q-n` an agent resolved, every Issue and the files changed; the developer reviews the diff and commits | skill |

## Decisions

- A skill, not an engine mode. The pack already lets the developer's agent answer a form
  (`35-build-process.md`, proven live), and every verb the Autopilot needs exists. An unattended
  Namespace overriding `local-reviewer` to `claude-code/v1` was compared: it makes the engine run
  alone, but nothing then writes an Issue, picks the next run's inputs or stops on a stuck loop, so
  a driver is needed anyway; the override stays available beside it.
- A fresh Reviewer subagent answers each human Gate, not the orchestrator and not a pause for the
  human. The orchestrator has watched every round and would approve its own story; a pause defeats
  "give an idea, get code". A subagent with only the form reads what the human would read. The
  pack's Auditor still runs before it; the subagent is the human's place, not the Auditor's.
- A fresh reviewer per round moves the goalposts: in the first live run each found new nits
  (a wrong count in a rejected alternative's prose, then an article) and the architect loop ran out
  of rounds. The reviewer is told its round and rejects only what later work would build on
  wrongly; wording is a note; from round 2 it checks the earlier findings first and leaves what
  earlier rounds did not flag unless it is wrong. Fresh still, so no reviewer approves its own asks.
- The orchestrator answers no form at all, builder forms included: a builder subagent per task keeps
  each task's context to its brief, and the orchestrator's context to the run order across hours.
- Quality is capped by the checks: the Autopilot passes what `sdd/v1`, the Auditor, the tests and
  the Reviewer subagent pass, nothing more. Agent-resolved `Q-n` are warned (`question-agent-resolved`)
  and listed in the report, so the developer reads the guesses an idea alone forced.
- Shipped as `files/.claude/skills/<name>/SKILL.md`, so `init` places them and updates untouched
  ones like `AGENTS.md`; `init` now places files below `files/` at their relative path. Claude Code
  only: Codex reads `.agents/skills/`, a second copy added when a Codex user asks.
- An idea has no app, and the pack expects the developer's own app and test setup, which a builder
  never changes. The orchestrator stands in for the developer there too: one scaffold from the
  Architecture and its Adrs, one `test-runner` override, before the baseline. Only the unit level:
  the other levels are added when a quality scenario needs them.
- The Autopilot never runs git, as no agent in the pack does: the developer commits the diff once,
  after reading the report.
