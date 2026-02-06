---
name: infra-mq-transport-generator
description: "Generates Kafka-based transport implementations in infra (producer/transport), including envelope serialization and topic/key conventions."
---

# Infra MQ Transport Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- `{{basePackage}}.infra.event.mq.*`

## Inputs Required
- Broker type (Kafka)
- Topic name + keying strategy (aggregate ordering vs distribution)
- Timeout / delivery guarantee expectations
- Envelope headers required by consumers

## Outputs
- `.../infra/event/mq/<XxxTransport>.java`
- Wiring in `start` for topic/config keys
- Optional consumer config keys (if part of change)

## Naming & Packaging
- Transport implementations: `<Broker><Purpose>Transport` (e.g., `KafkaOutboxTransport`)
- Keep in `infra.event.mq`

## Implementation Rules
- Use a stable envelope structure (eventId, eventType, aggregate info, occurredAt, payload).
- Partition key choice:
  - use `aggregateId` when ordering per aggregate matters
  - use `eventId` when ordering does not matter (more even distribution)
- Topic naming should distinguish producer vs consumer semantics in config keys.

## Reference Implementations
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/event/mq/KafkaOutboxTransport.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/outbox/model/OutboxHeaders.java`

## Tests
- Unit tests for envelope/header mapping if non-trivial.

## Pitfalls
- Config key naming ambiguity (producer vs consumer).
- Not blocking on send when outbox marking requires broker ack.
