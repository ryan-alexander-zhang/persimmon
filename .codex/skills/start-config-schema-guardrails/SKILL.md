---
name: start-config-schema-guardrails
description: "Defines configuration naming conventions and schema rules (YAML keys) for outbox/inbox/workflow/kafka/scheduler."
---

# Start Config Schema Guardrails

## Goal
Make config keys unambiguous and consistent across producer/consumer concerns.

## Rules
- Prefer separating producer vs consumer keys:
  - `persimmon.kafka.producer.*` vs `persimmon.kafka.consumer.*`
  - avoid `outbox.kafka.topic` for consumer-side configs
- When renaming keys:
  - remove old keys if explicitly requested (no fallback compatibility)
  - update `start` module `application*.yml`

## Output checklist
- [ ] New keys documented in YAML
- [ ] Old keys removed when requested
- [ ] Wiring reads only the new keys

