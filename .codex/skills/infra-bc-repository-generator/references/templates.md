# Templates — Infra BC Repository

## Directory layout (BC-first)
- `infra/repository/<bc>/po`
- `infra/repository/<bc>/mapper`
- `infra/repository/<bc>/converter`
- `infra/repository/<bc>/impl`

## Minimal file tree (typical)
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/<bc>/po/<XxxPO>.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/<bc>/mapper/<XxxMapper>.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/<bc>/converter/<XxxConverter>.java`
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/<bc>/impl/<XxxRepositoryImpl>.java`

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
- `{{infraModuleDir}}/src/main/java/{{basePackagePath}}/infra/repository/biz/**`
