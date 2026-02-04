---
name: adapter-web-controller-generator
description: "Generates web adapters (controllers/dtos/assemblers) that map HTTP to app use-cases without business logic leakage."
---

# Adapter Web Controller Generator

> Follow `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`.

## Use For
- `{{basePackage}}.adapter.web.*`

## Inputs Required
- Endpoint path + method
- Request/response schema
- Called app use-case (command/query)

## Outputs
- `.../adapter/web/biz/controller/<XxxController>.java`
- DTOs under `.../adapter/web/biz/dto`
- Assembler under `.../adapter/web/biz/assembler` when mapping is non-trivial

## Naming & Packaging
- Follow BC-first `adapter.web.biz.*` packages
- Shared only in `adapter.web.common`

## Implementation Rules
- Controllers validate/parse inputs and call app handlers/services.
- No domain rules implemented here.
- DTOs should be adapter-specific (do not reuse domain objects as request/response).

## Pitfalls
- Exposing infra POs in web responses.
