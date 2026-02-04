## Persimmon Copilot Scaffold — Agent Routing (Skills)

This repository contains a set of repo-local Codex skills under `.codex/skills/`.

### Hard rules (always)
- Prefer **existing patterns** in the workspace over inventing new ones.
- Keep changes **minimal and focused**; delete non-essential code when redesigning.
- `*-domain`: **no Lombok**; avoid adding methods unless necessary.
- Flyway migrations: **no foreign keys**.
- Tests:
  - Unit tests: `*Test` (Surefire, `mvn test`)
  - Integration tests: `*IT` (Failsafe, `mvn verify`)

### Skill routing (path → skill)
Use the matching skill for ANY change that primarily affects these paths.

- Global architecture / cross-cutting conventions → `scaffold-architecture-guardrails`
- Skill-based routing / orchestrating other skills → `scaffold-router`

**Domain (module suffix: `*-domain`)**
- `src/main/java/**/domain/**/model/**` → `domain-model-generator`
- `src/main/java/**/domain/**/repository/**` → `domain-repository-port-generator`

**App (module suffix: `*-app`)**
- `src/main/java/**/app/biz/command/**` → `app-usecase-generator`
- `src/main/java/**/app/biz/port/**` → `app-port-generator`
- `src/main/java/**/app/common/event/**` → `app-common-event-generator`
- `src/main/java/**/app/common/workflow/**` → `app-common-workflow-generator`

**Infra (module suffix: `*-infra`)**
- `src/main/java/**/infra/**/po/**` or `**/mapper/**` → `infra-mybatis-po-mapper-generator`
- `src/main/java/**/infra/**/store/**` → `infra-store-implementation-generator`
- `src/main/java/**/infra/repository/biz/**` (BC repositories) → `infra-bc-repository-generator`
- `src/main/java/**/infra/query/biz/**` (BC queries/CQRS read side) → `infra-bc-query-generator`
- `src/main/java/**/infra/gateway/**` (system integrations) → `infra-system-gateway-generator`
- `src/main/resources/db/migration/**` → `infra-flyway-migration-generator`
- `src/main/java/**/infra/**/event/mq/**` → `infra-mq-transport-generator`
- `src/test/java/**` with DB dependency → `infra-integration-test-generator`

**Adapter (module suffix: `*-adapter`)**
- `src/main/java/**/adapter/scheduler/**` → `adapter-scheduler-job-generator`
- `src/main/java/**/adapter/mq/**` → `adapter-mq-consumer-generator`
- `src/main/java/**/adapter/web/**` → `adapter-web-controller-generator`

**Start (module suffix: `*-start`)**
- `src/main/java/**/start/config/bean/**` → `start-wiring-config-generator`
- `src/main/resources/**.yml` / `**.yaml` → `start-yaml-config-generator`
- YAML key naming / config schema decisions → `start-config-schema-guardrails`

### Intent routing (when path is not known yet)
If the user asks for an artifact without providing a path, use `scaffold-router` to:
1) decide the correct module + package based on `package-info.java` patterns,
2) select the most specific generator skill above,
3) enforce `scaffold-architecture-guardrails` checklist.
