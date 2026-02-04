# Templates — App Use Case (Command/Query)

## Minimal file tree (command)
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/command/dto/<XxxCommand>.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/command/handler/<XxxCommandHandler>.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/command/assembler/<XxxAssembler>.java` (optional)
- `persimmon-scaffold/persimmon-scaffold-app/src/test/java/com/ryan/persimmon/app/biz/command/handler/<XxxCommandHandler>Test.java`

## Minimal file tree (query)
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/query/dto/<XxxQuery>.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/query/dto/<XxxResultDTO>.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/biz/query/service/<XxxQueryService>.java`
- `persimmon-scaffold/persimmon-scaffold-app/src/test/java/com/ryan/persimmon/app/biz/query/service/<XxxQueryService>Test.java`

## Skeleton signatures (command)
- `public record XxxCommand(...) {}`
- `public final class XxxCommandHandler {`
  - `@Transactional` (only when needed)
  - `public void handle(XxxCommand command) { ... }`
  - `}`

## Skeleton signatures (query)
- `public record XxxQuery(...) {}`
- `public record XxxResultDTO(...) {}`
- `public final class XxxQueryService {`
  - `public XxxResultDTO query(XxxQuery query) { ... }`
  - `}`

## Reference implementations to copy style from
- `persimmon-scaffold/persimmon-scaffold-app/src/main/java/com/ryan/persimmon/app/common/workflow/service/WorkflowStartService.java`

