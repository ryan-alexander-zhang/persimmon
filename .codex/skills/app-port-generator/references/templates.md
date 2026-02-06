# Templates — App Port

## Minimal file tree (typical)
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/port/out/<XxxGateway>.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/port/<XxxQueryPort>.java` (optional)
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/<feature>/port/<XxxStore>.java`

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
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/outbox/port/OutboxStore.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/event/port/InboxStore.java`
