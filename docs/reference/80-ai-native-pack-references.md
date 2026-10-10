# AI Native Pack: References

Status: survey, collected 2026-10-10. Star counts are GitHub, read that day. Input to the
design of the built-in AI Native Pack (`docs/design/2x-*`, pack of its own beside the demo
`packs/sdlc/`). Nothing here is a decision; each row says what the pack may take from it.

## 1. Spec-driven development tools

The shape of the process: phases, the artifact each phase writes, the gate between phases.

| Project | Stars | Core idea | Takes for the pack |
|---|---|---|---|
| [github/spec-kit](https://github.com/github/spec-kit) | 140.7k | constitution → specify → clarify → plan → tasks → implement → analyze; agent-agnostic templates, one directory per feature | greenfield phase chain and artifact set; `constitution` as a project-level artifact every phase reads |
| [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) | 71.5k | brownfield changes as spec deltas (ADDED / MODIFIED / REMOVED); proposal → apply → archive, archive merges the delta into the living spec | change-as-delta artifact kind and the archive step; most real work is brownfield |
| [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) → [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) | 64.3k / 10.4k | meta-prompting and context engineering; phases with a human pause at the end of each | gate placement: one human gate per phase end |
| [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) | 54.0k | role agents (analyst, PM, architect, scrum master, dev, QA); PRD → architecture → stories, each role a prompt | role split as Executors + Prompts; story as the unit of implementation |
| [buildermethods/agent-os](https://github.com/buildermethods/agent-os) | 5.5k | v3 (2026-01) kept standards injection and dropped spec writing, task breakdown and orchestration because host tools absorbed them | a warning: the pack's value is process state across tools (runs, gates, provenance), not prompts |
| [gemini-cli-extensions/conductor](https://github.com/gemini-cli-extensions/conductor) (Google) | 3.8k | context → spec and plan → implement; "tracks" as units of work; context kept as Markdown in the repo | track as the run unit; context artifacts kept in the repository |
| [gotalab/cc-sdd](https://github.com/gotalab/cc-sdd) | 3.7k | Kiro-style requirements → design → tasks → implementation; EARS requirements; 17 skills per install | EARS requirement format; per-phase skills |
| [spec-kitty/spec-kitty](https://github.com/spec-kitty/spec-kitty) | 1.7k | spec-kit fork; one git worktree per feature; kanban over tasks | worktree per run as a workspace policy |
| [kirodotdev/Kiro](https://github.com/kirodotdev/Kiro) (AWS, closed IDE) | 4.4k | `requirements.md` / `design.md` / `tasks.md` per feature; EARS; hooks on file events | the three-file minimum; hooks map to Triggers |
| Tessl (no public repository) | – | spec as source: only specs are edited, code is generated and marked "do not edit"; beta | a far end of the spectrum; not a target |

Comparisons: [RSMuthu/SDD-comparison](https://github.com/RSMuthu/SDD-comparison) (six tools
side by side, worktree analysis), [cameronsjo/spec-compare](https://github.com/cameronsjo/spec-compare)
(lockstep walkthroughs, scoring heatmap).

## 2. Skills collections

The content of a phase: how an agent brainstorms, plans, implements, reviews.

| Project | Stars | Core idea | Takes for the pack |
|---|---|---|---|
| [obra/superpowers](https://github.com/obra/superpowers) | 297.0k | a methodology: brainstorm → write-plan → execute-plan; TDD; subagent-driven review; a hook loads it at session start | phase skills as Skill context on Tasks; pause at the plan and at the failing test |
| [mattpocock/skills](https://github.com/mattpocock/skills) | 283.4k | small composable SKILL.md files: grill-me, TDD loop, plan review; the human stays in control | the clarify phase as a grilling session; skills small enough to pin by digest |
| [anthropics/skills](https://github.com/anthropics/skills) | 180.2k | official reference skills in the SKILL.md format | the format reference; no process content |
| [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) | 104.2k | production engineering skills: code review, testing, debugging, performance | review and test phases |
| [EveryInc/compound-engineering-plugin](https://github.com/EveryInc/compound-engineering-plugin) | 25.4k | learning loop: every correction is written into the rules the next run loads; 80% plan and review, 20% execution | a Task that publishes a rules artifact later runs read as context |
| [NeoLabHQ/context-engineering-kit](https://github.com/NeoLabHQ/context-engineering-kit) | 1.8k | quality-of-result skills; an open-source CodeRabbit alternative | review Validators |

## 3. Standard and indexes

| Project | Stars | Use |
|---|---|---|
| [agentskills/agentskills](https://github.com/agentskills/agentskills) | 26.0k | the SKILL.md open specification, 40+ client adopters; the format behind `skillFormats` in `19-adapter-roles.md` |
| [ComposioHQ/awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) | 76.8k | directory of skills, plugins, MCP servers |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | 55.3k | directory of skills, hooks, slash commands |
| [VoltAgent/awesome-agent-skills](https://github.com/VoltAgent/awesome-agent-skills) | 35.5k | index of 1000+ skills across Claude Code, Codex, Gemini CLI, Cursor |
| [travisvn/awesome-claude-skills](https://github.com/travisvn/awesome-claude-skills) | 15.3k | directory; last pushed 2026-04 |

## 4. Reading order for the design

1. spec-kit and OpenSpec: the greenfield chain and the brownfield delta, together the artifact kinds.
2. superpowers and GSD: where the human gates sit; maps to Approval and ReviewLoop (`21-composition.md`).
3. BMAD: the role split; maps to Executors and Prompts.
4. mattpocock, addyosmani: phase skills; maps to Skill context on Tasks.
5. compound-engineering: the learning loop; new for persimmon, an artifact kind of its own.
6. agent-os v3: what not to build.
