---
name: start-config-schema-guardrails
description: "Defines configuration naming conventions and schema rules (YAML keys) for outbox/inbox/workflow/kafka/scheduler."
---

# Start Config Schema Guardrails

Templates: See `references/templates.md`.

## Goal
Make config keys unambiguous and consistent across producer/consumer concerns.

## Inputs Required
- Which side the config is for: producer/outbox vs consumer/inbox vs workflow runner
- Whether key rename is allowed to be breaking (this repo often prefers breaking + removal when asked)

## Rules
- Prefer separating producer vs consumer keys *within the feature namespace*.
  - Current scaffold baseline (see `application-local.yaml`):
    - shared topic: `persimmon.outbox.topic`
    - producer config: `persimmon.outbox.kafka.producer.*`
    - consumer config: `persimmon.outbox.kafka.consumer.*`
  - If topic ambiguity becomes a problem, prefer splitting into:
    - `persimmon.outbox.producer.topic`
    - `persimmon.outbox.consumer.topic`
  - Avoid ambiguous names like `outbox.kafka.topic` when the value is used by a consumer.
- When renaming keys:
  - remove old keys if explicitly requested (no fallback compatibility)
  - update `start` module `application*.yml`

## Reference Implementations
- `{{startModuleDir}}/src/main/resources/application.yaml`
- `{{startModuleDir}}/src/main/resources/application-local.yaml`

## Output checklist
- [ ] New keys documented in YAML
- [ ] Old keys removed when requested
- [ ] Wiring reads only the new keys
