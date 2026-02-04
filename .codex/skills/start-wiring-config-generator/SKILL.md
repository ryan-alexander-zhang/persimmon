---
name: start-wiring-config-generator
description: "Generates start-module wiring configs (Bean configs/Scan configs) and extracts complex logic into dedicated testable classes."
---

# Start Wiring Config Generator

## Use for
- `com.ryan.persimmon.start.config.bean.*`

## Rules
- Keep `@Configuration` thin.
- Extract complex policies into dedicated classes (testable with unit tests).
- YAML keys must be aligned with `start-config-schema-guardrails`.

