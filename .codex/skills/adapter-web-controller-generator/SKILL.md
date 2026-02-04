---
name: adapter-web-controller-generator
description: "Generates web adapters (controllers/dtos/assemblers) that map HTTP to app use-cases without business logic leakage."
---

# Adapter Web Controller Generator

## Use for
- `com.ryan.persimmon.adapter.web.*`

## Rules
- Controllers validate/parse inputs and call app handlers/services.
- No domain rules implemented here.
- DTOs should be adapter-specific (do not reuse domain objects as request/response).

