# Templates — App Common Workflow

## Step handler pattern
- Identify by `(workflowType, stepType)`
- Idempotent execution
- Return a `StepResult` that describes:
  - DONE / RETRY / WAITING / DEAD behavior

## Store interaction pattern
- Insert all steps up-front as `PENDING` and activate sequentially
- Claim work via `FOR UPDATE SKIP LOCKED` + `markRunning` (status + lock owner predicates)

## Reference starting points
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/workflow/service/WorkflowTaskProcessorImpl.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/workflow/store/MybatisWorkflowStore.java`

