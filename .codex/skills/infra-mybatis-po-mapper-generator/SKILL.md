---
name: infra-mybatis-po-mapper-generator
description: "Generates MyBatis/MyBatis-Plus PO + Mapper patterns for infra, choosing BaseMapper vs SQL mapping with clear tradeoffs."
---

# Infra MyBatis PO/Mapper Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- PO under `{{basePackage}}.infra.**.po`
- Mapper under `{{basePackage}}.infra.**.mapper`

## Inputs Required
- Table name + columns + constraints (from Flyway migration)
- Access pattern: pure CRUD vs claim/lease/conditional updates
- MyBatis vs MyBatis-Plus choice (see rules)

## Outputs
- `.../infra/.../po/<XxxPO>.java`
- `.../infra/.../mapper/<XxxMapper>.java`
- Optional IT when using locking or conditional updates

## Naming & Packaging
- PO: `<TableName>PO` (or `<Context><Entity>PO`)
- Mapper: `<TableName>Mapper`
- Keep under BC-first `infra.repository.<bc>.*` or feature packages like `infra.event.outbox.*`.

## Implementation Rules
- Prefer MyBatis-Plus `BaseMapper<T>` when CRUD is standard and constraints are simple.
- Use explicit SQL (annotations/XML) when:
  - conditional update/claim semantics are needed (lock owner predicates)
  - `FOR UPDATE SKIP LOCKED` is required
  - multi-step atomic transitions must be encoded precisely
- Keep PO focused on persistence; convert to domain/app types at boundaries.

## Reference Implementations
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/event/outbox/po/OutboxEventPO.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/event/outbox/mapper/OutboxEventMapper.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/workflow/mapper/WorkflowStepMapper.java`

## Tests
- Add `*IT` for any mapper using `FOR UPDATE SKIP LOCKED` or status transitions.

## Pitfalls
- Using BaseMapper for claim/update flows that need precise predicates (race conditions).
- PO field names mismatching SQL columns (migration drift).

## Output checklist
- [ ] Mapper methods include necessary predicates (status/lock/lease)
- [ ] PO fields match migration columns exactly
- [ ] Integration test for critical mappers if DB semantics involved
