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
- Target package under `com.ryan.persimmon.domain.biz.*` (BC-first) or `com.ryan.persimmon.domain.common.*` (cross-cutting)
- Type kind: `Aggregate/Entity/VO/Enum/Exception`
- Public API expectations (which getters are truly needed)
- Invariant rules (validation, allowed transitions)

## Outputs
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/.../<Type>.java`
- Optional: `persimmon-scaffold/persimmon-scaffold-domain/src/test/java/.../<Type>Test.java`

## Naming & Packaging
- Business semantics go under `com.ryan.persimmon.domain.biz.<context>.*`
- Cross-cutting goes under `com.ryan.persimmon.domain.common.*`
- Prefer `*Id` / `*Type` / `*Status` for identity/type/status.

## Implementation Rules
- No Lombok annotations.
- Expose only necessary getters; prefer immutability where reasonable.
- Validate invariants in constructors/factories.
- Keep domain types framework-free.

## Reference Implementations
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/common/workflow/WorkflowInstance.java`
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/common/workflow/WorkflowStepStatus.java`
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/common/event/DomainEvent.java`

## Tests
- Add unit tests when invariants or parsing logic exist; keep tests framework-free.

## Pitfalls
- Adding convenience methods that leak policy (keep API minimal).
- Putting business rules in `domain.common`.

## Output checklist
- [ ] Located under `com.ryan.persimmon.domain.**`
- [ ] No Lombok
- [ ] Minimal methods, meaningful names
- [ ] Unit tests for invariants when non-trivial
