---
name: app-usecase-generator
description: "Generates app-layer use cases (Command/Handler/Assembler/DTO) following package-info and transaction rules (spring-tx only)."
---

# App Use Case Generator

## Use for
- `app/biz/command/**` and `app/biz/query/**`

## Rules
- App layer can use `org.springframework.transaction.annotation.Transactional` when needed.
- Do not introduce other Spring stereotypes (`@Service/@Component`) unless project conventions explicitly allow.
- Separate command DTOs, assemblers, and handlers as per existing structure.

## Output checklist
- [ ] Correct package per `package-info.java`
- [ ] Transaction boundary explicit when required
- [ ] Unit tests for orchestration logic (mock ports)

