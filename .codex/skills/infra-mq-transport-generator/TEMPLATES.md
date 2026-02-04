# Templates — MQ Transport (Kafka)

## Producer send pattern
- Choose key: `eventId` (distribution) or `aggregateId` (ordering).
- Add required envelope headers:
  - `eventId`, `eventType`, `occurredAt`, `aggregateType`, `aggregateId`
- Block on broker ack when outbox marking depends on it.

## Reference starting point
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/event/mq/KafkaOutboxTransport.java`

