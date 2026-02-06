---
name: infra-store-implementation-generator
description: "Generates infra Store implementations (Mybatis*Store) with correct claim/update semantics, predicates, and IT coverage."
---

# Infra Store Implementation Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- `{{basePackage}}.infra.**.store.*`

## Inputs Required
- Port interface to implement (app/common or app/biz port)
- Concurrency model:
  - single worker vs multiple workers
  - lease duration
  - reclaim policy on lease expiry
- Status machine and terminal state semantics

## Outputs
- `.../infra/.../store/<MybatisXxxStore>.java`
- Mapper/PO changes as needed
- `.../infra/src/test/java/.../<XxxStore>IT.java` (when DB semantics)

## Naming & Packaging
- Implementations: `Mybatis<Xxx>Store`
- Feature packages:
  - events: `infra.event.{outbox|inbox}.store`
  - workflow: `infra.repository.workflow.store`

## Implementation Rules (Must Have)
- Claim/lease logic (when concurrent workers exist).
- Update transitions guarded by:
  - current status
  - lock owner (`locked_by`)
  - lease validity (`locked_until`)

## Reference Implementations
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/event/outbox/store/MybatisOutboxStore.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/event/inbox/store/MybatisInboxStore.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/workflow/store/MybatisWorkflowStore.java`

## Tests
- `*IT` verifying concurrency-safe transitions and edge cases (lease expiry).

## Pitfalls
- Update statements that filter only by ID (late updates overwrite newer state).
- Claim queries without the right indexes (status/next_retry_at/locked_until).
