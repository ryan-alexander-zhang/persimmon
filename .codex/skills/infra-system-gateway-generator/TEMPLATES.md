# Templates — Infra System Gateway

## Directory layout (system-first)
- `infra/gateway/<system>/client`
- `infra/gateway/<system>/dto`
- `infra/gateway/<system>/impl`

## Error translation pattern
- Client throws low-level exceptions (timeouts, 4xx/5xx mapping).
- Gateway impl catches and translates into:
  - retryable failures (e.g., transient network)
  - terminal failures (e.g., validation / conflict) with clear codes

## Reference packages
- `persimmon-scaffold/persimmon-scaffold-infra/src/main/java/com/ryan/persimmon/infra/gateway/system/**`

