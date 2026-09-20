# Plugin Protocol: `persimmon.adapter/v1`

All provider-specific behaviour lives in adapters that run out of process and speak a
versioned JSON message protocol. The engine ships reference adapters; third parties add their
own without touching the engine.

## Adapter roles

| Role | Bound from | Operations |
|---|---|---|
| executor | `Executor.spec.adapter` | describe, validateConfig, execute, query, cancel, complete |
| evaluator | `Validator.spec.evaluator.type` (beyond built-in `cel`, `task`) | describe, validateConfig, evaluate |
| eventSource | future external event kinds | describe, subscribe |

Version 1 requires the executor role. Evaluator adapters are optional. External event sources
are deferred; the only event producer is the engine itself.

## Transport

Same message schema over two transports:

- stdio: engine spawns the adapter executable; newline-delimited JSON, one request per line,
  responses carry the request id. Used in local mode and for sandboxed adapters in cloud mode.
- http: engine POSTs JSON to the adapter's endpoint; long operations return `202` with a
  callback token. Used for remote adapters in cloud mode.

Every message: `{protocol: "persimmon.adapter/v1", id, op, payload}`. Every response:
`{id, ok: true, result}` or `{id, ok: false, error: {code, message, retryable}}`.

## Operations

`describe` → `{adapterId, roles[], executorTypes[], configurationSchema (JSON Schema),
supports: {query, cancel, complete}, contextKinds[]}`.
Called at Executor admission and engine startup. The engine validates
`Executor.spec.configuration` against `configurationSchema`.

`validateConfig(configuration, security)` → `{ok}` or findings. Optional deeper check
(credentials resolvable, model exists).

`execute(payload)`:

```json
{
  "taskRun": {"name": "...", "logicalExecutionId": "...", "idempotencyKey": "...", "attempt": 1},
  "task":     {"action": {...}, "inputs": {...}, "outputs": {...}, "sideEffects": "none"},
  "executor": {"type": "agent", "configuration": {...}, "security": {...}},
  "inputs":   {"<port>": RuntimeValue},
  "context":  [{"kind": "file", "ref": ExternalResourceRef, "path": "AGENTS.md"},
               {"kind": "prompt", "name": "...", "content": "...", "digest": "sha256:..."},
               {"kind": "skill", "name": "...", "source": ExternalResourceRef, "digest": "sha256:..."},
               {"kind": "artifact", "ref": ArtifactRef}],
  "deadline": "2026-09-20T12:00:00Z",
  "engine":   {"endpoint": "unix:///.../engine.sock | https://...", "token": "..."}
}
```

Result: a TaskResult (`persimmon.result/v1`) or an error. For long-running work over stdio the
adapter may stream `{event: "log", uri}` and `{event: "waiting", reason}` lines before the
final response.

`query(logicalExecutionId, idempotencyKey)` → `{state: running | succeeded | failed |
unknown, result?}`. Used after crash or timeout. Adapters that cannot implement it declare
`supports.query: false`; their `unknown_result` attempts are never retried automatically
unless `sideEffects: none`.

`cancel(logicalExecutionId)` → `{state}`. Best effort; the engine records the answer.

`complete(logicalExecutionId, taskResult, actor)` — adapter → engine direction for human and
callback-style executors. `actor` is asserted by the adapter's authenticated channel.

`evaluate(payload)` → ValidationResult. Payload mirrors `execute` with `validator` in place of
`task`; loaded artifacts are provided as `artifacts.<alias>`.

## Engine callbacks available to adapters

Exposed at `engine.endpoint`, authenticated by the per-attempt `token`, scoped to the attempt:

- `getArtifact(ArtifactRef)` — content and representations the attempt's inputs reference.
- `publishArtifact(kind, id?, content, representations[])` → ArtifactRef, staged to this attempt.
- `getRepresentation(ArtifactRef, name)`.
- `log(uri | text)`.

Adapters have no other route to the store. Tokens expire at the attempt deadline.

## Obligations for every adapter

Implement TaskResult exactly; return only declared outputs with matching types; honour
`security` (network allowlist, credential bindings by name); honour the deadline; implement
idempotency for `sideEffects: idempotent`; never log secrets; report `retryable` honestly.
Conformance tests for these obligations ship with the engine.
