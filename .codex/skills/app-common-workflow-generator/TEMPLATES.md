# Templates — App Common Workflow

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/workflow/port/WorkflowStepHandler.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/workflow/model/StepResult.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/workflow/service/WorkflowTaskProcessorImpl.java`
- Domain status enums:
  - `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/common/workflow/WorkflowStepStatus.java`

## Step handler pattern
- Identify by `(workflowType, stepType)`
- Idempotent execution
- Return a `StepResult` that describes:
  - DONE / RETRY / WAITING / DEAD behavior

## Skeleton signatures
- `public final class XxxWorkflowStepHandler implements WorkflowStepHandler {`
  - `public String workflowType() { return "..."; }`
  - `public String stepType() { return "..."; }`
  - `public StepResult execute(WorkflowInstance instance, WorkflowTaskType taskType) { ... }`
  - `}`

## Store interaction pattern
- Insert all steps up-front as `PENDING` and activate sequentially
- Claim work via `FOR UPDATE SKIP LOCKED` + `markRunning` (status + lock owner predicates)

## Reference starting points
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/workflow/service/WorkflowTaskProcessorImpl.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/workflow/store/MybatisWorkflowStore.java`
