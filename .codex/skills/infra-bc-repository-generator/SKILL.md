---
name: infra-bc-repository-generator
description: "Generates BC-first repository implementation in infra: PO/Mapper/Converter/RepositoryImpl implementing domain repository ports."
---

# Infra BC Repository Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- Write-side persistence for a business context under:
  - `{{basePackage}}.infra.repository.<bc>.po`
  - `{{basePackage}}.infra.repository.<bc>.mapper`
  - `{{basePackage}}.infra.repository.<bc>.converter`
  - `{{basePackage}}.infra.repository.<bc>.impl`
- Implementing domain repository ports:
  - `{{basePackage}}.domain.<bc>.repository.*`

## Inputs Required
- Business context name (`<bc>`), e.g. `biz`
- Domain repository port to implement (interface name + methods)
- Aggregate root / entity names and identifiers
- Storage model:
  - table name(s)
  - unique keys / optimistic locking needs
- Persistence stack choice:
  - MyBatis-Plus `BaseMapper` for standard CRUD
  - explicit SQL for conditional updates / locking semantics

## Outputs
- Flyway migration(s) if new table(s) are needed
- PO:
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/<bc>/po/<XxxPO>.java`
- Mapper:
  - `.../infra/repository/<bc>/mapper/<XxxMapper>.java`
- Converter:
  - `.../infra/repository/<bc>/converter/<XxxConverter>.java`
- Repository implementation:
  - `.../infra/repository/<bc>/impl/<XxxRepositoryImpl>.java`
- Tests:
  - Unit tests for converters when mapping is non-trivial
  - `*IT` for DB semantics (constraints/transactions) when needed

## Naming & Packaging
- Package follows `package-info.java` under `infra.repository` and `infra.repository.<bc>.*`.
- Types:
  - PO suffix: `PO`
  - Mapper suffix: `Mapper`
  - Converter suffix: `Converter`
  - Implementation suffix: `Impl` (must implement a domain port)

## Implementation Rules
- Repository impl must accept/return **domain** types (no PO leakage).
- Converter is the only layer that maps PO ↔ domain model.
- Translate persistence exceptions into meaningful domain/app failures (do not leak driver exceptions).
- Use explicit SQL when correctness depends on exact predicates (status/lock/lease).

## Reference Implementations
- Package rules:
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/package-info.java`
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/biz/impl/package-info.java`
- Mapper/PO baseline:
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/biz/po/package-info.java`
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/biz/mapper/package-info.java`

## Tests
- If behavior depends on DB constraints (unique/check) or transaction semantics, add `*IT`.

## Pitfalls
- Putting conversion logic in repository impl (should be in converter).
- Using BaseMapper for conditional transitions that require strict predicates.
