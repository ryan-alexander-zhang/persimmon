# Templates — Infra PO/Mapper (MyBatis / MyBatis-Plus)

## PO skeleton (fields mirror migration)
Use `OutboxEventPO` / `WorkflowStepPO` as reference; keep PO as persistence-only.

## Mapper skeleton (conditional updates)
Prefer explicit SQL for claim/update flows.

Checklist for any `markXxx(...)`:
- `where id = ? and status = ?`
- if leased: `and locked_by = ? and locked_until >= now`

## Reference starting points
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/event/outbox/mapper/OutboxEventMapper.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/workflow/mapper/WorkflowStepMapper.java`

