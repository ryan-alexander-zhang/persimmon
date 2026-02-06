# Templates — Start YAML Config

## Minimal file tree (typical)
- `{{startModuleDir}}/src/main/resources/application.yaml`
- `{{startModuleDir}}/src/main/resources/application-local.yaml`
- `{{startModuleDir}}/src/main/java/{{basePackagePath}}/start/config/bean/<XxxWiringConfig>.java` (when keys are used by wiring)
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/**` (when placeholders are used by adapters)

## Skeleton patterns
YAML groups (example style from current project):
- `persimmon.outbox.topic`
- `persimmon.outbox.kafka.producer.*`
- `persimmon.outbox.kafka.consumer.*`
- `persimmon.outbox.relay.*`
- `persimmon.workflow.retry.*`

## Rename key checklist
1) Update YAML: add new key, remove old key (if requested)
2) Update `@Value` / `@ConfigurationProperties` reads to new key
3) Update docs/requirements if they reference keys
4) Update any adapter annotations using placeholders (e.g., `@KafkaListener`)

## Reference YAML
- `{{startModuleDir}}/src/main/resources/application.yaml`
- `{{startModuleDir}}/src/main/resources/application-local.yaml`
