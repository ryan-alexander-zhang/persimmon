---
name: start-yaml-config-generator
description: "Manages start-module YAML keys: create/rename/remove config keys, update wiring to use only new keys, and keep naming unambiguous."
---

# Start YAML Config Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- Any change that requires updating YAML under:
  - `{{startModuleDir}}/src/main/resources/*.yml`
  - `{{startModuleDir}}/src/main/resources/*.yaml`

## Inputs Required
- Which feature the keys belong to:
  - outbox producer, inbox consumer, workflow runner, scheduler job, gateway, etc.
- Key naming rules:
  - producer vs consumer must be unambiguous
  - key rename policy (breaking + remove old keys when requested)
- Default values and environment profiles (if any)

## Outputs
- YAML updates (new keys, removed keys)
- Wiring updates in `start` module to read only the new keys
- Optional tests when wiring logic is complex (extract class + unit test)

## Naming & Packaging
- Keys must follow `start-config-schema-guardrails`.
- Keep config groups coherent, e.g.:
  - `persimmon.kafka.producer.*`
  - `persimmon.kafka.consumer.*`
  - `persimmon.outbox.relay.*`

## Implementation Rules
- If user says “no backward compatibility”, remove old keys and do not implement fallback reads.
- If the change affects multiple modules (adapter consumer + start yaml + wiring), update all in one patch.

## Reference Implementations
- YAML baseline:
  - `{{startModuleDir}}/src/main/resources/application.yaml`
  - `{{startModuleDir}}/src/main/resources/application-local.yaml`
  - `{{startModuleDir}}/src/main/resources/application-example.yaml`
- Guardrails:
  - `.codex/skills/start-config-schema-guardrails/SKILL.md`

## Tests
- Prefer unit tests for extracted policy classes; wiring itself is typically covered by startup smoke tests.

## Pitfalls
- Introducing ambiguous keys like `outbox.kafka.topic` used by consumer.
- Leaving dead/unused keys in YAML after renames.
