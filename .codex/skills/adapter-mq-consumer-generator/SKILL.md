---
name: adapter-mq-consumer-generator
description: "Generates MQ consumers in adapter layer that use inbox idempotency and dispatch to app handlers safely."
---

# Adapter MQ Consumer Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- `com.ryan.persimmon.adapter.mq.*`

## Inputs Required
- Topic + groupId + concurrency requirements
- Envelope format (headers/payload)
- Ack/retry strategy (framework defaults vs explicit)

## Outputs
- `.../adapter/mq/system/consumer/<XxxConsumer>.java` (system) or `.../adapter/mq/biz/consumer` (BC)
- `start` YAML keys for topics/groups/concurrency

## Naming & Packaging
- System consumers go under `adapter.mq.system.consumer`
- Keep consumer thin; delegate to app dispatcher

## Implementation Rules
- Consumer should:
  - deserialize envelope
  - call `EventDispatcher.dispatch(...)`
  - rely on inbox for idempotency
- Missing handler must not poison processing; ensure dispatcher marks inbox `DEAD`.

## Reference Implementations
- `persimmon-scaffold/persimmon-scaffold-adapter/src/main/java/com/ryan/persimmon/adapter/mq/system/consumer/OutboxEventKafkaConsumer.java`

## Pitfalls
- Swallowing exceptions that should trigger framework retry (depends on retry strategy).
