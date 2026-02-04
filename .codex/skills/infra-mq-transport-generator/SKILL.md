---
name: infra-mq-transport-generator
description: "Generates Kafka-based transport implementations in infra (producer/transport), including envelope serialization and topic/key conventions."
---

# Infra MQ Transport Generator

## Use for
- `com.ryan.persimmon.infra.event.mq.*`

## Rules
- Use a stable envelope structure (eventId, eventType, aggregate info, occurredAt, payload).
- Partition key choice:
  - use `aggregateId` when ordering per aggregate matters
  - use `eventId` when ordering does not matter (more even distribution)
- Topic naming should distinguish producer vs consumer semantics in config keys.

