---
name: app-common-event-generator
description: "Generates/extends app-common event system (outbox/inbox, dispatcher, handlers, retry policy) with concurrency and idempotency rules."
---

# App Common Event Generator

## Use for
- `com.ryan.persimmon.app.common.event.*`
- Adding event handlers under `com.ryan.persimmon.app.biz.event.handler`

## Must support
- Stable `eventType` strings (contract).
- Inbox idempotency: `tryStart` claim, then handle, then mark.
- Missing handler: mark inbox `DEAD`, do not leave stuck rows.
- Retry semantics via `EventHandlingException` (retryable vs non-retryable).

## Tests
- Unit tests for dispatcher behavior, handler selection, exception mapping.

