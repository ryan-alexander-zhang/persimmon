---
name: app-common-event-generator
description: "Generates/extends app-common event system (outbox/inbox, dispatcher, handlers, retry policy) with concurrency and idempotency rules."
---

# App Common Event Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- `{{basePackage}}.app.common.event.*`
- Adding event handlers under `{{basePackage}}.app.biz.event.handler`

## Inputs Required
- `eventType` (stable string contract)
- Consumer name / group semantics (who owns idempotency)
- Retry semantics: which exceptions are retryable vs terminal

## Outputs
- App/common:
  - event model / ports / dispatcher changes (if extending core)
  - unit tests for dispatch behavior
- Biz handlers:
  - `.../app/biz/event/handler/<XxxHandler>.java`

## Naming & Packaging
- Event handler names: `<EventType>Handler` or `<BusinessAction>On<EventType>Handler`
- Keep core framework-free in app/common; wiring in `start`.

## Implementation Rules (Must Support)
- Stable `eventType` strings (contract).
- Inbox idempotency: `tryStart` claim, then handle, then mark.
- Missing handler: mark inbox `DEAD`, do not leave stuck rows.
- Retry semantics via `EventHandlingException` (retryable vs non-retryable).

## Reference Implementations
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/event/service/DefaultEventDispatcher.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/event/inbox/store/MybatisInboxStore.java`
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/mq/system/consumer/OutboxEventKafkaConsumer.java`

## Tests
- Unit tests for dispatcher behavior, handler selection, exception mapping.

## Pitfalls
- Creating inbox rows before verifying handler exists (causes stuck PROCESSING).
- Throwing `Exception` from handler interfaces (Sonar + unclear retry semantics).
