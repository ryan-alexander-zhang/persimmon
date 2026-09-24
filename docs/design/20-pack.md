# Pack

status: active · layer: 2 · schema: none; a Pack is a directory of ordinary Resource files

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
| `namespaced/*.yaml` | Namespaced kinds (Triggers); `persimmon init` applies them in `defaultNamespace`, another Namespace applies them with `-n <namespace>` |

## Lifecycle

| Action | Rule |
|---|---|
| install | `persimmon apply packs/sdlc/global/*.yaml --global` then `namespaced/*.yaml -n <namespace>`; needs the `admin` grant; local mode runs both at `persimmon init` |
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
| Executor | `claude-agent`, `lint-script`, `product-reviewers` | `local-reviewer` on `cli-human/v1` |
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
- Local mode human Executor: `cli-human/v1`, terminal prompt when a TTY is attached, file drop
  in `.persimmon/inbox/<taskRun>.yaml` completed by `persimmon complete <taskRun> --file`
  otherwise; `review-ui/v1` is server mode.
- Override port compatibility is checked by the Handler `validate` of Task, Gate, Validator and
  Workflow against the Global definition of the same name: same port names and types, same
  required-ness on inputs; code `override_incompatible`. The check runs when the override is
  written; a later change to the Global definition is not re-checked against its shadows. Found
  in implementation.
- Override must be port-compatible, so a run never breaks at snapshot time on a definition
  it did not name.
- `approve-prd` takes the security and product ReviewReports as optional inputs and context; the
  `reviews-in` Transition joins with `all` over Succeeded and Failed, so the human reads both
  reviews, a failed one omitted. The `cli-human/v1` form carries `reading[]`: every context
  entry with its content, fetched with the call token, so the form stands alone. Found in UAT.
- `persimmon init` also applies `namespaced/` into `defaultNamespace`: a user who ran `init` has a
  working loop without a path into the persimmon checkout. Found in UAT.
- `cli-human/v1` is the file drop; the terminal prompt is `persimmon complete <taskRun>` without
  `--file`, which reads the inbox form and asks one YAML answer per output port, validated
  against the port schema. A per-call Adapter process cannot own the terminal, so the prompt
  lives in the verb. The pack Gate uses `policy: all` over `prd-structure` and
  `prd-human-review`; `prd-security-scan` joins when `threat-model/v1` ships. Global pack
  Executors bind Global credential names (`github-token`, `registry-token`). Found in
  implementation.
- [`examples/pack-task-global.yaml`](examples/pack-task-global.yaml) and
  [`examples/pack-task-override.yaml`](examples/pack-task-override.yaml): a Global pack Task
  and its port-compatible Namespace override; both validate against `schemas/task.yaml`
- pack members: every example named in the content table
- `examples/<nn>/` are projects, not packs: hand-written definitions plus a `README.md` the user
  follows, `persimmon init` run inside the directory, generated state ignored. A pack is
  installed by `init`; an example is applied by the user, one scenario each. Found in UAT.
