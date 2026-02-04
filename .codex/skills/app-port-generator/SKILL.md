---
name: app-port-generator
description: "Generates app-layer ports (out ports/stores/gateways) with clear retry/error semantics and minimal coupling."
---

# App Port Generator

## Use for
- `com.ryan.persimmon.app.biz.port.*` and app-common ports

## Rules
- Prefer small, capability-focused interfaces.
- Define error semantics:
  - retryable vs non-retryable (when relevant)
  - idempotency expectations
- Avoid leaking infra exceptions across the boundary; translate to app exceptions or result types.

## Output checklist
- [ ] Interface has clear contract docs (short, pragmatic)
- [ ] Unit tests validate boundary behavior if non-trivial

