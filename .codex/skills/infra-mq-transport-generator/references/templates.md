# Templates — MQ Transport (Kafka)

## Minimal file tree (typical)
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/event/mq/<XxxTransport>.java`
- `{{startModuleDir}}/src/main/java/{{basePackagePath}}/start/config/bean/<MqWiringConfig>.java` (if new beans/keys)
- `{{startModuleDir}}/src/main/resources/application-local.yaml` (keys)

## Skeleton signatures
- `public final class KafkaXxxTransport implements XxxTransport {`
  - `public void publish(XxxMessage message) { ... }`
  - `}`

## Producer send pattern
- Choose key: `eventId` (distribution) or `aggregateId` (ordering).
- Add required envelope headers:
  - `eventId`, `eventType`, `occurredAt`, `aggregateType`, `aggregateId`
- Block on broker ack when outbox marking depends on it.

## Reference starting point
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/event/mq/KafkaOutboxTransport.java`
