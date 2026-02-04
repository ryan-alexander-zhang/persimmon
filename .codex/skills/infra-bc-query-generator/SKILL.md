---
name: infra-bc-query-generator
description: "Generates CQRS/read-side query infrastructure for a BC: query DTO/Mapper/Impl and optional app query ports."
---

# Infra BC Query Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- Read-side query implementations under:
  - `com.ryan.persimmon.infra.query.<bc>.dto`
  - `com.ryan.persimmon.infra.query.<bc>.mapper`
  - `com.ryan.persimmon.infra.query.<bc>.impl`
- Supporting application query services (typically under `com.ryan.persimmon.app.biz.query.*`)

## Inputs Required
- Business context name (`<bc>`), e.g. `biz`
- Query use-case name (what the query returns)
- Output DTO shape (fields + paging)
- Storage source:
  - existing write table(s) or dedicated read model/projection
- Whether an app query port is needed:
  - If app wants an abstraction, generate `com.ryan.persimmon.app.biz.port.*` (optional by design)

## Outputs
- Query DTO:
  - `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/query/<bc>/dto/<XxxQueryDTO>.java`
- Mapper:
  - `.../infra/query/<bc>/mapper/<XxxQueryMapper>.java`
- Implementation:
  - `.../infra/query/<bc>/impl/<XxxQueryPortImpl>.java` (implements app port when used)
- Optional app port + app query DTO:
  - `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/port/<XxxQueryPort>.java`
  - `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/query/dto/<XxxResultDTO>.java`
- Tests:
  - Unit tests for mapping logic
  - `*IT` if query SQL is non-trivial or relies on indexes/constraints

## Naming & Packaging
- Query DTOs are infra-only; do not expose to domain.
- App query DTOs (if any) should be app-owned and stable.
- Prefer `*QueryMapper` and `*QueryPortImpl`.

## Implementation Rules
- Query paths should not load full aggregates; return lightweight DTOs.
- Keep SQL/persistence details in query mapper.
- If app defines a query port, infra implementation must only depend on app types (DTOs/ports), not adapter types.

## Reference Implementations
- Package rules:
  - `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/query/package-info.java`
  - `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/query/biz/impl/package-info.java`
- App port guidance:
  - `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/port/package-info.java`

## Tests
- Prefer unit tests for mapping; use `*IT` for SQL correctness.

## Pitfalls
- Reusing infra query DTOs as web DTOs (adapter owns web DTOs).
- Accidentally depending on `domain` aggregates in read models.

