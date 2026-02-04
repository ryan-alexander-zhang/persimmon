---
name: app-port-generator
description: "Generates app-layer ports (out ports/stores/gateways) with clear retry/error semantics and minimal coupling."
---

# App Port Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- `com.ryan.persimmon.app.biz.port.*` and app-common ports

## Inputs Required
- Capability required (read model? store? external call?)
- Error/retry semantics required by callers
- Idempotency contract if used in at-least-once flows

## Outputs
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/.../<Port>.java`
- Optional unit tests for contract helpers (if any)

## Naming & Packaging
- `*Store` for persistence-like ports used by app-common (outbox/inbox/workflow).
- `*Transport` for broker publishers.
- `*Gateway` for external systems (system-first infra implementations).

## Implementation Rules
- Prefer small, capability-focused interfaces.
- Define error semantics:
  - retryable vs non-retryable (when relevant)
  - idempotency expectations
- Avoid leaking infra exceptions across the boundary; translate to app exceptions or result types.

## Reference Implementations
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/outbox/port/OutboxStore.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/event/port/InboxStore.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/workflow/port/WorkflowStore.java`

## Tests
- Unit tests for any default implementations or policies (e.g., retry policies).

## Pitfalls
- Making ports too large (hard to mock, hard to implement).

## Output checklist
- [ ] Interface has clear contract docs (short, pragmatic)
- [ ] Unit tests validate boundary behavior if non-trivial
