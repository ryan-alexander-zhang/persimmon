# Templates — MQ Consumer (Kafka)

## Minimal file tree (typical)
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/mq/system/consumer/<XxxConsumer>.java`
- `{{startModuleDir}}/src/main/resources/application-local.yaml` (topic/group/concurrency keys)

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
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/mq/system/consumer/OutboxEventKafkaConsumer.java`
