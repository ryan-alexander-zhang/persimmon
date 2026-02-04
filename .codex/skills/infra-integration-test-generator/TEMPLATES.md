# Templates — Infra Integration Test (`*IT`)

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-infra/src/test/java/com/ryan/persimmon/infra/<feature>/<Xxx>IT.java`

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
- `persimmon-scaffold/persimmon-scaffold-infra/src/test/java/com/ryan/persimmon/infra/event/outbox/OutboxStoreIT.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/test/java/com/ryan/persimmon/infra/repository/workflow/WorkflowStoreIT.java`

