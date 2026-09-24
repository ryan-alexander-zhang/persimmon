# Roadmap

status: draft · What v1 leaves out, by layer, with the design file that defers it, or the reference item when no design file names it.

```text
v1        Layer 0 framework · Layer 1 core kinds · Layer 2 SDLC pack as a directory
next      composition kinds · deployment lifecycle · conformance suite · Layer 3 packaging
later     eager joins · retention policy · policy resource · external event sources
```

## Layer 0

| Item | Deferred by | Note |
|---|---|---|
| conformance suite for Handlers and Adapters | `02-handler.md`, `07-adapter.md` | statelessness, idempotency, security, secret hygiene |
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
| `tool` Executor type in the pack | `20-pack.md` | type exists; no reference Executor |
| context inheritance, agent profile bundling Executor + Prompts + Skills | `12-task.md` | compile-time sugar into per-Task context |
| named Workflow entrypoints compiled to sub-Workflows | `11-workflow.md` | |
| unified `reasoning.effort` hint translated by Adapters | `13-executor.md` | v1: adapter configuration |
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

## Layer 2

| Item | Deferred by | Note |
|---|---|---|
| composition kinds `Pipeline`, `ReviewLoop`, `Approval` | `20-pack.md` | need a Layer 0 compile hook; `repeat` + Gate cover v1 |
| deployment lifecycle: `Rollout`, `sdlc`, `research`, `engineering-iteration` Workflows | `20-pack.md` | Rollout semantics: DeploymentPlan, operationKey, fencingToken, rollback branches |
| traceability Validator, entity indexing, `implements-v1` / `verifies-v1`, `PlanTask`, `ImplementationReport` | `18-artifact.md`, `20-pack.md` | `list` callback already present |
| pack format: manifest, version, dependency resolution, `pack` verb | `20-pack.md` | v1: directory and `apply` |
| the remaining SDLC artifact kinds | `20-pack.md` | arrive with the Workflows that touch them |

## Layer 3

| Item | Note |
|---|---|
| packaging and installation of `KindDefinition` + `Handler` bundles | same registration path as Layer 1; needs versioning |
| user Roles for Adapters | mechanism exists (`x-persimmon-adapter: {roles}`); no packaging |

## Open before implementation

| Question | Current lean |
|---|---|
| implementation language | decided: TypeScript; `ajv` for JSON Schema 2020-12 |
| CEL library | decided: `@marcbachmann/cel-js`, checker covers static rule 11 (`10-ports.md`) |
| canonical serialization | decided: JSON, sorted keys, UTF-8, no whitespace (`04-snapshot.md`) |
| Skill digest for Git trees | Adapter contract (`15-prompt-skill.md`) |
| human Adapter for local mode | decided: one `cli-human/v1` Adapter, terminal prompt when a TTY is attached, file drop in `.persimmon/inbox/` otherwise (`20-pack.md`) |
