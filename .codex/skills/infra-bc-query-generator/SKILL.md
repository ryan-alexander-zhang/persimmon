---
name: infra-bc-query-generator
description: "Generates CQRS/read-side query infrastructure for a BC: query DTO/Mapper/Impl and optional app query ports."
---

# Infra BC Query Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- Read-side query implementations under:
  - `{{basePackage}}.infra.query.<bc>.dto`
  - `{{basePackage}}.infra.query.<bc>.mapper`
  - `{{basePackage}}.infra.query.<bc>.impl`
- Supporting application query services (typically under `{{basePackage}}.app.biz.query.*`)

## Inputs Required
- Business context name (`<bc>`), e.g. `biz`
- Query use-case name (what the query returns)
- Output DTO shape (fields + paging)
- Storage source:
  - existing write table(s) or dedicated read model/projection
- Whether an app query port is needed:
  - If app wants an abstraction, generate `{{basePackage}}.app.biz.port.*` (optional by design)

## Outputs
- Query DTO:
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/query/<bc>/dto/<XxxQueryDTO>.java`
- Mapper:
  - `.../infra/query/<bc>/mapper/<XxxQueryMapper>.java`
- Implementation:
  - `.../infra/query/<bc>/impl/<XxxQueryPortImpl>.java` (implements app port when used)
- Optional app port + app query DTO:
  - `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/port/<XxxQueryPort>.java`
  - `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/query/dto/<XxxResultDTO>.java`
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
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/query/package-info.java`
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/query/biz/impl/package-info.java`
- App port guidance:
  - `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/port/package-info.java`

## Tests
- Prefer unit tests for mapping; use `*IT` for SQL correctness.

## Pitfalls
- Reusing infra query DTOs as web DTOs (adapter owns web DTOs).
- Accidentally depending on `domain` aggregates in read models.
