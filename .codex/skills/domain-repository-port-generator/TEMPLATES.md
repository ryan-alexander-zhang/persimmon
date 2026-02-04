# Templates — Domain Repository Port

## Minimal file tree (typical)
- `{{domainModuleDir}}/src/main/java/{{basePackagePath}}/domain/biz/<bc>/repository/<XxxRepository>.java`

## Skeleton signatures
- `public interface XxxRepository {`
  - `XxxAggregate findById(XxxId id);`
  - `void save(XxxAggregate aggregate);`
  - `boolean existsByBizKey(String bizKey);` (only if business requires)
  - `}`

Notes:
- Do not expose POs/mappers/query wrappers.
- Use domain identifiers and aggregates/VOs only.
