# Templates — Start Wiring Config

## Minimal file tree (typical)
- `{{startModuleDir}}/src/main/java/{{basePackagePath}}/start/config/bean/<XxxWiringConfig>.java`
- `{{startModuleDir}}/src/test/java/**/<Xxx>Test.java` (only for extracted policies)

## Wiring rule of thumb
- Keep `@Configuration` thin; the method body should be mostly:
  - read config values
  - `new` concrete implementation
  - return interface type

If a bean method grows complex, extract a dedicated class and unit-test it.

## Reference starting points
- `{{startModuleDir}}/src/main/java/{{basePackagePath}}/start/config/bean/OutboxWiringConfig.java`
- `{{startModuleDir}}/src/main/java/{{basePackagePath}}/start/config/bean/WorkflowWiringConfig.java`
