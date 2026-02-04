# Templates — Scheduler Job

## Job skeleton pattern
- `@Component`
- inject app service + config via `@Value`
- `@Scheduled(...)` triggers a single app call

## Reference starting point
- `persimmon-scaffold/persimmon-scaffold-adapter/src/main/java/com/ryan/persimmon/adapter/scheduler/system/job/OutboxRelayJob.java`

