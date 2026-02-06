# Templates — App Common Workflow

## Minimal file tree (typical)
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/workflow/port/WorkflowStepHandler.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/workflow/model/StepResult.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/workflow/service/WorkflowTaskProcessorImpl.java`
- Domain status enums:
  - `{{domainModuleDir}}/src/main/java/{{basePackagePath}}/domain/common/workflow/WorkflowStepStatus.java`

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
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/workflow/service/WorkflowTaskProcessorImpl.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/workflow/store/MybatisWorkflowStore.java`
