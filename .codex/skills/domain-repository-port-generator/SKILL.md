---
name: domain-repository-port-generator
description: "Generates domain repository ports (interfaces) and contracts without infra/framework dependencies."
---

# Domain Repository Port Generator

## Use for
- `com.ryan.persimmon.domain.biz.repository.*` interfaces

## Rules
- No persistence details (SQL/MyBatis annotations) in domain.
- Methods should express domain intent (e.g., `save`, `findById`), not table operations.

## Output checklist
- [ ] Pure interface/contract
- [ ] No framework imports
- [ ] Covered by app/infra implementations (separate module)

