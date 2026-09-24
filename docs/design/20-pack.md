# Pack

status: draft · layer: 2 · schema: none; a Pack is a directory of ordinary Resource files

A Pack is a directory of Global definitions applied together and overridden by name in a
Namespace. The SDLC pack ships a working lifecycle built only from Layer 1 kinds; it adds no
kind, no manifest, no verb.

```text
packs/sdlc/global/*.yaml ──persimmon apply──▶ Global Resources (scope Any or Global)
packs/sdlc/namespaced/*.yaml ──persimmon apply -n demo──▶ Namespaced Resources (Triggers)
                                                             │
Namespace demo: Task research (override) ── shadows ──▶ Global Task research
WorkflowRun in demo ── snapshot walk resolves Namespace, then Global ──▶ closure holds the override
```

## Layout

| Path | Content |
|---|---|
| `global/NN-*.yaml` | Global definitions, multi-document files, applied in file-name order; the author orders dependencies |
| `namespaced/*.yaml` | Namespaced kinds (Triggers), applied with `-n <namespace>` by the operator |

## Lifecycle

| Action | Rule |
|---|---|
| install | `persimmon apply packs/sdlc/global/*.yaml`; needs the `admin` grant; local mode runs it at `persimmon init` |
| upgrade | `apply` again; SpecMutable definitions change in place, running runs keep their snapshot |
| Immutable members (artifact kinds, RelationTypes) | never change; a new version is a new name (`derived-from-v2`) |
| uninstall | `persimmon delete` per file in reverse order; refused while referenced (`00-resource.md`) |

## Override

A Namespaced Resource with the same kind and name shadows the Global one for every hop of a
snapshot walk rooted in that Namespace (`04-snapshot.md`). Overrides are ordinary `apply`.

| Rule | Enforcer |
|---|---|
| an override's input and output port names and types equal the shadowed definition's | static checker at admission |
| a Namespace that needs its own credentials overrides the Executor (`13-executor.md`) | convention |

## SDLC pack v1 content

| Kind | Backed by an example | Definition owed |
|---|---|---|
| Executor | `claude-agent`, `lint-script`, `product-reviewers` | |
| Prompt | `write-prd-template` | `code-agent` |
| Task | `research`, `write-prd`, `approve-prd` | `implement-task`, `security-review`, `product-review` |
| Validator | `prd-structure`, `prd-human-review`, `prd-security-scan` | |
| Gate | `prd-approval-gate` | |
| Workflow | `prd-create`, `prd-with-review`, `prd-approval` | `prd-review-round`, `planning-iteration` |
| Trigger (namespaced) | `on-prd-published`, `on-prd-approved` | |
| artifact kinds | `ResearchReport`, `ProductRequirement` | `ReviewReport` |
| RelationType | `derived-from-v1` | |

Credentials the pack Executors bind are Global names resolved at run time.

## Decisions

- No pack manifest, version, dependency resolution or `pack` verb: reference roadmap excluded
  a pack format from v1. A Pack is a directory and `apply`.
- No composition kinds. Reference planned `Pipeline`, `ReviewLoop`, `Approval` expanding to
  Workflows at snapshot time; `repeat` plus a Gate express both, and expansion would need a
  Layer 0 compile hook. Roadmap.
- Deployment out of the v1 lifecycle: no `Rollout`, no `sdlc`, `research`,
  `engineering-iteration` Workflows yet. Roadmap.
- Traceability Validator and entity indexing deferred; the `list` Engine callback stays for
  Relation queries by any Handler or Adapter.
- Artifact kinds cut from 14 to the 3 the shipped Workflows touch; `PlanTask`,
  `ImplementationReport`, `implements-v1`, `verifies-v1` arrive with the engineering Workflows.
- No reference `tool` Executor in the pack; the type and `subprocess/v1` support stay.
- Override must be port-compatible, so a run never breaks at snapshot time on a definition
  it did not name.

## Examples

- [`examples/pack-task-global.yaml`](examples/pack-task-global.yaml) and
  [`examples/pack-task-override.yaml`](examples/pack-task-override.yaml): a Global pack Task
  and its port-compatible Namespace override; both validate against `schemas/task.yaml`
- pack members: every example named in the content table
