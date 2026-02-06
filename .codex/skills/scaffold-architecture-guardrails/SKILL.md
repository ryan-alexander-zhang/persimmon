---
name: scaffold-architecture-guardrails
description: "Global guardrails for Persimmon Scaffold: layers, dependencies, naming, migrations, testing, and concurrency safety for outbox/inbox/workflow."
---

# Architecture Guardrails (Global)

Templates: See `references/templates.md`.

## Layers & dependencies (conceptual)
- `domain`: pure domain model. No frameworks. **No Lombok**. Minimal public API.
- `app`: orchestration/use-cases, ports, app-common components. May use `spring-tx` annotations (only).
- `infra`: implementations (DB/MyBatis/Kafka/clients). May depend on `app` (allowed in this scaffold).
- `adapter`: delivery mechanisms (web, scheduler, mq consumers). Calls app services/ports only.
- `start`: wiring/configuration, YAML keys, Bean configs, component scanning.

## Naming conventions
- Prefer explicit names:
  - `*Repository`: domain persistence ports (domain-facing, business semantics)
  - `*Store`: app-common persistence ports for technical tables (outbox/inbox/workflow)
  - `*Transport`: message transport/publisher implementations (Kafka, etc.)
  - `*Job`: scheduler entrypoint (adapter)
- Event identifiers:
  - `eventId`: unique per produced event (UUID/ULID).
  - `aggregateId`: domain aggregate identity; not necessarily unique per event.
  - `eventType`: stable string identifier; do not use Java class name as the contract.

## Status machines (must be consistent)
- Outbox: `READY → SENDING → SENT` and terminal `DEAD` (with attempts + next retry).
- Inbox: `PROCESSING → PROCESSED` and terminal `DEAD`, retry `FAILED` (reclaimable).
- Workflow: keep status transitions atomic and guarded (status predicates).

## Concurrency safety (must)
- Any `markSent/markFailed/markDead` MUST include **lock owner + status/lease predicates** to prevent late updates overwriting newer state.
- Prefer **claim-then-work** flows via `tryStart/tryClaim` or conditional updates.
- If handler is missing, do not leave inbox rows stuck in `PROCESSING`; mark as `DEAD`.

## Flyway migrations
- No foreign keys.
- Include required unique constraints and check constraints.
- Backfill safely when adding non-null columns.

## Tests
- Unit tests: fast, no DB.
- Integration tests: DB involved; use `*IT` and Failsafe.

## Output checklist (every change)
- [ ] Correct module + package (matches `package-info.java`)
- [ ] No Lombok in `domain`
- [ ] DB changes have Flyway migration
- [ ] Outbox/Inbox/Workflow updates guarded by predicates
- [ ] Unit tests for logic, IT for store/mappers when needed
