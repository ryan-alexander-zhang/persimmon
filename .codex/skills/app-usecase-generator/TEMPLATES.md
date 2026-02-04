# Templates — App Use Case (Command/Query)

## Minimal file tree (command)
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/command/dto/<XxxCommand>.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/command/handler/<XxxCommandHandler>.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/command/assembler/<XxxAssembler>.java` (optional)
- `{{appModuleDir}}/src/test/java/{{basePackagePath}}/app/biz/command/handler/<XxxCommandHandler>Test.java`

## Minimal file tree (query)
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/query/dto/<XxxQuery>.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/query/dto/<XxxResultDTO>.java`
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/biz/query/service/<XxxQueryService>.java`
- `{{appModuleDir}}/src/test/java/{{basePackagePath}}/app/biz/query/service/<XxxQueryService>Test.java`

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
- `{{appModuleDir}}/src/main/java/{{basePackagePath}}/app/common/workflow/service/WorkflowStartService.java`
