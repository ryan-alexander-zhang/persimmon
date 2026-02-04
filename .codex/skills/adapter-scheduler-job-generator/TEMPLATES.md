# Templates — Scheduler Job

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-adapter/src/main/java/com/ryan/persimmon/adapter/scheduler/system/job/<XxxJob>.java`
- `persimmon-scaffold/persimmon-scaffold-start/src/main/resources/application-local.yaml` (job keys)

## Job skeleton pattern
- `@Component`
- inject app service + config via `@Value`
- `@Scheduled(...)` triggers a single app call

## Skeleton signature
- `@Component`
  - `public final class XxxJob {`
    - `@Scheduled(...)`
    - `public void run() { ... }`
    - `}`

## Reference starting point
- `persimmon-scaffold/persimmon-scaffold-adapter/src/main/java/com/ryan/persimmon/adapter/scheduler/system/job/OutboxRelayJob.java`
