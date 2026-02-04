# Templates — Start Wiring Config

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-start/src/main/java/com/ryan/persimmon/start/config/bean/<XxxWiringConfig>.java`
- `persimmon-scaffold/persimmon-scaffold-start/src/test/java/**/<Xxx>Test.java` (only for extracted policies)

## Wiring rule of thumb
- Keep `@Configuration` thin; the method body should be mostly:
  - read config values
  - `new` concrete implementation
  - return interface type

If a bean method grows complex, extract a dedicated class and unit-test it.

## Reference starting points
- `persimmon-scaffold/persimmon-scaffold-start/src/main/java/com/ryan/persimmon/start/config/bean/OutboxWiringConfig.java`
- `persimmon-scaffold/persimmon-scaffold-start/src/main/java/com/ryan/persimmon/start/config/bean/WorkflowWiringConfig.java`
