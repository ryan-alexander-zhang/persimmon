# Roadmap

status: active · What v1 leaves out, by layer, with the design file that defers it, or the reference item when no design file names it.

```text
v1        Layer 0 framework · Layer 1 core kinds · Layer 2 SDLC pack as a directory
next      Layer 3 packaging · process packs (waterfall, spec-driven) designed on their own
later     eager joins · retention policy · policy resource · external event sources
```

## Layer 0

| Item | Deferred by | Note |
|---|---|---|
| conformance rules for the handler Role | `02-handler.md`, `22-conformance.md` | executor and evaluator Roles covered by `persimmon adapter test`; statelessness, declared Actions only, no-op after terminal wait for an Adapter with the handler Role |
| server HTTP API specification | `08-store.md` | v1: the CLI verb set over https |
| OIDC or other authentication beyond bearer tokens | `08-store.md` | |
| authorization policy as a Resource | `08-store.md` | v1: grant table in `persimmon.yaml` |
| resident stdio Adapter processes | `07-adapter.md` | v1: one process per call |
| Adapter sandboxing in server mode | reference open question 4 | |
| TLS termination upstream of `persimmon serve` | `08-store.md` | v1: TLS mandatory in the daemon |
| retention and deletion policy for unreferenced revisions | `18-artifact.md` | |
| eager `any` / `quorum` joins with cancellation of the rest | `11-workflow.md`, `14-gate.md` | Transitions and Gate policy |
| cross-Namespace references | `04-snapshot.md` | walk never crosses a Namespace |
| garbage collection, cascading delete | `00-resource.md` | |

## Layer 1

| Item | Deferred by | Note |
|---|---|---|
| `tool` Executor type in the pack | `20-pack.md` | Adapter exists (`subprocess/v1`); no pack Executor |
| context inheritance, agent profile bundling Executor + Prompts + Skills | `12-task.md` | compile-time sugar into per-Task context |
| named Workflow entrypoints compiled to sub-Workflows | `11-workflow.md` | |
| unified `reasoning.effort` hint translated by Adapters | `13-executor.md` | v1: each Adapter's `parametersSchema` |
| Gate-level score aggregation | `14-gate.md` | |
| user-defined shared value schemas beyond the well-known `$ref`s | `10-ports.md` | |
| ObjectRef PortType | `16-trigger.md` | dropped `fromEvent: run`; runs read `spec.origin` |
| external event sources and webhooks as Trigger inputs | `16-trigger.md` | v1: engine-produced Outbox events only |
| `human` completion form rendering standard | `19-adapter-roles.md` | v1: Adapter renders from `task.outputSchemas` |
| web, chat and email approval clients | `19-adapter-roles.md` | Adapters outside this design |
| standalone ValidationRun without a GateRun | `14-gate.md` | |
| Relations asserted by builtin Handlers | `18-artifact.md` | v1: users and pack kinds |
| artifact scope, internal versus exported | `18-artifact.md` | cut; Workflow output contracts encapsulate |
| fork and time travel of runs | reference roadmap | runs are immutable; new run with chosen inputs |
| Skill digest verified at apply | `15-prompt-skill.md` | v1: `skill install` and every attempt verify; no engine-side check |
| Executor-level workspace cap | `12-task.md` | v1: the workspace is the Task's |
| Executor-level Skills | `12-task.md`, `15-prompt-skill.md` | v1: a Task lists its Skills as context |
| scripts reading artifact content through the Engine callback | `19-adapter-roles.md` | v1: `subprocess/v1` passes references; `fromEvent: content.<path>` binds values (`examples/example03`) |
| per-run `resultFile` | `19-adapter-roles.md` | v1: one path per Executor; runs sharing it stay sequential (`examples/example03`) |

## Layer 2

| Item | Deferred by | Note |
|---|---|---|
| pack format: manifest, version, dependency resolution, `pack` verb | `20-pack.md` | v1: directory and `apply` |
| tester as its own Task, apart from the coder | `examples/example04` | v1: the coder writes its tests; a Validator reads them |
| the SDLC pack on `codex/v1`: an open object with no `properties` (`references[].locator`, the DMN `decision` map) is not closed by the codex Adapter's strict rewrite, and OpenAI strict mode refuses it | `29-design-process.md` | the pack binds claude-code Executors only; close property-less objects in the rewrite when a codex Executor is bound |
| a listing of the `D-n` no Issue cites | `35-build-process.md` | v1: the `defect-reported` warning is the only reminder; nothing makes a reported defect become an Issue |
| one defect reported by several records merged | `35-build-process.md` | v1: each record of a `build-all` reports the same old red test again; the human writes one Issue |
| an Issue's `blocks`, `found` and `fixedBy` resolved against the store | `35-build-process.md` | v1: schema only; the Issue is written by hand, outside any Gate |

## Layer 3

| Item | Design file | Note |
|---|---|---|
| packaging and installation of `KindDefinition` + `Handler` bundles | `01-kind-definition.md` | same registration path as Layer 1; needs versioning |
| user Roles for Adapters | `07-adapter.md` | mechanism exists (`x-persimmon-adapter: {roles}`); no packaging |
| server mode: `persimmon serve`, https API, Postgres Store, bearer auth and grants, http Adapter `/responses` | `08-store.md`, `07-adapter.md`, `25-ui.md` | local mode only in the first build; `persimmon ui` serves the JSON routes on loopback without https or tokens |
| `stepContract` child spec shape | `01-kind-definition.md`, `11-workflow.md` | engine knows the three core run kinds |
| `describe` at every snapshot resolution | `04-snapshot.md` | cached digest checked instead |
| `secretManager` credential source | `08-store.md` | server mode |
| `security.networkAccess` and `allowedHosts` enforced by the agent Adapters | `13-executor.md` | declarative today; needs a sandbox the CLIs do not expose |
| the verification layer of the SDLC pack: `TestCase` (`verifies[] {kind: AC\|FR\|BR\|QS, ref}`, steps, assertions, `executionMode`), `TestRun` (build, environment, time), `TestResult` (one per executed case and data set, evidence), `TestReport` (runs, coverage split into requirements, execution and verification, defects, quality gate); a scenario and a test case are N:M; a Spec cites none of them | `23-pack-sdlc.md`, `27-spec-process.md` | the Spec's `AC-n`, `FR-n` and the rules' `BR-n` are the ids it will cite; nothing verifies yet |
| fired Transitions recorded in `WorkflowRun.status` | `11-workflow.md` | derived from step runs |
| `allowedHosts` enforcement and a network switch for `claude-code/v1` | `19-adapter-roles.md` | agent runs with the CLI's own sandbox; codex has the on/off switch |

## Open before implementation

| Question | Current lean |
|---|---|
| implementation language | decided: TypeScript; `ajv` for JSON Schema 2020-12 |
| CEL library | decided: `@marcbachmann/cel-js`, checker covers static rule 11 (`10-ports.md`) |
| canonical serialization | decided: JSON, sorted keys, UTF-8, no whitespace (`04-snapshot.md`) |
| human Adapter for local mode | decided: `cli-human/v1` is a file drop in `.persimmon/inbox/`; `persimmon complete` prompts at the terminal, `--file` for scripts (`20-pack.md`) |
| a migration of committed revisions when a revisioned kind's schema changes incompatibly | `01-kind-definition.md` | `apply` takes a schema change only where every committed revision still validates; an incompatible one still needs a fresh project |
