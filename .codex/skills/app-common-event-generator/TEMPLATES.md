# Templates — App Common Event

## Handler pattern
- `eventType()` returns a stable string
- `handle(ConsumedEvent)` throws only runtime exceptions (use `EventHandlingException` for retry classification)

## Dispatcher pattern
- enforce inbox idempotency via `InboxStore.tryStart(...)`
- if no handler: mark inbox `DEAD` with `NO_HANDLER:<eventType>`

## Reference starting points
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/event/service/DefaultEventDispatcher.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/event/exception/EventHandlingException.java`

