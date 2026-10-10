# Adapter

status: active · layer: 0 · schema: [`schemas/adapter.yaml`](schemas/adapter.yaml)

Out-of-process code the engine talks to over `persimmon.adapter/v1`. The engine knows the
protocol and the transport, never what an Adapter does.

```text
Adapter Resource (Global) ── id, roles, transport, command | url
        │ apply
        ▼
engine ── describe ──▶ Adapter ──▶ {adapterId, protocol, roles[], ...} ──▶ status.describe, describeDigest, Ready
engine ── validate | reconcile | <Role op> ──▶ Adapter                   (request carries engine {endpoint, token})
engine ◀── getResource | list | getArtifact | getBlob | putBlob | publishArtifact | getKindSchema | log | signal ── Adapter
```

## Spec

| Field | Rule |
|---|---|
| `id` | `<name>/v<n>`; what Handlers and kind fields name (`x-persimmon-adapter`) |
| `roles[]` | ⊆ Roles the Adapter's `describe` reports |
| `transport` | `stdio` \| `http` |
| `command[]` | stdio: executable and args; one process per call, killed at the call deadline |
| `url` | http: `https://` endpoint the engine POSTs to |
| `env` | stdio: non-secret environment; a name starting `PERSIMMON_` is the engine's and refused |
| `credentialBindings[]` | Global CredentialStore names (`08-store.md`); stdio: injected as environment; http: first one is the bearer token |

## Status

| Field | Writer | Rule |
|---|---|---|
| `describe` | engine | last `describe` result |
| `describeDigest` | engine | `sha256:` over canonically encoded `describe` (`04-snapshot.md`) |
| `conditions[]` | engine | `Ready` true after `describe` succeeded and `roles` check passed |

## Mode

| | local | server |
|---|---|---|
| transport | stdio | stdio on the server host, http elsewhere |
| `engine.endpoint` | `unix://` socket | `https://` |
| apply | `persimmon adapter install <manifest>` | same, or the API |

## Protocol

| Message | Shape |
|---|---|
| request | `{protocol: "persimmon.adapter/v1", id, op, payload}` |
| response | `{id, ok: true, result}` \| `{id, ok: false, error: {code, message, retryable}}` |
| stream line (stdio, before the response) | `{id, event: log, text}` \| `{id, event: waiting, reason}` |
| ack (http, long operation) | `202 {id}`; the response is later POSTed to `engine.endpoint/responses` with the request's token |

| Transport | Framing |
|---|---|
| stdio | one JSON object per line on stdin and stdout |
| http | POST JSON, JSON body back |

| Response | AdapterFinished |
|---|---|
| `ok: true` | `{state: succeeded, result}` |
| `ok: false` | `{state: failed, error}` |
| transport failure, deadline, or engine restart with no recorded response | `{state: unknown}` |

## Operations

| Op | Role | Payload → result |
|---|---|---|
| `describe` | all | `{}` → `{adapterId, protocol, roles[], kinds[]?, ...Role fields}` |
| `validate` | handler | `{resource}` → `ValidateResult` (`02-handler.md`) |
| `reconcile` | handler | `ReconcileInput` → `ReconcileResult` (`02-handler.md`) |
| any other | a kind's Role | `callAdapter(adapterId, op, payload, idempotencyKey, deadline?)`; the engine sets `payload.engine {endpoint, token}`, replacing any supplied value |

`describe` is stable for one `id`; a changed answer needs a new `id`.

## Engine callbacks

Adapters reach the engine only here, at `engine.endpoint`, with a token.

| Callback | Result | Scope |
|---|---|---|
| `getResource(ObjectRef)` | Resource | caller Resource's Namespace, then Global |
| `list(kind, namespace, labels)` | Resources | same; equality label selector |
| `getArtifact(RevisionRef)` | committed revision | same |
| `getBlob(digest)` | bytes | same |
| `putBlob(bytes, mediaType)` | `{uri, digest}` | content-addressed; idempotent |
| `publishArtifact(PublishRequest)` | RevisionRef | staged to the reconcile, or to Publication scope `(owner uid, idempotencyKey)` for a call token (`05-revisioned-kind.md`) |
| `getKindSchema(apiVersion, kind)` | KindDefinition version | from the caller's snapshot; live when none |
| `log(text)` | none | appended to the caller's RunLog entry |
| `signal(ObjectRef, eventId, actor, payload)` | none | Signal `{source: adapter}` to that Resource; `actor` mandatory (`00-resource.md`) |

| Token | Issued | Expires | Callbacks |
|---|---|---|---|
| reconcile token | in a `reconcile` request | when the reconcile commits or fails | all but `signal` |
| call token | in a `callAdapter` payload | when AdapterFinished is recorded, or at the deadline | all but `signal` |
| adapter token | at apply, kept in the TokenStore (`08-store.md`), handed to the Adapter as `PERSIMMON_ADAPTER_TOKEN` (stdio) or in the `describe` response headers (http) | on re-apply | `signal`, `putBlob`, http response post |

## Rules

| Rule | Enforcer |
|---|---|
| every field naming an Adapter id resolves to a Ready Adapter with the required Role | write path (`x-persimmon-adapter`) |
| `describe` at apply; `roles` ⊆ reported; the walk reads the cached digest | engine (`04-snapshot.md`) |
| secrets never in `spec`, `status`, snapshots, RunLog, or logs | CredentialStore; Adapter author |
| a call with an unknown or expired token is refused | engine |
| `signal` without `actor` is refused | engine |
| Global: no `namespace`; write needs `admin` grant | write path (`00-resource.md`) |

## Decisions

- `signal` is a Layer 0 callback with a long-lived adapter token; the Actor is asserted by
  the Adapter over its authenticated channel. Reference put `complete` in Layer 1 with no
  Layer 0 ingress.
- `putBlob` and `getBlob` replace `getRepresentation`; `log` takes text only, bytes go
  through `putBlob` (`05-revisioned-kind.md`).
- `describe` must return `protocol`, so a wrong-protocol Adapter fails at apply.
- The engine sets `payload.engine`, overwriting a supplied one. Reference had the Handler
  forward it.
- `callAdapter` gains an optional `deadline` (`03-reconcile.md`); absent means engine default.
- http long operations complete by POSTing to `engine.endpoint/responses`.
- stdio spawns one process per call; no resident-process liveness in the engine.
- `credentialBindings[0]` is the http bearer token.
- `status.describeDigest` stored beside `describe`. Adapter `status` is engine-written, and
  `Ready` lives in `status.conditions[]`; the reference kept conditions out of `status` for
  handled kinds (decision 32), an Adapter has no Handler.
- One process per call, so a resident process with liveness handling is roadmap.
- Conformance suite: the executor Role is `22-conformance.md`; the handler Role is roadmap (`91-roadmap.md`).
- stdio environment is an allowlist: `PATH`, `HOME`, `USER`, `LOGNAME`, `TMPDIR`, `LANG`,
  `NODE_PATH`, `NODE_OPTIONS`, then `spec.env`, bound credentials, minus any `PERSIMMON_*` name
  they carry, then the adapter token.
  `USER` is needed for macOS keychain logins. Found in implementation.
- Stream `log` lines are appended to the RunLog entry that issued the call, beside the `log`
  callback; `waiting` lines are not stored, the Handler owns `waitingReason`. Found in
  implementation.
- A `publishArtifact` the engine refuses (content, blob, shape) answers `400 invalid_input`,
  not `500`. Found in implementation.
- The callbacks socket moves to the temp directory, keyed by cwd, when the project path is too
  long for `sun_path`. Found in implementation.

## Examples

- [`examples/adapter-claude-code.yaml`](examples/adapter-claude-code.yaml): stdio Adapter,
  Role `executor`, Ready
- [`examples/adapter-http-handler.yaml`](examples/adapter-http-handler.yaml): http Adapter,
  Role `handler`
- [`examples/adapter-messages.yaml`](examples/adapter-messages.yaml): request, stream lines,
  response, error, http ack; validates against `#/$defs/Exchange`
- [`examples/adapter-callbacks.yaml`](examples/adapter-callbacks.yaml): one of each Engine
  callback; validates against `#/$defs/Callback`
