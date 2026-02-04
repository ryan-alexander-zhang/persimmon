# Templates — Architecture Guardrails

This is a guardrail skill. It does not generate code artifacts.

## Pre-flight checklist (apply before editing)
- Target module is correct (domain/app/infra/adapter/start)
- Dependencies are allowed for that module
- Naming matches conventions (`Repository` vs `Store`, `Transport`, `Job`)
- Transaction boundary rules respected (app: `spring-tx` only)
- DB changes have Flyway migrations (no foreign keys)

## Concurrency checklist (outbox/inbox/workflow)
- Claim query uses `FOR UPDATE SKIP LOCKED` when multiple workers exist
- Transition updates include:
  - status predicate
  - lock owner predicate when locked
  - lease predicate when locked

