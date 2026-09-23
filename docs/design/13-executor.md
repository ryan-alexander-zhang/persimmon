# Executor

status: draft · layer: 1 · schema: [`schemas/executor.yaml`](schemas/executor.yaml)

A Definition kind naming who does a Task: an Adapter with Role `executor`, its opaque
configuration, and the security envelope for every attempt.

```text
Task ── executorRef ──▶ Executor {type, adapter, configuration, security}
                             │ adapter (x-persimmon-adapter, roles: [executor])
                             ▼
                        Adapter claude-code/v1 ── describe ──▶ executorTypes, configurationSchema, parametersSchema,
                             │                                 contextKinds, skillFormats, supports, formRenderable (19-adapter-roles.md)
                             │ per attempt: execute payload {executor, parameters, credentials, deadline, engine}
                             ▼
                        agent | script | tool | human
```

## Spec

| Field | Rule |
|---|---|
| `type` | `agent` \| `script` \| `tool` \| `human` |
| `adapter` | Adapter id (`x-persimmon-adapter: {roles: [executor]}`) |
| `configuration` | object, default `{}`; opaque to the engine; model, effort, sandbox, approval group, program live here |
| `security` | default `{networkAccess: deny}` |
| `security.networkAccess` | `deny` \| `allowlist` |
| `security.allowedHosts[]` | hostname with optional `:port`; no scheme, path or wildcard; with `allowlist` only |
| `security.credentialBindings[]` | credential names, Global or `<namespace>/<name>` (`08-store.md`); never secrets |

`configuration` and `Task.action.parameters` are disjoint blocks of the execute payload; the
engine never merges them. Adapter-level `credentialBindings` (`07-adapter.md`) authenticate
the Adapter process; Executor-level ones are per-attempt secrets for the work.

## Per attempt

| Step | Who |
|---|---|
| resolve every `credentialBindings` name, at every attempt | engine, CredentialStore |
| pass `{type, configuration, security}` and `credentials {name: secret}` in the `execute` payload | engine |
| honour `networkAccess`, `allowedHosts`, the deadline; never persist or log secrets | Adapter |
| `credentials` absent from RunLog, snapshots, logs | engine |

## Rules

| Rule | Enforcer |
|---|---|
| `adapter` reachable and Ready with Role `executor` | `validate` warns `adapter_unavailable`; `apply` fails unless `--skip-adapter-validation`; snapshot walk always fails (`04-snapshot.md`) |
| `type` ∈ `describe.executorTypes`; `configuration` validates against `describe.configurationSchema`; `security` well-formed | `executor` handler `validate` |
| `type: human` ⇒ `describe.supports.complete` | `executor` handler `validate` |
| every credential name is Global or in this Executor's Namespace; a Global Executor binds Global names only | static checker (`08-store.md`) |
| `describe` digest recorded in the snapshot | snapshot walk |

## Decisions

- `allowedOperations` and `validateConfig` dropped. Reference listed both; neither had a
  consumer beyond what `describe.configurationSchema` gives. `CONTEXT.md` updated.
- `configuration` and `action.parameters` never merge; a key in both is two keys.
- `security` absent means `networkAccess: deny`.
- Credentials resolve per attempt, so rotation applies to the next attempt.
- Executor is `scope: Any`; a Namespace that wants a pack Executor with its own credentials
  overrides it by name.
- `contextKinds` and `skillFormats` are checked on the Task (`12-task.md`), not here.
- `formRenderable` and the human completion contract are owned by `19-adapter-roles.md`.

## Examples

- [`examples/executor-claude-agent.yaml`](examples/executor-claude-agent.yaml): agent
  Executor; also frozen in `snapshot-closure.yaml`
- [`examples/executor-product-reviewers.yaml`](examples/executor-product-reviewers.yaml):
  human Executor on `review-ui/v1` (`examples/adapter-review-ui.yaml`)
- [`examples/executor-lint-script.yaml`](examples/executor-lint-script.yaml): script
  Executor on `subprocess/v1` (`examples/adapter-subprocess.yaml`), network denied
