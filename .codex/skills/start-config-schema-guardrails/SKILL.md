---
name: start-config-schema-guardrails
description: "Defines configuration naming conventions and schema rules (YAML keys) for outbox/inbox/workflow/kafka/scheduler."
---

# Start Config Schema Guardrails

## Goal
Make config keys unambiguous and consistent across producer/consumer concerns.

## Inputs Required
- Which side the config is for: producer/outbox vs consumer/inbox vs workflow runner
- Whether key rename is allowed to be breaking (this repo often prefers breaking + removal when asked)

## Rules
- Prefer separating producer vs consumer keys:
  - `persimmon.kafka.producer.*` vs `persimmon.kafka.consumer.*`
  - avoid `outbox.kafka.topic` for consumer-side configs
- When renaming keys:
  - remove old keys if explicitly requested (no fallback compatibility)
  - update `start` module `application*.yml`

## Reference Implementations
- `persimmon-scaffold/persimmon-scaffold-start/src/main/resources/application.yaml`

## Output checklist
- [ ] New keys documented in YAML
- [ ] Old keys removed when requested
- [ ] Wiring reads only the new keys
