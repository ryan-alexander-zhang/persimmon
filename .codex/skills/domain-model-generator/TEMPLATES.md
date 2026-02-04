# Templates — Domain Model

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/biz/<bc>/model/aggregate/<XxxAggregate>.java`
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/biz/<bc>/model/entity/<XxxEntity>.java`
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/biz/<bc>/model/vo/<XxxVO>.java`
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/biz/<bc>/model/enums/<XxxStatus>.java`
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/biz/<bc>/exception/<XxxException>.java`

## Skeleton signatures

Aggregate / entity (no Lombok, minimal API):
- `public final class XxxAggregate {`
  - `public XxxAggregate(XxxId id, ...)`
  - `public XxxId getId()`
  - `public void doSomething(..., Instant now)` (enforce invariants)
  - `public List<DomainEvent> pullDomainEvents()` (only if needed)
  - `}`

Value object:
- `public final class XxxVO {`
  - `public XxxVO(...)` (validate in constructor)
  - `public <T> get...()` (only required getters)
  - `}`

Enum:
- `public enum XxxStatus { A, B, C }`

Exception:
- `public class XxxException extends DomainException { ... }` (or context-specific exception)

## Reference implementation to copy style from
- `persimmon-scaffold/persimmon-scaffold-domain/src/main/java/com/ryan/persimmon/domain/common/workflow/WorkflowInstance.java`

