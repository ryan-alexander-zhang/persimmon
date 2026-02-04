---
name: infra-flyway-migration-generator
description: "Generates Flyway SQL migrations consistent with scaffold rules (no FKs), constraints, and safe backfills."
---

# Flyway Migration Generator

## Use for
- `persimmon-scaffold-infra/src/main/resources/db/migration/Vx__*.sql`

## Rules
- No foreign keys.
- Prefer `unique` + `check` constraints for invariants.
- Backfill data when adding new NOT NULL columns; keep migration rerunnable where possible.

## Output checklist
- [ ] No FK
- [ ] Proper indexes for claim queries (status/next_retry_at/locked_until)
- [ ] Check constraints for status enums

