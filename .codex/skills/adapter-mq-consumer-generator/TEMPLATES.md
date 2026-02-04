# Templates — MQ Consumer (Kafka)

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-adapter/src/main/java/com/ryan/persimmon/adapter/mq/system/consumer/<XxxConsumer>.java`
- `persimmon-scaffold/persimmon-scaffold-start/src/main/resources/application-local.yaml` (topic/group/concurrency keys)

## Consumer skeleton pattern
- `@Component`
- `@KafkaListener(topics=..., groupId=..., concurrency=...)`
- Extract envelope headers, build `ConsumedEvent`, call `EventDispatcher.dispatch(event)`

## Skeleton signature
- `@Component`
  - `public final class XxxKafkaConsumer {`
    - `@KafkaListener(...)`
    - `public void onMessage(ConsumerRecord<String, String> record) { ... }`
    - `}`

## Reference starting point
- `persimmon-scaffold/persimmon-scaffold-adapter/src/main/java/com/ryan/persimmon/adapter/mq/system/consumer/OutboxEventKafkaConsumer.java`
