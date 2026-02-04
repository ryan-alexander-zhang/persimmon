---
name: scaffold-router
description: "Routes tasks to the correct Maven module/package and selects the right repo-local generator skill. Path-first, intent fallback."
---

# Scaffold Router

## Goal
Given a change request, choose:
1) **Maven module** (`domain/app/infra/adapter/start`)
2) **Package path** consistent with existing `package-info.java`
3) The **most specific skill** to use next

This skill is a *meta-skill*: it does not generate code by itself unless a suitable generator skill does not exist.

## Routing algorithm (must follow)
1) If the user provides a file path, route by **path** (see mapping below).
2) If not, infer module + package from:
   - existing `package-info.java` patterns in the target module
   - the type of artifact requested (PO/Mapper/Flyway/Job/Consumer/etc.)
3) Select one generator skill. Always apply `scaffold-architecture-guardrails` as a checklist.

## Path → skill mapping
- `persimmon-scaffold/persimmon-scaffold-domain/**` → `domain-*` skills
- `persimmon-scaffold/persimmon-scaffold-app/**` → `app-*` skills
- `persimmon-scaffold/persimmon-scaffold-infra/**` → `infra-*` skills
- `persimmon-scaffold/persimmon-scaffold-adapter/**` → `adapter-*` skills
- `persimmon-scaffold/persimmon-scaffold-start/**` → `start-*` skills

More specific:
- `**/db/migration/**` → `infra-flyway-migration-generator`
- `**/infra/repository/**` → `infra-bc-repository-generator`
- `**/infra/query/**` → `infra-bc-query-generator`
- `**/infra/gateway/**` → `infra-system-gateway-generator`
- `**/infra/**/po/**` or `**/infra/**/mapper/**` → `infra-mybatis-po-mapper-generator`
- `**/adapter/scheduler/**` → `adapter-scheduler-job-generator`
- `**/start/src/main/resources/**.yml` / `**.yaml` → `start-yaml-config-generator`

## One question policy
Ask **one** question when routing is ambiguous. Prefer multiple-choice.

Common disambiguations:
- unit test vs integration test
- event retry semantics (retryable vs non-retryable)
- storage choice (single table vs 2 tables) where applicable
