# Templates — Scheduler Job

## Minimal file tree (typical)
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/scheduler/system/job/<XxxJob>.java`
- `{{startModuleDir}}/src/main/resources/application-local.yaml` (job keys)

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
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/scheduler/system/job/OutboxRelayJob.java`
