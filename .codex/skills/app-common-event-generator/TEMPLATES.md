# Templates — App Common Event

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/event/model/ConsumedEvent.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/event/port/EventHandler.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/event/service/DefaultEventDispatcher.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/test/java/com/ryan/persimmon/app/common/event/service/DefaultEventDispatcherTest.java`
- Biz handler:
  - `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/event/handler/<XxxHandler>.java`

## Handler pattern
- `eventType()` returns a stable string
- `handle(ConsumedEvent)` throws only runtime exceptions (use `EventHandlingException` for retry classification)

## Skeleton signatures
- `public final class XxxEventHandler implements EventHandler {`
  - `public String eventType() { return "..."; }`
  - `public void handle(ConsumedEvent event) { ... }`
  - `}`

## Dispatcher pattern
- enforce inbox idempotency via `InboxStore.tryStart(...)`
- if no handler: mark inbox `DEAD` with `NO_HANDLER:<eventType>`

## Reference starting points
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/event/service/DefaultEventDispatcher.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/event/exception/EventHandlingException.java`
