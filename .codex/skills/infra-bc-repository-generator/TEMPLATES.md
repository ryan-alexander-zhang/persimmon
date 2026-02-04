# Templates — Infra BC Repository

## Directory layout (BC-first)
- `infra/repository/<bc>/po`
- `infra/repository/<bc>/mapper`
- `infra/repository/<bc>/converter`
- `infra/repository/<bc>/impl`

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/<bc>/po/<XxxPO>.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/<bc>/mapper/<XxxMapper>.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/<bc>/converter/<XxxConverter>.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/<bc>/impl/<XxxRepositoryImpl>.java`

## Skeleton signatures
Converter:
- `public final class XxxConverter {`
  - `public XxxAggregate toDomain(XxxPO po) { ... }`
  - `public XxxPO toPO(XxxAggregate aggregate) { ... }`
  - `}`

Repository implementation:
- `public final class XxxRepositoryImpl implements XxxRepository {`
  - `public XxxAggregate findById(XxxId id) { ... }`
  - `public void save(XxxAggregate aggregate) { ... }`
  - `}`

## Converter responsibilities
- `toDomain(PO) -> Aggregate/VO`
- `toPO(Domain) -> PO`
- Avoid any DB access here.

## Implementation responsibilities (`*RepositoryImpl`)
- Orchestrate mapper calls + conversions.
- Enforce domain port contracts.
- Translate persistence errors.

## Reference packages
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/repository/biz/**`
