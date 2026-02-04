---
name: adapter-mq-consumer-generator
description: "Generates MQ consumers in adapter layer that use inbox idempotency and dispatch to app handlers safely."
---

# Adapter MQ Consumer Generator

## Use for
- `com.ryan.persimmon.adapter.mq.*`

## Rules
- Consumer should:
  - deserialize envelope
  - call `EventDispatcher.dispatch(...)`
  - rely on inbox for idempotency
- Missing handler must not poison processing; ensure dispatcher marks inbox `DEAD`.

