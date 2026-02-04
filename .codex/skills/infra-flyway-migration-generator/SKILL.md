---
name: infra-flyway-migration-generator
description: "Generates Flyway SQL migrations consistent with scaffold rules (no FKs), constraints, and safe backfills."
---

# Flyway Migration Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- `{{infraModuleDir}}/src/main/resources/db/migration/Vx__*.sql`

## Inputs Required
- Target table(s) + columns + constraints
- Index requirements (claim queries, unique keys)
- Backfill plan when adding NOT NULL columns

## Outputs
- A new migration file with the next version number:
  - `{{infraModuleDir}}/src/main/resources/db/migration/Vx__<desc>.sql`

## Naming & Packaging
- Prefer descriptive names: `V1.0.X__outbox_event.sql`, `V1.0.X__workflow_instance_step.sql`

## Implementation Rules
- No foreign keys.
- Prefer `unique` + `check` constraints for invariants.
- Backfill data when adding new NOT NULL columns; keep migration rerunnable where possible.

## Reference Implementations
- `{{infraModuleDir}}/src/main/resources/db/migration/V1.0.5__inbox_event_processing.sql`
- `{{infraModuleDir}}/src/main/resources/db/migration/V1.0.4__workflow_instance_step.sql`

## Tests
- Add/adjust `*IT` if migration changes affect claim/update semantics.

## Pitfalls
- Introducing FK constraints (forbidden).
- Forgetting indexes for status/time-based scans.

## Output checklist
- [ ] No FK
- [ ] Proper indexes for claim queries (status/next_retry_at/locked_until)
- [ ] Check constraints for status enums
