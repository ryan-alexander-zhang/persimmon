# Templates — Infra PO/Mapper (MyBatis / MyBatis-Plus)

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/<feature>/po/<XxxPO>.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/<feature>/mapper/<XxxMapper>.java`

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
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/event/outbox/mapper/OutboxEventMapper.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/workflow/mapper/WorkflowStepMapper.java`
