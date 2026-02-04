# Templates — Adapter Web Controller

## Minimal file tree (typical)
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/web/biz/controller/<XxxController>.java`
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/web/biz/dto/<XxxRequest>.java`
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/web/biz/dto/<XxxResponse>.java`
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/web/biz/assembler/<XxxAssembler>.java` (optional)

## Skeleton signatures
- `@RestController`
  - `public final class XxxController {`
    - `@PostMapping("/...")`
    - `public XxxResponse create(@RequestBody XxxRequest request) { ... }`
    - `}`

DTOs:
- `public record XxxRequest(...) {}`
- `public record XxxResponse(...) {}`

Assembler (only when mapping is non-trivial):
- `public final class XxxAssembler {`
  - `public XxxCommand toCommand(XxxRequest request) { ... }`
  - `public XxxResponse toResponse(XxxResultDTO result) { ... }`
  - `}`

## Reference packages
- `{{adapterModuleDir}}/src/main/java/{{basePackagePath}}/adapter/web/biz/controller/package-info.java`
