---
name: domain-model-generator
description: "Generates domain model types (Aggregate/Entity/VO/Enum/Exception) without Lombok and with minimal API surface."
---

# Domain Model Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- New aggregates/entities/value objects/enums under `persimmon-scaffold-domain`
- Domain exceptions and domain-level constants

## Inputs Required
- Target package under `{{basePackage}}.domain.biz.*` (BC-first) or `{{basePackage}}.domain.common.*` (cross-cutting)
- Type kind: `Aggregate/Entity/VO/Enum/Exception`
- Public API expectations (which getters are truly needed)
- Invariant rules (validation, allowed transitions)

## Outputs
- `{{domainModuleDir}}/src/main/java/{{basePackagePath}}/.../<Type>.java`
- Optional: `{{domainModuleDir}}/src/test/java/{{basePackagePath}}/.../<Type>Test.java`

## Naming & Packaging
- Business semantics go under `{{basePackage}}.domain.biz.<context>.*`
- Cross-cutting goes under `{{basePackage}}.domain.common.*`
- Prefer `*Id` / `*Type` / `*Status` for identity/type/status.

## Implementation Rules
- No Lombok annotations.
- Expose only necessary getters; prefer immutability where reasonable.
- Validate invariants in constructors/factories.
- Keep domain types framework-free.

## Reference Implementations
- `{{domainModuleDir}}/src/main/java/{{basePackagePath}}/domain/common/workflow/WorkflowInstance.java`
- `{{domainModuleDir}}/src/main/java/{{basePackagePath}}/domain/common/workflow/WorkflowStepStatus.java`
- `{{domainModuleDir}}/src/main/java/{{basePackagePath}}/domain/common/event/DomainEvent.java`

## Tests
- Add unit tests when invariants or parsing logic exist; keep tests framework-free.

## Pitfalls
- Adding convenience methods that leak policy (keep API minimal).
- Putting business rules in `domain.common`.

## Output checklist
- [ ] Located under `{{basePackage}}.domain.**`
- [ ] No Lombok
- [ ] Minimal methods, meaningful names
- [ ] Unit tests for invariants when non-trivial
