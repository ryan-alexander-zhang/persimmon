---
name: domain-repository-port-generator
description: "Generates domain repository ports (interfaces) and contracts without infra/framework dependencies."
---

# Domain Repository Port Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- `{{basePackage}}.domain.biz.repository.*` interfaces

## Inputs Required
- Aggregate name + identifier type
- Required operations (save, find, uniqueness checks) expressed in domain terms
- Consistency expectations (optimistic locking? unique constraints?)

## Outputs
- `{{domainModuleDir}}/src/main/java/{{basePackagePath}}/.../<XxxRepository>.java`

## Naming & Packaging
- Port names: `*Repository` (domain) or `*Gateway` (external systems)
- Keep interfaces in `domain.biz.<context>.repository`

## Implementation Rules
- No persistence details (SQL/MyBatis annotations) in domain.
- Methods should express domain intent (e.g., `save`, `findById`), not table operations.

## Reference Implementations
- `{{domainModuleDir}}/src/main/java/{{basePackagePath}}/domain/biz/repository/package-info.java`

## Tests
- Usually none for pure interfaces.

## Pitfalls
- Adding `Page`, `QueryWrapper`, `Mapper` types into domain ports.

## Output checklist
- [ ] Pure interface/contract
- [ ] No framework imports
- [ ] Covered by app/infra implementations (separate module)
