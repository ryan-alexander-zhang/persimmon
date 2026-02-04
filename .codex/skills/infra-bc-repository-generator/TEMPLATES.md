# Templates — Infra BC Repository

## Directory layout (BC-first)
- `infra/repository/<bc>/po`
- `infra/repository/<bc>/mapper`
- `infra/repository/<bc>/converter`
- `infra/repository/<bc>/impl`

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

