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
Server mode (roadmap) runs the same engine under `persimmon serve`; the CLI talks https.

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
| `src/engine.ts` | `02-handler.md`, `08-store.md` | composition root: config, Store, registries, builtin Handlers, callbacks server, dispatcher |
| `src/handler/` | `02-handler.md` | write path: schema, static checker, Handler `validate`; `reconcile` dispatch; builtin registry |
| `src/checker/` | rules tables in `10`–`14`, `20` | throwaway-engine dry run of the write path for `persimmon validate`; rules live in kinds |
| `src/reconcile/` | `03-reconcile.md` | Event queue, Action apply, lease, atomic commit, retry, stalled |
| `src/snapshot/` | `04-snapshot.md` | closure walk, canonical bytes, digest |
| `src/reconcile/apply.ts` (`stageRevision`) | `05-revisioned-kind.md` | revision naming, Publication scope, representations; `src/store/` holds reservation and staging |
| `src/handler/write.ts` (`stampRevision`) | `05-revisioned-kind.md` | `persimmon create` of a revisioned Resource: identity, revision, provenance |
| `src/outbox/` | `06-outbox.md` | event shape, subscription match, causation chain, poller: claim, deliver as Signal, ack |
| `src/adapter/` | `07-adapter.md`, `19-adapter-roles.md` | `persimmon.adapter/v1` client: stdio and http transports, `describe`, Role payloads; Engine callbacks server; token scopes (persistence is TokenStore) |
| `src/conformance/` | `22-conformance.md` | the suite: fixture Task, rules E1–E15, the fake Engine callbacks server; `persimmon adapter test` and `test/adapters/conformance.test.ts` both call it |
| `src/authz.ts` (not created) | `08-store.md` Authentication and authorization | roadmap with server mode; local mode: the local Actor is admin |

### Kinds

One directory per Layer 1 design file. Each holds the kind's builtin Handler and the rules
the static checker calls.

| Directory | Design file |
|---|---|
| `src/kinds/deps.ts` | `02-handler.md` `HandlerDeps`: what a builtin Handler may touch |
| `src/kinds/ports/` | `10-ports.md` Port, PortType, Binding, RuntimeValue, well-known `$ref` |
| `src/kinds/workflow/` | `11-workflow.md` |
| `src/kinds/task/` | `12-task.md` |
| `src/kinds/executor/` | `13-executor.md` |
| `src/kinds/gate/` | `14-gate.md` Gate, Validator |
| `src/kinds/task/context.ts` | `15-prompt-skill.md` resolution; Prompt and Skill have no Handler |
| `src/kinds/trigger/` | `16-trigger.md` |
| `src/kinds/composition/` | `21-composition.md` Pipeline, Approval, ReviewLoop: `expand` and `validate` of the sugar kinds |
| `src/kinds/{workflow,task,gate}/handler.ts` | `17-runs.md` WorkflowRun, TaskRun, GateRun, ValidationRun Handlers |
| `src/kinds/core.ts` | `18-artifact.md` Relation and RelationType KindDefinitions; artifact kinds are pack content |

### Edges

| Path | Design file | Holds |
|---|---|---|
| `src/cli/` | `08-store.md` CLI verbs, `42-scaffold.md` | one file per verb or verb family; `index.ts` dispatches; `tree.ts` also renders the run tree `--follow` ends with; `new.ts` holds the Scaffold registry; no engine logic |
| `src/server/` | `25-ui.md`, `08-store.md` server Mode | the HTTP API over the Engine: artifacts by kind, one revision, create a revision, revisioned kinds; static files of `tools/`; `persimmon ui` binds it to loopback in local mode; server mode adds https and `server.auth.tokens[]` later |
| `packs/demo/global/`, `packs/demo/namespaced/` | `20-pack.md` | the demo pack, applied by hand: `global/` as Global, `namespaced/` into a Namespace |
| `packs/sdlc/files/` | `20-pack.md`, `23-pack-sdlc.md`, `35-build-process.md`, `38-autopilot.md` | project files `persimmon init` copies when absent: `AGENTS.md`, the `skills/` the Autopilot and Copilot are, linked into `.claude/skills/` and `.agents/skills/` |
| `packs/sdlc/global/` | `23-pack-sdlc.md`, `24-eventstorming.md`, `26-domain-discovery.md`, `27-spec-process.md`, `28-prd-process.md`, `29-design-process.md`, `30-plan-process.md`, `31-architecture-process.md`, `35-build-process.md` | the SDLC pack: artifact kinds, Prompts, Executors, Tasks, Validators, Gates, ReviewLoops, Workflows, the `domain-discovery` Pipeline, the `spec-all` Workflow, the `author-prd` ReviewLoop, the `architect` ReviewLoop, the `design-all` Workflow, the `plan-one` ReviewLoop and `plan-all` Workflow, the `build-one` ReviewLoop and `build-all` Workflow; applied by `persimmon init` |
| `packs/rewrite/global/` | `40-pack-rewrite.md` | the Rewrite pack: the `SourceInventory` and `ParityLedger` kinds, its Prompts, Tasks, Validators, Gates, ReviewLoops and Workflows; installed after the SDLC pack by `persimmon init --pack rewrite`, using the SDLC pack's definitions by name and redefining none |
| `packs/rewrite/files/` | `40-pack-rewrite.md`, `38-autopilot.md` | project files `init --pack rewrite` places after the SDLC pack's: `skills/rewrite`; no `AGENTS.md` |
| `adapters/<id>/` | `07-adapter.md`, `19-adapter-roles.md` | Adapters shipped with the binary: `adapter.yaml` manifest and a stdio script; `persimmon init` installs them before the pack |
| `adapters/<id>/conformance.mjs`, `adapters/lib/conformance.mjs` | `22-conformance.md` | the stub each shipped Adapter runs in place of its CLI under the suite |
| `adapters/eventstorming/` | `24-eventstorming.md` | evaluator Adapter `eventstorming/v1`: `evaluate` runs the event storming grammar over an `EventStorming` artifact and answers a ValidationResult; the first shipped evaluator Role |
| `adapters/sdd/` | `27-spec-process.md`, `28-prd-process.md`, `29-design-process.md`, `30-plan-process.md`, `31-architecture-process.md`, `35-build-process.md`, `39-test-process.md` | evaluator Adapter `sdd/v1`: `evaluate` checks a `Spec` against the Prd, DomainModel, Architecture and BusinessRules it cites, a `Prd` against its BusinessRules, a `Design` against the Architecture, DomainModel and BusinessRules, a `Plan` against its Spec, Architecture and Designs, an `AcceptanceRecord` against its TestOutcome, Plan and Spec (by case under a `TestDesign`), a `TestDesign` against its Spec, rules and `TestHarness`, a `TestHarness` against its seed runs, or an `Architecture` against the Prd, contexts, models, glossaries, rules and Adrs (`check.mjs`: `checkSpec`, `checkPrd`, `checkDesign`, `checkPlan`, `checkAcceptance`, `checkTestDesign`, `checkHarness`, `checkArchitecture`; `selectCases`, `buildReport` for `testdesign/v1`), and answers a ValidationResult; the pack's cross-artifact rules live here, not in `src/` |
| `adapters/testdesign/` | `39-test-process.md` | executor Adapter `testdesign/v1`, type `script`: runs no program; its `prepare` reads the bound artifacts through `getArtifact` and answers a build round's cases (`selectCases`) or a built Plan's `TestReport` (`buildReport`), both from `adapters/sdd/check.mjs` |
| `adapters/junit/` | `35-build-process.md`, `36-test-levels.md`, `39-test-process.md` | executor Adapter `junit/v1`: runs a project's test command in the workspace and answers a `TestOutcome` read from its JUnit XML (`read.mjs`) with `@xmldom/xmldom`, imported there and nowhere in `src/` |
| `adapters/parity/` | `40-pack-rewrite.md` | evaluator Adapter `parity/v1`: the Rewrite pack's checks (`check.mjs`), pure over a `SourceInventory`, the source index and the ledger; and `source.mjs`, the source index, imported by `parity-run/v1` |
| `adapters/parity-run/` | `40-pack-rewrite.md` | executor Adapter `parity-run/v1`, type `script`: `index-source`, `run-source`, `run-mutants`, `run-rewrite` and `compute-ledger`, the only code that reads the Source system's checkout; imports `adapters/parity/` as `testdesign/v1` imports `adapters/sdd/` |
| `adapters/designmd/` | `32-ui-design-process.md` | evaluator Adapter `designmd/v1`: `evaluate` runs the `@google/design.md` linter over a `DesignSystem`'s DESIGN.md and answers a ValidationResult; with `junit/v1`, the only shipped Adapters with a dependency beyond `yaml`, imported there and nowhere in `src/` |
| `tools/` | `24-eventstorming.md` | human-facing web surfaces, one directory per tool; a tool's pure model code lives beside its UI so Adapters can import it without a build |
| `tools/eventstorming/` | `25-ui.md` | the event storming editor: Vite + React + React Flow, built into `dist/tools/eventstorming/`, opened by `persimmon ui` at `/tools/eventstorming/`; reads and saves revisions through `src/server/` |
| `tools/eventstorming/grammar/` | `24-eventstorming.md` | the DSL v4.1 grammar as `.mjs` + `.d.ts`: element types, level gating, edge rules, context relationship types, `check(content)` findings; imported by `adapters/eventstorming/` and later by the editor |
| `tools/progress/` | `37-progress.md` | Progress: Vite + React + React Flow, built into `dist/tools/progress/`, opened by `persimmon ui` at `/tools/progress/`; a product's phases as a map, a run's rounds, artifacts as documents, the human gate's verdict through `src/server/` |
| `adapters/lib/` | `19-adapter-roles.md` executor Role | `agent.mjs`: the one process-per-attempt runner behind `claude-code/v1`, `codex/v1`, `subprocess/v1` and `junit/v1`; a driver supplies the command line, the stdin text and the result parser, and for `junit/v1` a `prepare` hook and `anyExit`; `skills.mjs`: the Skill bundle digest and fetch, imported by `src/cli/` too |
| `examples/<nn>/` | `20-pack.md` | teaching projects, one scenario each: hand-written definitions plus a `README.md` the user follows; `persimmon init` runs inside the directory, so its `.persimmon/` and `persimmon.yaml` are generated and ignored |
| `src/adapters.d.ts` | `15-prompt-skill.md` | types for the `adapters/lib/skills.mjs` import |
| `src/generated/` | `docs/design/schemas/` | `schemas.json`, written by `npm run gen`; never edited |
| `src/main.ts` | | entry point |

## Dependency direction

```text
cli, server ─▶ engine ─▶ store ─▶ base
                 ▲
kinds ───────────┘
```

`src/engine.ts` is the composition root: it wires the store, registries and kinds together.

| Rule | Design file |
|---|---|
| `base` imports nothing else in `src/` | |
| `store` imports `base`, plus `config.ts` types | `08-store.md` Store interface |
| `kinds` reaches state only through Engine callbacks and returned Actions; never `store` | `02-handler.md` |
| `kinds` imports `handler` for the contract, `expression` and `kinds/ports` for values; never `snapshot` or `outbox` values; type imports allowed, adapter types too | `04-snapshot.md`, `06-outbox.md` |
| `cli` and `server` hold no engine logic; `server` reaches the Store through the Engine and the `cli/create` path only | `08-store.md`, `25-ui.md` |
| `cli` and `conformance` import `adapters/lib/skills.mjs` for the Skill bundle digest and fetch, so the CLI, the suite and the Adapters share one implementation; no other `src/` → `adapters/` import | `15-prompt-skill.md`, `22-conformance.md` |
| `adapters/eventstorming` imports `tools/eventstorming/grammar`; no `src/` → `tools/` import | `24-eventstorming.md` |
| `adapters/sdd` imports nothing of `src/` or `tools/`: the Spec rules are a function of the artifacts in the payload | `27-spec-process.md` |
| `adapters/testdesign` and `adapters/junit` import `adapters/sdd/check.mjs` for the case rules (`selectCases`, `buildReport`, `carries`): one definition of which test runs which case | `39-test-process.md` |

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
| adapters | `test/adapters/` | shipped Adapters' runner, drivers, skills against stub binaries; `conformance.test.ts` runs the suite over every shipped Adapter |
| tools | `test/tools/`, `tools/*/src/**/*.test.ts` | a tool's pure model code: the grammar against the ported example models; the editor's layout and store logic without a DOM |

## Reading order

`src/resource/` → `src/kind-definition/` → `src/store/` → `src/reconcile/` → `src/handler/` →
`src/kinds/workflow/`.
