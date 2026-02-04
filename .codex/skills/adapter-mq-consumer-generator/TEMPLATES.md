# Templates — MQ Consumer (Kafka)

## Consumer skeleton pattern
- `@Component`
- `@KafkaListener(topics=..., groupId=..., concurrency=...)`
- Extract envelope headers, build `ConsumedEvent`, call `EventDispatcher.dispatch(event)`

## Reference starting point
- `persimmon-scaffold/persimmon-scaffold-adapter/src/main/java/com/ryan/persimmon/adapter/mq/system/consumer/OutboxEventKafkaConsumer.java`

