# Templates — App Port

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/port/out/<XxxGateway>.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/port/<XxxQueryPort>.java` (optional)
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/<feature>/port/<XxxStore>.java`

## Skeleton signatures
Gateway (business capability, domain/app types only):
- `public interface XxxGateway {`
  - `XxxResult doSomething(XxxInput input);`
  - `}`

Store (technical persistence for app-common patterns):
- `public interface XxxStore {`
  - `void append(List<XxxMessage> messages);`
  - `List<XxxMessage> claimNextBatch(int batchSize, Instant now);`
  - `void markSent(UUID id, Instant sentAt);`
  - `void markFailed(UUID id, Instant now, Instant nextRetryAt, String lastError);`
  - `void markDead(UUID id, Instant now, String lastError);`
  - `}`

## Reference ports
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/outbox/port/OutboxStore.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/event/port/InboxStore.java`

