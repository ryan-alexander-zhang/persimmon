# Templates — Start Config Schema Guardrails

This is a guardrail skill. It does not generate code artifacts.

## Key naming template (current scaffold baseline)
- Shared topic: `persimmon.outbox.topic`
- Producer: `persimmon.outbox.kafka.producer.*`
- Consumer: `persimmon.outbox.kafka.consumer.*`
- Outbox relay: `persimmon.outbox.relay.*`
- Workflow retry/runner: `persimmon.workflow.retry.*`, `persimmon.workflow.runner.*`

## Rename checklist
1) Update `application-local.yaml` (and example if needed)
2) Update wiring (`start/config/bean/**`)
3) Update adapter annotations placeholders (e.g., `@KafkaListener`) if they use the key
4) Remove old keys when requested (no fallback)
