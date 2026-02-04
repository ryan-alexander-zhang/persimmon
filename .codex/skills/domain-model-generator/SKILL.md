---
name: domain-model-generator
description: "Generates domain model types (Aggregate/Entity/VO/Enum/Exception) without Lombok and with minimal API surface."
---

# Domain Model Generator

## Use for
- New aggregates/entities/value objects/enums under `persimmon-scaffold-domain`
- Domain exceptions and domain-level constants

## Rules
- No Lombok annotations.
- Expose only necessary getters; prefer immutability where reasonable.
- Validate invariants in constructors/factories.
- Keep domain types framework-free.

## Output checklist
- [ ] Located under `com.ryan.persimmon.domain.**`
- [ ] No Lombok
- [ ] Minimal methods, meaningful names
- [ ] Unit tests for invariants when non-trivial

