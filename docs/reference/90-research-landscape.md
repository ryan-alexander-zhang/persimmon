# Research Notes Summary (Persimmon AI Project Research)

Earlier thinking that preceded the design doc. Treated as a source of candidate ideas, not as
the baseline.

## Recursive workflow model

- Workflow is recursive; a Node is one invocation of another Workflow; only the leaf
  Activity executes (agent, script, tool, human). "Everything is Workflow, Activity is the
  only primitive."
- Workflow owns an input/output contract and exit states; parents depend only on the
  contract, never on a child's internal step.
- Artifacts have scope: internal versus exported.
- Two gate levels: internal (control flow inside a workflow) and boundary (parent checks child
  outcome).
- Approval can itself be a Workflow (manual, auto, hybrid).
- Two audit concepts: Audit Workflow (business check producing a report) and Execution Audit
  Trail (always-on system record).
- AGENTS.md, prompts, skills and scripts are different layers: context, instruction template,
  reusable capability, deterministic executable.
- Skill versus Workflow: anything needing persistent state, retry, wait, approval, branch or
  re-entry becomes a Workflow.
- Context and model configuration inherit: organization → project → workflow → node → activity,
  with explicit precedence.
- Execution tree (runs) and artifact dependency graph are separate structures.
- Parent runs hold explicit state (RUNNING, WAITING, BLOCKED, ...) plus `waiting_reason`.
- "Development finds a PRD problem" is modeled as a ChangeRequest artifact plus re-invocation
  of the PRD workflow at a `revise` entrypoint, not as a jump back.
- Workflows expose named entrypoints (create, revise, review-only).
- ChangeRequest handling is itself a Workflow.
- Principles: Workflow is recursive. Activity is atomic. Artifact carries state. Event drives change.

## Tool landscape (as of 2026-09-16)

| Tool | Fit |
|---|---|
| GitHub Spec Kit | YAML workflow DSL with command/prompt/shell/gate/if/switch/while/fan-out/fan-in, pause/resume, per-step integration and model; own Python engine; state in `.specify/workflows/runs/<id>/` |
| Product Forge | Spec Kit extension with a full SDLC and human gates; phase rollback by name |
| AGTX | Multi-agent terminal manager: per-phase agent choice, worktree + tmux; a phase machine, not a graph engine |
| LangGraph | Checkpoint, interrupt, replay, fork, time travel; best for inside a complex agent node |
| Temporal | Durable long-running business workflows; candidate underlying runtime at scale |
| Shep | Productized idea → PR pipeline with approval flags; fixed flow |
| ReverbCode | Multi-agent coding with worktrees, PR/CI feedback loop; execution plane |
| BMAD, Windmill, Dify | Methodology, script/approval nodes, visual LLM workflows respectively |

Recommendations recorded there: unify `reasoning.effort` as an abstraction with adapters
translating to Codex `model_reasoning_effort`, Claude Code `--effort`, etc.; separate agent
runtime from model (`runtime: opencode, provider: deepseek, model: ...`); treat AI approval as
an evaluator feeding a gate, with human fallback under thresholds; keep artifacts versioned
outside agent conversations; design a `WorkflowRuntime` interface so Spec Kit, Temporal or
LangGraph can back it.

Suggested phasing there: Phase 1 extend Spec Kit's engine (checkpoint, artifact version,
approval policy, agent profile); Phase 2 move durable execution to Temporal if scale demands.
