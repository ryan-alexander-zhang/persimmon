# Architecture

Map of the code. What the model is lives in `docs/design/`; this file says where each part
of it lives in `src/` and which way dependencies point. Terms per `CONTEXT.md`.

```text
persimmon binary                                  outside the binary
┌────────────────────────────────────────────┐
│ cli ─▶ engine ─▶ store ─▶ SQLite | Postgres │
│          │                                  │    Adapter
│          ├─▶ builtin Handlers (in process)  │    ├─ stdio: subprocess per call
│          └─▶ adapter client ────────────────┼──▶ └─ http: remote endpoint
│          ◀── Engine callbacks server ───────┼─── (unix socket | https)
└────────────────────────────────────────────┘
```

One binary. Local mode runs the engine inside every CLI verb; exit behavior per `08-store.md`.
Server mode runs the same engine under `persimmon serve`; the CLI talks https.

## Layout

One package, ESM, TypeScript strict, Node ≥ 22.5 (`node:sqlite`). One directory per design
file, named after the file; a directory that holds several kinds is named after the file too.

### Base

| Directory | Design file | Holds |
|---|---|---|
| `src/resource/` | `00-resource.md` | envelope types, Reference shapes, audit record |
| `src/kind-definition/` | `01-kind-definition.md` | KindDefinition registry, `ajv` compile with `x-persimmon-*` keywords, mutability check |
| `src/expression/` | `10-ports.md` expression profile | CEL environment per site, static check, evaluate; used by `subscriptions[].filter` too |

### Store

| Directory | Design file | Holds |
|---|---|---|
| `src/store/` | `08-store.md` | Store interface: ResourceStore, RunLog, SnapshotStore, BlobStore, Outbox, TimerStore, LeaseStore, TokenStore, AuditLog, CredentialStore with `env`, `file`, `keychain` sources; SQLite implementation; Postgres later |
| `src/config.ts` | `08-store.md` Engine config | `persimmon.yaml` load, defaults, config validator |

### Engine

| Directory | Design file | Holds |
|---|---|---|
| `src/handler/` | `02-handler.md` | write path: schema, static checker, Handler `validate`; `reconcile` dispatch; builtin registry |
| `src/checker/` | rules tables in `10`–`14`, `20` | static checker; run by the write path and by `persimmon validate` |
| `src/reconcile/` | `03-reconcile.md` | Event queue, Action apply, lease, atomic commit, retry, stalled |
| `src/snapshot/` | `04-snapshot.md` | closure walk, canonical bytes, digest |
| `src/reconcile/apply.ts` (`stageRevision`) | `05-revisioned-kind.md` | revision naming, Publication scope, representations; `src/store/` holds reservation and staging |
| `src/outbox/` | `06-outbox.md` | event shape, subscription match, causation chain, poller: claim, deliver as Signal, ack |
| `src/adapter/` | `07-adapter.md`, `19-adapter-roles.md` | `persimmon.adapter/v1` client: stdio and http transports, `describe`, Role payloads; Engine callbacks server; token scopes (persistence is TokenStore) |
| `src/authz.ts` | `08-store.md` Authentication and authorization | roadmap with server mode; local mode: the local Actor is admin |

### Kinds

One directory per Layer 1 design file. Each holds the kind's builtin Handler and the rules
the static checker calls.

| Directory | Design file |
|---|---|
| `src/kinds/ports/` | `10-ports.md` Port, PortType, Binding, RuntimeValue, well-known `$ref` |
| `src/kinds/workflow/` | `11-workflow.md` |
| `src/kinds/task/` | `12-task.md` |
| `src/kinds/executor/` | `13-executor.md` |
| `src/kinds/gate/` | `14-gate.md` Gate, Validator |
| `src/kinds/task/context.ts` | `15-prompt-skill.md` resolution; Prompt and Skill have no Handler |
| `src/kinds/trigger/` | `16-trigger.md` |
| `src/kinds/{workflow,task,gate}/handler.ts` | `17-runs.md` WorkflowRun, TaskRun, GateRun, ValidationRun Handlers |
| `src/kinds/core.ts` | `18-artifact.md` Relation and RelationType KindDefinitions; artifact kinds are pack content |

### Edges

| Path | Design file | Holds |
|---|---|---|
| `src/cli/` | `08-store.md` CLI verbs | one file per verb; no engine logic |
| `src/server/` | `08-store.md` server Mode | roadmap: `persimmon serve`, https API, `server.auth.tokens[]` |
| `packs/sdlc/global/`, `packs/sdlc/namespaced/` | `20-pack.md` | pack files; `persimmon init` applies `global/` |
| `adapters/<id>/` | `07-adapter.md`, `19-adapter-roles.md` | Adapters shipped with the binary: `adapter.yaml` manifest and a stdio script; `persimmon init` installs them before the pack |
| `adapters/lib/` | `19-adapter-roles.md` executor Role | `agent.mjs`: the one process-per-attempt runner behind `claude-code/v1`, `codex/v1` and `subprocess/v1`; a driver supplies the command line, the stdin text and the result parser |
| `examples/<nn>/` | `20-pack.md` | teaching projects, one scenario each: hand-written definitions plus a `README.md` the user follows; `persimmon init` runs inside the directory, so its `.persimmon/` and `persimmon.yaml` are generated and ignored |
| `src/generated/` | `docs/design/schemas/` | `schemas.json`, written by `npm run gen`; never edited |
| `src/main.ts` | | entry point |

## Dependency direction

```text
cli, server ─▶ engine ─▶ store ─▶ base
                 ▲
kinds ───────────┘
```

| Rule | Design file |
|---|---|
| `base` imports nothing else in `src/` | |
| `store` imports `base` only | `08-store.md` Store interface |
| `kinds` reaches state only through Engine callbacks and returned Actions; never `store` | `02-handler.md` |
| `kinds` imports `handler` for the contract, `expression` and `kinds/ports` for values; never `snapshot` or `outbox` | `04-snapshot.md`, `06-outbox.md` |
| `cli` and `server` hold no engine logic | `08-store.md` |

## Schemas

`docs/design/schemas/*.yaml` is the source. `npm run gen` (`scripts/gen-schemas.mjs`) copies
them into `src/generated/schemas.json`, keyed by file name, so relative `$ref` values resolve
by key; `pretest` and `prebuild` run it. The binary never reads `docs/`. TypeScript types are
hand-written until a generator earns its place.

## Dependencies

Each row is a decision (`AGENTS.md` §2).

| Need | Choice | Compared | Why |
|---|---|---|---|
| JSON Schema 2020-12 | `ajv` via `ajv/dist/2020` plus `ajv-formats` for `date-time`, `uri`; `x-persimmon-*` declared as keywords | `@hyperjump/json-schema`, `@cfworker/json-schema` | compiled validator, widest use; `$dynamicRef` partial, not used by the design |
| CEL | `@marcbachmann/cel-js` | `cel-js`, `@bufbuild/cel` | only one with a working static checker (`10-ports.md`) |
| YAML | `yaml` | `js-yaml` | source positions on every node, so `persimmon validate` reports lines; both default to YAML 1.2 |
| SQLite | `node:sqlite` | `better-sqlite3` | stdlib, synchronous, transactions; no native build |
| CLI parsing | `node:util` `parseArgs` | `commander`, `yargs` | stdlib covers the verb set |
| tests | `vitest` | `node:test` | watch mode, TypeScript native; both have fake timers |
| build | `tsc` | `tsup`, `esbuild` | one compiler, type check and emit in one step |

Postgres driver, https server framework: chosen with server mode.

## Tests

| Kind | Where | Checks |
|---|---|---|
| unit | `src/**/*.test.ts` beside the code | one behavior per file |
| examples | unit tests beside each module | design examples drive the module tests; `persimmon validate` covers the DSL |
| scenario | `test/scenario/` | a Workflow runs end to end on SQLite with a fake Adapter |

## Reading order

`src/resource/` → `src/kind-definition/` → `src/store/` → `src/reconcile/` → `src/handler/` →
`src/kinds/workflow/`.
