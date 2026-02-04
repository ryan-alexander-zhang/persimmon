---
name: app-usecase-generator
description: "Generates app-layer use cases (Command/Handler/Assembler/DTO) following package-info and transaction rules (spring-tx only)."
---

# App Use Case Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- `app/biz/command/**` and `app/biz/query/**`

## Inputs Required
- Business use-case name (verb + object)
- Command/Query DTO fields
- Required domain ports (repositories/gateways)
- Transaction boundary requirement (yes/no)

## Outputs
- Command side (typical):
  - `.../app/biz/command/dto/<XxxCommand>.java`
  - `.../app/biz/command/handler/<XxxCommandHandler>.java`
  - `.../app/biz/command/assembler/<XxxAssembler>.java` (optional)
- Query side (typical):
  - `.../app/biz/query/dto/<XxxQuery>.java`
  - `.../app/biz/query/service/<XxxQueryService>.java`
- Tests:
  - `.../app/.../<Xxx>Test.java` (mock ports)

## Naming & Packaging
- Follow existing `package-info.java` packages:
  - `{{basePackage}}.app.biz.command.*`
  - `{{basePackage}}.app.biz.query.*`
- Keep adapter DTOs out of app packages.

## Implementation Rules
- App layer can use `org.springframework.transaction.annotation.Transactional` when needed.
- Do not introduce other Spring stereotypes (`@Service/@Component`) unless project conventions explicitly allow.
- Separate command DTOs, assemblers, and handlers as per existing structure.

## Reference Implementations
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/command/package-info.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/workflow/service/WorkflowStartService.java`

## Tests
- Unit tests validate:
  - orchestration order
  - port calls
  - error mapping (retryable vs non-retryable where applicable)

## Pitfalls
- Putting persistence types (PO/Mapper) into app DTOs.
- Using Spring components in app beyond `spring-tx`.

## Output checklist
- [ ] Correct package per `package-info.java`
- [ ] Transaction boundary explicit when required
- [ ] Unit tests for orchestration logic (mock ports)
