# Templates — Infra BC Query

## Directory layout (BC-first, optional CQRS)
- `infra/query/<bc>/dto`
- `infra/query/<bc>/mapper`
- `infra/query/<bc>/impl`

## When to create an app query port
- Create an app query port when:
  - multiple adapters call the same query
  - you want to mock the query in unit tests
- Skip the port and call infra directly only if your architecture explicitly allows it.

## Reference packages
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/query/biz/**`

