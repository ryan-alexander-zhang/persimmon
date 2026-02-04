# Templates — Infra Store Implementation

Prefer copying existing implementations and adapting names/predicates rather than writing from scratch.

## File skeleton
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/<feature>/store/Mybatis<Xxx>Store.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/<feature>/mapper/<Xxx>Mapper.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/<feature>/po/<Xxx>PO.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/test/java/.../<Xxx>StoreIT.java` (DB semantics)

## Skeleton signatures
- `public final class MybatisXxxStore implements XxxStore {`
  - `public void append(List<XxxMessage> messages) { ... }`
  - `@Transactional`
  - `public List<XxxMessage> claimNextBatch(int batchSize, Instant now) { ... }`
  - `public void markSent(UUID id, Instant sentAt) { ... }`
  - `public void markFailed(UUID id, Instant now, Instant nextRetryAt, String lastError) { ... }`
  - `public void markDead(UUID id, Instant now, String lastError) { ... }`
  - `}`

## Store checklist template (claim + update)
- Claim method:
  - `@Transactional`
  - `SELECT ... FOR UPDATE SKIP LOCKED` to lock candidates
  - `UPDATE ... WHERE id=? AND status=?` to transition (status predicate)
- Transition updates:
  - MUST include `status` predicate
  - MUST include lock owner (`locked_by`) predicate when used
  - MUST include lease predicate (`locked_until`) when used

## Reference starting points
- Outbox: `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/event/outbox/store/MybatisOutboxStore.java`
- Inbox: `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/event/inbox/store/MybatisInboxStore.java`
- Workflow: `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/workflow/store/MybatisWorkflowStore.java`
