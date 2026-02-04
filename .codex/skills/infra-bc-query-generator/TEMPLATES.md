# Templates — Infra BC Query

## Directory layout (BC-first, optional CQRS)
- `infra/query/<bc>/dto`
- `infra/query/<bc>/mapper`
- `infra/query/<bc>/impl`

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/query/<bc>/dto/<XxxRowDTO>.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/query/<bc>/mapper/<XxxQueryMapper>.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/query/<bc>/impl/<XxxQueryPortImpl>.java` (when app defines a port)

## Skeleton signatures
Mapper:
- `@Mapper`
  - `public interface XxxQueryMapper {`
    - `List<XxxRowDTO> selectBy...(Param...)`
    - `}`

Impl:
- `public final class XxxQueryPortImpl implements XxxQueryPort {`
  - `public XxxResultDTO query(XxxQuery query) { ... }`
  - `}`

## When to create an app query port
- Create an app query port when:
  - multiple adapters call the same query
  - you want to mock the query in unit tests
- Skip the port and call infra directly only if your architecture explicitly allows it.

## Reference packages
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/query/biz/**`
