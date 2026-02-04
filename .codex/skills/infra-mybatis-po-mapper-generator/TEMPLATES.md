# Templates — Infra PO/Mapper (MyBatis / MyBatis-Plus)

## Minimal file tree (typical)
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/<feature>/po/<XxxPO>.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/<feature>/mapper/<XxxMapper>.java`

## PO skeleton (fields mirror migration)
Use `OutboxEventPO` / `WorkflowStepPO` as reference; keep PO as persistence-only.

## Mapper skeleton (conditional updates)
Prefer explicit SQL for claim/update flows.

## Skeleton signatures
- `@Mapper`
  - `public interface XxxMapper extends BaseMapper<XxxPO> {`
    - `@Select("... for update skip locked")`
    - `List<XxxPO> lockNextBatch(...);`
    - `@Update("update ... where id=? and status=? and locked_by=? ...")`
    - `int markSomething(...);`
    - `}`

Checklist for any `markXxx(...)`:
- `where id = ? and status = ?`
- if leased: `and locked_by = ? and locked_until >= now`

## Reference starting points
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/event/outbox/mapper/OutboxEventMapper.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/workflow/mapper/WorkflowStepMapper.java`
