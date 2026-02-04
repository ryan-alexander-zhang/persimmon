# Templates — Infra System Gateway

## Directory layout (system-first)
- `infra/gateway/<system>/client`
- `infra/gateway/<system>/dto`
- `infra/gateway/<system>/impl`

## Minimal file tree (typical)
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/gateway/<system>/client/<XxxClient>.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/gateway/<system>/dto/<XxxRequest>.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/gateway/<system>/dto/<XxxResponse>.java`
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/gateway/<system>/impl/<XxxGatewayImpl>.java`

## Skeleton signatures
Client:
- `public interface XxxClient {`
  - `<XxxResponse> call(<XxxRequest> request);`
  - `}`

Gateway impl:
- `public final class XxxGatewayImpl implements XxxGateway {`
  - `public XxxResult doSomething(XxxInput input) { ... }`
  - `}`

## Error translation pattern
- Client throws low-level exceptions (timeouts, 4xx/5xx mapping).
- Gateway impl catches and translates into:
  - retryable failures (e.g., transient network)
  - terminal failures (e.g., validation / conflict) with clear codes

## Reference packages
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/gateway/system/**`
