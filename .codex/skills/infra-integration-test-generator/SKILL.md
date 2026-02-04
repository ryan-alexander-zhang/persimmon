---
name: infra-integration-test-generator
description: "Generates DB integration tests (*IT) that run via Failsafe and validate mapper/store semantics (leases, predicates, retries)."
---

# Infra Integration Test Generator

## Use for
- Any infra code relying on DB semantics (SQL, locking, constraints).

## Rules
- Name tests `*IT` so they run in `mvn verify`.
- Tests must create/cleanup their own data.
- Prefer asserting semantic behavior (claiming, transitions) over exact SQL.

