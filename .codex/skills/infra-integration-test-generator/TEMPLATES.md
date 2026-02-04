# Templates — Infra Integration Test (`*IT`)

## Minimal file tree (typical)
- `{{infraModuleDir}}/src/test/java/{{basePackagePath}}/infra/<feature>/<Xxx>IT.java`

## Skeleton signatures (store IT)
- `public final class XxxStoreIT {`
  - `@Test`
  - `void claimAndTransition_areSafeUnderPredicates() { ... }`
  - `}`

What to assert (semantic, not SQL):
- claim returns only eligible rows (status + time predicates)
- late update does not overwrite newer state (lock owner + lease predicate)
- lease expiry requeues with backoff or dead-letters per policy

## Reference ITs
- `{{infraModuleDir}}/src/test/java/{{basePackagePath}}/infra/event/outbox/OutboxStoreIT.java`
- `{{infraModuleDir}}/src/test/java/{{basePackagePath}}/infra/repository/workflow/WorkflowStoreIT.java`
