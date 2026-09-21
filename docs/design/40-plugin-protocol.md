# Plugin Protocol: `persimmon.adapter/v1`

All provider-specific behaviour lives in adapters that run out of process and speak a
versioned JSON message protocol. The engine ships reference adapters; third parties add their
own without touching the engine.

## Adapter roles

| Role | Bound from | Operations |
|---|---|---|
| executor | `Executor.spec.adapter` | describe, validateConfig, execute, query, cancel, complete |
| evaluator | `Validator.spec.evaluator.type` (beyond built-in `cel`, `task`) | describe, validateConfig, evaluate |
| handler | `Handler.spec.implementation.adapter` | describe, validate, reconcile |
| eventSource | future external event kinds | describe, subscribe |

Version 1 requires executor and handler roles. Evaluator adapters are optional. External event
sources are deferred; the only event producer is the engine itself.

### handler role

`validate(resource)` → `{findings[]}`. Pure; called at admission.

`reconcile(payload)`:

```json
{
  "resource": {...full resource...},
  "event":    {"type": "ChildFinished", "sequence": 42, "payload": {...}},
  "context":  {"children": [{"ref": ObjectRef, "phase": "Succeeded", "outputs": {...}}],
               "snapshot": {"uri": "...", "digest": "sha256:..."},
               "actor": {"kind": "user", "id": "..."},
               "timers": ["deadline"]}
}
```

→ `{statusPatch: {...}, actions: [{type: createResource | patchStatus | cancelResource |
publishArtifact | emitEvent | setTimer | clearTimer | callAdapter, ...}]}`

The engine applies the result atomically (framework §4–5). Handlers must be idempotent on
`(resource.metadata.uid, event.sequence)`. `describe` for this role returns
`{adapterId, roles: ["handler"], kinds: [{group, kind, versions}]}`.

## Registration

An adapter id (`claude-code/v1`, `acme-canary/v1`) is resolved through the `Adapter` resource
(framework §10): `spec.command` for stdio, `spec.url` for http. `Executor.spec.adapter`,
`Handler.spec.implementation.adapter.id` and custom `Validator.spec.evaluator.type` values must
name a registered, `Ready` adapter whose `roles` include the required role. The engine calls
`describe` at registration and caches it; `describe` output must be stable for a given id.

## Transport

Same message schema over two transports:

- stdio: engine spawns the adapter executable; newline-delimited JSON, one request per line,
  responses carry the request id. Used in local mode and for adapters on the server host.
- http: engine POSTs JSON to the adapter's endpoint; long operations return `202` with a
  callback token. Used for adapters running on other hosts.

Every message: `{protocol: "persimmon.adapter/v1", id, op, payload}`. Every response:
`{id, ok: true, result}` or `{id, ok: false, error: {code, message, retryable}}`.

## Operations

`describe` → `{adapterId, roles[], executorTypes[], configurationSchema (JSON Schema),
parametersSchema (JSON Schema for Task.action.parameters), supports: {query, cancel,
complete}, contextKinds[], skillFormats[], formRenderable}`.
`skillFormats` lists the `Skill.spec.format` values the adapter understands. `formRenderable`
is true for human adapters that can render an input form from a JSON Schema.
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
  "credentials": {"anthropic-api-key": "<secret>"},
  "engine":   {"endpoint": "unix:///.../engine.sock | https://...", "token": "..."}
}
```

`credentials` maps each name in `security.credentialBindings` to its resolved secret for this
attempt. Adapters must not persist or log them. `context` entries arrive in declaration order;
adapters should present them before `instructions`.

Result: a TaskResult (`persimmon.result/v1`) or an error. For long-running work over stdio the
adapter may stream `{event: "log", uri}` and `{event: "waiting", reason}` lines before the
final response.

`query(logicalExecutionId, idempotencyKey)` → `{state: running | succeeded | failed |
unknown, result?}`. Used after crash or timeout. Adapters that cannot implement it declare
`supports.query: false`; their `unknown_result` attempts are never retried automatically
unless `sideEffects: none`.

`cancel(logicalExecutionId)` → `{state}`. Best effort; the engine records the answer.

`complete(logicalExecutionId, taskResult, actor, approvalGroup?)` — adapter → engine direction
for human and callback-style executors. `actor` (`{kind, id, display?}`) is asserted by the
adapter's authenticated channel and is mandatory; the engine rejects a `complete` without it.
Human adapters produce typed artifact outputs by rendering a form from the output kind's
content schema (fetched with `getKindSchema`) and calling `publishArtifact`.

`evaluate(payload)` → ValidationResult. Payload mirrors `execute` with `validator` in place of
`task`; loaded artifacts are provided as `artifacts.<alias>`.

## Engine callbacks available to adapters

Exposed at `engine.endpoint`, authenticated by the per-attempt `token`, scoped to the attempt:

- `getArtifact(ArtifactRef)` — content and representations the attempt's inputs reference.
- `publishArtifact(kind, id?, content, representations[])` → ArtifactRef, staged to this attempt.
- `getRepresentation(ArtifactRef, name)`.
- `getKindSchema(apiVersion, kind)` — the registered KindDefinition schema, for form
  rendering and client-side validation.
- `log(uri | text)`.

Adapters have no other route to the store. Tokens expire at the attempt deadline.

## Obligations for every adapter

Implement TaskResult exactly; return only declared outputs with matching types; honour
`security` (network allowlist, credential bindings by name); honour the deadline; implement
idempotency for `sideEffects: idempotent`; never log secrets; report `retryable` honestly.
Conformance tests for these obligations ship with the engine.
