# Roadmap

Layers above the framework, in build order, plus items intentionally out of scope.

## Layer 1: core kinds (shape fixed now, handlers built after Layer 0)

Workflow, Task, Executor, Gate, Validator, Prompt, Skill, Trigger, RelationType and the run
kinds, each as `KindDefinition` + built-in `Handler`. Acceptance: every one registers through
the public path; no engine special case.

## Layer 2: SDLC pack (first-class deliverable, decision 26)

Cluster-scoped, pre-installed, overridable by name in any namespace. Shape: step-capable
composition kinds that expand to core kinds at snapshot time, so a running pipeline is pinned
to the expansion it started with.

| Kind | Expands to |
|---|---|
| `Pipeline` | one Workflow: phases as steps, linear transitions, per-phase failure routing |
| `ReviewLoop` | body Workflow (produce → review Gate) + repeat step + feedback plumbing |
| `Approval` | Gate step whose validators run behind human or agent Executors, branch on `passed` |
| `Rollout` | deploy / verify / rollback Workflow with operationKey and fencingToken |

Users write Pipelines; they drop to raw Workflows only when the pack cannot express a shape.
Contents:

- The 14 artifact kinds under `engineering.persimmon.ai/v1` as revisioned KindDefinitions.
- RelationTypes `implements-v1`, `verifies-v1`; the traceability validator; entity indexing.
- Workflows `sdlc`, `research`, `planning-iteration`, `engineering-iteration`, `rollout`;
  their Tasks, Gates, Validators; reference Executors for agent, script, tool, human.
- Rollout semantics: DeploymentPlan, operationKey, fencingToken, rollback branches.
- Override mechanism: same-name definition in a namespace shadows the shipped one.

## Layer 3: user kinds and handlers

Documented by the framework already. Needs: packaging/installation of `KindDefinition` +
`Handler` bundles, versioning, and a conformance suite for out-of-process handlers.

## Candidate sugar over the core model (no runtime change)

- Named entrypoints compiled to separate Workflows plus shared sub-Workflows.
- Context inheritance (namespace → Workflow → step → Task) compiled into per-Task context lists.
- Unified `reasoning.effort` hint translated by adapters into their own configuration.

## Explicitly not in v1

- Eager `any`/`quorum` joins (first finisher wins) with cancellation of remaining branches.
- Cross-namespace definition references.
- Gate-level score aggregation.
- External event sources and webhooks as Trigger inputs; only engine-produced events.
- Fork and time travel of runs (edit historical state and branch). Runs are immutable; the
  equivalent is a new WorkflowRun with chosen inputs, linked by `origin.causationRef`.
- Artifact scope (internal versus exported). Encapsulation comes from Workflow output
  contracts; all artifacts remain addressable for audit.
- Blocked phase and a waitingReason enum.
- Workflow/Task pack format with versioning and dependency resolution.
- Web UI, visual editor, and chat-based approval clients beyond the adapter protocol.
- Retention and deletion policy for unreferenced artifact revisions.
- User-defined shared value schemas (a registry beyond the well-known core `$ref`s).

## Open questions to settle before implementation

1. Implementation language and CEL library choice.
2. Canonical serialization for snapshot bytes (JSON with sorted keys is the default proposal).
3. Skill digest computation for non-archive sources such as Git trees.
4. Adapter sandboxing mechanism in cloud mode.
5. Human adapter for local mode: terminal prompt, file drop, or both.
