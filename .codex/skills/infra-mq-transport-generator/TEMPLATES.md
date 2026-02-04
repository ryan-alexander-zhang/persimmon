# Templates — MQ Transport (Kafka)

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/event/mq/<XxxTransport>.java`
- `persimmon-scaffold/persimmon-scaffold-start/src/main/java/com/ryan/persimmon/start/config/bean/<MqWiringConfig>.java` (if new beans/keys)
- `persimmon-scaffold/persimmon-scaffold-start/src/main/resources/application-local.yaml` (keys)

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
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/event/mq/KafkaOutboxTransport.java`
