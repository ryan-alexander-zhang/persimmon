# Deferred and Out of Scope

Items known, discussed, and intentionally not in the core model of this phase.

## Next phase: SDLC domain pack

- The 14 domain artifact kinds under `engineering.persimmon.ai/v1` and their content schemas.
- Entity indexing from `x-persimmon-entity` annotations.
- RelationTypes `implements-v1`, `verifies-v1` and the traceability validator.
- The five example Workflows, twenty Tasks, four Executors, five Validators, four Gates from
  `examples.yaml`, packaged as an installable example set rather than built in.
- Rollout semantics: DeploymentPlan, operationKey, fencingToken, rollback branches.

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
4. Whether `script` and `human` actions accept `context`, or only `agent`.
5. Adapter sandboxing mechanism in cloud mode.
6. Human adapter for local mode: terminal prompt, file drop, or both.
