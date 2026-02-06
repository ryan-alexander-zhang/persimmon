---
name: infra-system-gateway-generator
description: "Generates system-first external integration: client/dto/gateway impl under infra.gateway.<system> and error translation rules."
---

# Infra System Gateway Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

Templates: See `references/templates.md`.

## Use For
- External integrations organized by remote system name under:
  - `{{basePackage}}.infra.gateway.<system>.client`
  - `{{basePackage}}.infra.gateway.<system>.dto`
  - `{{basePackage}}.infra.gateway.<system>.impl`
- Implementing domain gateway ports:
  - `{{basePackage}}.domain.<bc>.gateway.*`

## Inputs Required
- System name (`<system>`), e.g. `kubernetes`, `harbor`, `payment`
- Protocol (HTTP/RPC/SDK) and client choice
- Domain gateway port interface to implement
- Error model:
  - which failures are retryable vs non-retryable
  - what information must be preserved (codes, requestId, etc.)

## Outputs
- Client:
  - `.../infra/gateway/<system>/client/<XxxClient>.java`
- Integration DTOs:
  - `.../infra/gateway/<system>/dto/<XxxRequest>.java`
  - `.../infra/gateway/<system>/dto/<XxxResponse>.java`
- Gateway implementation:
  - `.../infra/gateway/<system>/impl/<XxxGatewayImpl>.java`
- Start wiring + config keys (if needed):
  - `.../start/config/bean/<System>GatewayWiringConfig.java`
  - YAML updates via `start-yaml-config-generator`

## Naming & Packaging
- System-first organization is mandatory (per `package-info.java`).
- Separate concerns:
  - `client`: protocol details (timeouts, retries, auth, serialization)
  - `dto`: integration request/response models
  - `impl`: domain port implementation and error translation

## Implementation Rules
- Domain-facing interface must stay business-oriented; do not leak protocol DTOs upward.
- Put retries/timeouts in `client` (policy belongs there), not in domain.
- Translate protocol errors in `impl` into domain/app meaningful failures.

## Reference Implementations
- Package rules:
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/gateway/package-info.java`
  - `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/gateway/system/impl/package-info.java`

## Tests
- Unit tests for error translation rules are recommended.

## Pitfalls
- Letting client exceptions propagate to app/domain (breaks retry classification).
- Mixing DTOs and domain models in the same package.
