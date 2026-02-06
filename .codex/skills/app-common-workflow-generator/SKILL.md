---
name: app-common-workflow-generator
description: "Generates/extends the workflow engine in app-common: step handlers, retry policies, processors, and unit tests."
---

# App Common Workflow Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- `{{basePackage}}.app.common.workflow.*`

## Inputs Required
- `workflowType` (stable string)
- Step list (linear): ordered `stepSeq` + `stepType`
- Retry policy requirements (max attempts, backoff)
- WAITING semantics (deadline + wake-up event type) if used

## Outputs
- App/common workflow:
  - step handler(s) implementing `WorkflowStepHandler`
  - optional retry policy implementation + unit tests
  - services that start/tick/signal workflows

## Naming & Packaging
- Handler names: `<WorkflowType><StepType>Handler` or `<StepType>WorkflowStepHandler`
- Keep engine types in `app/common/workflow/**`; business-specific in `app/biz/**` if needed.

## Implementation Rules
- Linear execution (responsibility chain) unless explicitly requested otherwise.
- Steps must be idempotent (replay safe).
- Retry policy must be configurable and unit-tested.
- State transitions must be guarded (status predicates at store boundary).

## Reference Implementations
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/workflow/service/WorkflowRunner.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/workflow/service/WorkflowTaskProcessorImpl.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/workflow/store/MybatisWorkflowStore.java`
- `{{domainModuleDir}}/src/main/java/{{basePackagePath}}/domain/common/workflow/WorkflowStepStatus.java`

## Tests
- Unit tests for definition/registry/step results/policies.
- Integration tests for store lease + state transitions.

## Pitfalls
- Forgetting to insert steps up front (breaks recovery after restart).
- Updating step status without lock owner predicates.
