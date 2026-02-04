---
name: infra-integration-test-generator
description: "Generates DB integration tests (*IT) that run via Failsafe and validate mapper/store semantics (leases, predicates, retries)."
---

# Infra Integration Test Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- Any infra code relying on DB semantics (SQL, locking, constraints).

## Inputs Required
- Target store/mapper and the behaviors to validate (leases, status transitions)
- DB expectation (local Postgres vs container) consistent with current project setup

## Outputs
- `{{infraModuleDir}}/src/test/java/.../<Xxx>IT.java`

## Naming & Packaging
- Test class name ends with `IT` so it runs under Failsafe in `mvn verify`.

## Implementation Rules
- Name tests `*IT` so they run in `mvn verify`.
- Tests must create/cleanup their own data.
- Prefer asserting semantic behavior (claiming, transitions) over exact SQL.

## Reference Implementations
- `{{infraModuleDir}}/src/test/java/{{basePackagePath}}/infra/event/outbox/OutboxStoreIT.java`
- `{{infraModuleDir}}/src/test/java/{{basePackagePath}}/infra/repository/workflow/WorkflowStoreIT.java`

## Pitfalls
- Writing ITs as `*Test` (won't run in CI if only verify is executed).
