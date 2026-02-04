---
name: infra-store-implementation-generator
description: "Generates infra Store implementations (Mybatis*Store) with correct claim/update semantics, predicates, and IT coverage."
---

# Infra Store Implementation Generator

## Use for
- `com.ryan.persimmon.infra.**.store.*`

## Must have
- Claim/lease logic (when concurrent workers exist).
- Update transitions guarded by:
  - current status
  - lock owner (`locked_by`)
  - lease validity (`locked_until`)

## Tests
- `*IT` verifying concurrency-safe transitions and edge cases (lease expiry).

