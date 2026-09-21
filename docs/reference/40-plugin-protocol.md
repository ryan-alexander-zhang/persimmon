# Plugin Protocol: `persimmon.adapter/v1`

All provider-specific behaviour lives in adapters that run out of process and speak a
versioned JSON message protocol. The engine ships reference adapters; third parties add their
own without touching the engine.

Part A is Layer 0: what the framework itself implements and names. Part B is Layer 1: the
`executor` and `evaluator` roles that the core kinds (`10-core-kinds-definitions.md`) bind to.
A user kind that needs its own role adds a Part-B-style section of its own; the framework does
not change.

## Part A — Layer 0

### Message envelope and transport

Every message: `{protocol: "persimmon.adapter/v1", id, op, payload}`. Every response:
`{id, ok: true, result}` or `{id, ok: false, error: {code, message, retryable}}`.

Same message schema over two transports:

- stdio: engine spawns the adapter executable; newline-delimited JSON, one request per line,
  responses carry the request id. Used in local mode and for adapters on the server host.
- http: engine POSTs JSON to the adapter's endpoint; long operations return `202` with a
  callback token. Used for adapters running on other hosts.

For long-running work over stdio the adapter may stream `{event: "log", uri}` and
`{event: "waiting", reason}` lines before the final response.

### Registration and `describe`

An adapter id (`claude-code/v1`, `acme-canary/v1`) is resolved through the `Adapter` resource
(framework §10): `spec.command` for stdio, `spec.url` for http. Any field that names an adapter
must name a registered, `Ready` adapter whose `roles` include the role that field requires.

`describe` → `{adapterId, roles[], ...role-specific fields}`. The framework reads `adapterId`
and `roles`; every other field belongs to the role that defines it (Part B for the core
roles). The engine calls `describe` at registration and caches it in `Adapter.status.describe`;
`describe` output must be stable for a given id.

### Roles the framework knows

| Role | Bound from | Operations |
|---|---|---|
| handler | `Handler.spec.implementation.adapter` | describe, validate, reconcile |
| any other | a kind's own field | describe, plus whatever the kind's section defines, invoked by handlers through `callAdapter(adapterRef, op, payload, idempotencyKey)` |

### handler role

`validate(resource)` → `{findings[]}`. Called at admission.

`reconcile(payload)`:

```json
{
  "resource": {...full resource...},
  "event":    {"type": "ChildFinished", "sequence": 42, "payload": {...}},
  "context":  {"children": [{"ref": ObjectRef, "terminal": true, "status": {...}}],
               "snapshot": {"uri": "...", "digest": "sha256:..."},
               "actor": {"kind": "user", "id": "..."},
               "timers": ["deadline"]},
  "engine":   {"endpoint": "unix:///.../engine.sock | https://...", "token": "..."}
}
```

→ `{statusPatch: {...}, actions: [{type: createResource | patchStatus | cancelResource |
publishArtifact | commitScope | abandonScope | emitEvent | setTimer | clearTimer | callAdapter,
...}]}`

The engine applies the result atomically (framework §4–5). Handlers must be idempotent on
`(resource.metadata.uid, event.sequence)`. `engine.token` is scoped to this reconcile and
expires when it commits. `describe` for this role returns
`{adapterId, roles: ["handler"], kinds: [{group, kind, versions}]}`.

### Engine callbacks

Exposed at `engine.endpoint`, authenticated by a `token`. A handler-role reconcile receives a
token scoped to the reconcile; a `callAdapter` invocation receives a token scoped to that call
(its `idempotencyKey`), which the handler forwards in the call payload.

- `getResource(ObjectRef)` — a resource the caller's kind may read.
- `getArtifact(RevisionRef)` — content and representations of a revisioned resource.
- `getRepresentation(RevisionRef, name)`.
- `publishArtifact(kind, id?, content, representations[])` → RevisionRef. From a reconcile
  token: staged to that reconcile. From a call token: staged to that call's scope, visible only
  after the owning handler issues `commitScope(idempotencyKey)` (framework §8).
- `getKindSchema(apiVersion, kind)` — the KindDefinition schema as frozen in the caller's
  snapshot; the live registration only when the caller has no snapshot.
- `log(uri | text)`.

Adapters have no other route to the store. Tokens expire at the scope's deadline.

## Part B — Layer 1: executor and evaluator roles

| Role | Bound from | Operations |
|---|---|---|
| executor | `Executor.spec.adapter` | describe, validateConfig, execute, query, cancel, complete |
| evaluator | `Validator.spec.evaluator.type` (beyond built-in `cel`, `task`) | describe, validateConfig, evaluate |

Version 1 requires the executor role. Evaluator adapters are optional.

`describe` adds `{executorTypes[], configurationSchema (JSON Schema), parametersSchema (JSON
Schema for Task.action.parameters), supports: {query, cancel, complete}, contextKinds[],
skillFormats[], formRenderable}`. `skillFormats` lists the `Skill.spec.format` values the
adapter understands. `formRenderable` is true for human adapters that can render an input form
from a JSON Schema. The Executor handler validates `Executor.spec.configuration` against
`configurationSchema` at admission.

`validateConfig(configuration, security)` → `{ok}` or findings. Optional deeper check
(credentials resolvable, model exists).

`execute(payload)` — issued by the `task` handler as
`callAdapter(adapter, execute, payload, idempotencyKey: <attempt key>)`:

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
  "engine":   {"endpoint": "...", "token": "<call-scoped>"}
}
```

`credentials` maps each name in `security.credentialBindings` to its resolved secret for this
attempt. Adapters must not persist or log them. `context` entries arrive in declaration order;
adapters should present them before `instructions`.

Result: a TaskResult (`persimmon.result/v1`) or an error. Artifact outputs are published
through the `publishArtifact` callback with the call-scoped token; they become visible when the
`task` handler commits the attempt (`20-core-kinds-runs.md`).

`query(logicalExecutionId, idempotencyKey)` → `{state: running | succeeded | failed |
unknown, result?}`. Issued by the `task` handler after it receives
`AdapterFinished {state: unknown}`. Adapters that cannot implement it declare
`supports.query: false`; their unknown attempts fail with `unknown_result`.

`cancel(logicalExecutionId)` → `{state}`. Best effort; the handler records the answer.

`complete(logicalExecutionId, taskResult, actor, approvalGroup?)` — adapter → engine
direction for human and callback-style executors. The engine delivers it to the owning TaskRun
as a `Signal`. `actor` (`{kind, id, display?}`) is asserted by the adapter's authenticated
channel and is mandatory; the engine rejects a `complete` without it (framework §9). Human
adapters produce typed artifact outputs by rendering a form from the output kind's content
schema (`getKindSchema`) and calling `publishArtifact`.

`evaluate(payload)` → ValidationResult. Payload mirrors `execute` with `validator` in place of
`task`; loaded artifacts are provided as `artifacts.<alias>`.

### Obligations for every executor adapter

Implement TaskResult exactly; return only declared outputs with matching types; honour
`security` (network allowlist, credential bindings by name); honour the deadline; implement
idempotency for `sideEffects: idempotent`; never log secrets; report `retryable` honestly.
Conformance tests for these obligations ship with the engine.
