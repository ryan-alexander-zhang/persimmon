---
name: infra-mybatis-po-mapper-generator
description: "Generates MyBatis/MyBatis-Plus PO + Mapper patterns for infra, choosing BaseMapper vs SQL mapping with clear tradeoffs."
---

# Infra MyBatis PO/Mapper Generator

## Use for
- PO under `com.ryan.persimmon.infra.**.po`
- Mapper under `com.ryan.persimmon.infra.**.mapper`

## Rules
- Prefer MyBatis-Plus `BaseMapper<T>` when CRUD is standard and constraints are simple.
- Use explicit SQL (annotations/XML) when:
  - conditional update/claim semantics are needed (lock owner predicates)
  - `FOR UPDATE SKIP LOCKED` is required
  - multi-step atomic transitions must be encoded precisely
- Keep PO focused on persistence; convert to domain/app types at boundaries.

## Output checklist
- [ ] Mapper methods include necessary predicates (status/lock/lease)
- [ ] PO fields match migration columns exactly
- [ ] Integration test for critical mappers if DB semantics involved

