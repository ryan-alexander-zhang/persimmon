---
name: start-wiring-config-generator
description: "Generates start-module wiring configs (Bean configs/Scan configs) and extracts complex logic into dedicated testable classes."
---

# Start Wiring Config Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- `{{basePackage}}.start.config.bean.*`

## Inputs Required
- Which port(s) to bind to which implementation(s)
- Required config keys + defaults
- Whether complex logic should be extracted to a dedicated class

## Outputs
- `.../start/config/bean/<XxxWiringConfig>.java`
- Extracted policy class(es) under `.../start/config/bean/...`
- Unit tests for extracted policy
- YAML updates under `persimmon-scaffold-start`

## Naming & Packaging
- Wiring configs belong in `start.config.bean`
- Keep feature-specific wiring separated (outbox/workflow/mq/etc.)

## Implementation Rules
- Keep `@Configuration` thin.
- Extract complex policies into dedicated classes (testable with unit tests).
- YAML keys must be aligned with `start-config-schema-guardrails`.

## Reference Implementations
- `{{startModuleDir}}/src/main/java/{{basePackagePath}}/start/config/bean/OutboxWiringConfig.java`
- `{{startModuleDir}}/src/main/java/{{basePackagePath}}/start/config/bean/WorkflowWiringConfig.java`

## Pitfalls
- Embedding 50+ lines of logic inside anonymous beans (hard to test).
