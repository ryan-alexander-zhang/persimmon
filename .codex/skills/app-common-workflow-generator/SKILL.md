---
name: app-common-workflow-generator
description: "Generates/extends the workflow engine in app-common: step handlers, retry policies, processors, and unit tests."
---

# App Common Workflow Generator

## Use for
- `com.ryan.persimmon.app.common.workflow.*`

## Rules
- Linear execution (responsibility chain) unless explicitly requested otherwise.
- Steps must be idempotent (replay safe).
- Retry policy must be configurable and unit-tested.
- State transitions must be guarded (status predicates at store boundary).

