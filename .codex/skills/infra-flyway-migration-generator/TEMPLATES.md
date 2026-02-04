# Templates — Flyway Migration

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/resources/db/migration/V<semver>__<desc>.sql`

## Naming
- `V<semver>__<feature>_<object>.sql`

## Table template (no FK)
- `id` / business keys
- status column with check constraint
- timestamps
- lock columns if leased workers are used (`locked_by`, `locked_until`)

## Index template
- Claim/scan index:
  - outbox: `(status, next_retry_at, occurred_at)`
  - workflow: `(status, next_run_at)` / `(status, deadline_at)`
  - inbox: `(consumer_name, status, started_at)`

## Reference starting points
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/resources/db/migration/V1.0.5__inbox_event_processing.sql`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/resources/db/migration/V1.0.4__workflow_instance_step.sql`
