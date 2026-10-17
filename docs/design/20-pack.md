# Pack

status: active · layer: 2 · schema: none; a Pack is a directory of ordinary Resource files

A Pack is a directory of Global definitions applied together and overridden by name in a
Namespace. Two ship: the SDLC pack (`packs/sdlc/`, `23-pack-sdlc.md`), the default flow
`persimmon init` applies, and the demo pack (`packs/demo/`), a PRD lifecycle applied by hand that
proves the mechanics below. Both are built only from Layer 1 kinds; a pack adds no kind, no
manifest, no verb.

```text
packs/demo/global/*.yaml ──persimmon apply──▶ Global Resources (scope Any or Global)
packs/demo/namespaced/*.yaml ──persimmon apply -n team-a──▶ Namespaced Resources (Triggers)
                                                             │
Namespace team-a: Task research (override) ── shadows ──▶ Global Task research
WorkflowRun in team-a ── snapshot walk resolves Namespace, then Global ──▶ closure holds the override
```

## Layout

| Path | Content |
|---|---|
| `global/NN-*.yaml` | Global definitions, multi-document files, applied in file-name order; the author orders dependencies |
| `namespaced/*.yaml` | Namespaced kinds (Triggers); applied with `-n <namespace>`; `persimmon init` does this into `defaultNamespace` only for the pack it installs |
| `files/*` | project files: `persimmon init` copies each into the project directory when no file of that name is there, and updates one it wrote that nobody edited; never applied, never stored |

## Lifecycle

| Action | Rule |
|---|---|
| install | `persimmon apply packs/demo/global/*.yaml --global` then `namespaced/*.yaml -n <namespace>`; needs the `admin` grant; local mode runs this for the SDLC pack at `persimmon init` (`global/` only, it has no `namespaced/`) |
| upgrade | `apply` again; SpecMutable definitions change in place, running runs keep their snapshot |
| Immutable members (artifact kinds, RelationTypes) | never change; a new version is a new name (`derived-from-v2`) |
| uninstall | `persimmon delete` per file in reverse order; refused while referenced (`00-resource.md`) |

## Override

A Namespaced Resource with the same kind and name shadows the Global one for every hop of a
snapshot walk rooted in that Namespace (`04-snapshot.md`). Overrides are ordinary `apply`.

| Rule | Enforcer |
|---|---|
| an override's input and output port names and types equal the shadowed definition's | static checker at admission |
| `init` places the files after the pack applied, so a pack that fails leaves none; only regular files, no dotfile; it records the digest of each file it writes in `.persimmon/files.json`; a file present that still has that digest is replaced by a newer pack's and reported `updated <file>`; any other file present, a dangling symlink too, is never overwritten: kept and reported `kept <file>`, with `(differs from the pack's: <path>)` when a regular file's content is not the pack's; a file equal to the pack's but unrecorded (a fresh clone, `.persimmon/` being ignored) is recorded; `CLAUDE.md` becomes a symlink to `AGENTS.md` only when `init` writes `AGENTS.md` where none was and no `CLAUDE.md` is there, never on an update, and a `CLAUDE.md` of the project's is reported as not linked; `.persimmon/` is appended to `.gitignore`, created when absent, unless a line already names it | `persimmon init` |
| a Namespace that needs its own credentials overrides the Executor (`13-executor.md`) | convention |

## Demo pack content

| Kind | Shipped (`packs/demo/`) | Not yet |
|---|---|---|
| Executor | `claude-agent`, `local-reviewer` on `cli-human/v1` | `product-reviewers` |
| Prompt | `write-prd-template` | `code-agent` |
| Task | `research`, `write-prd`, `approve-prd`, `security-review`, `product-review` | `implement-task` |
| Validator | `prd-structure`, `prd-human-review` | `prd-security-scan` |
| Gate | `prd-approval-gate` | |
| Workflow | `prd-create`, `prd-approval` | `prd-with-review`, `prd-review-round`, `planning-iteration` |
| Trigger (namespaced) | `on-prd-published` | `on-prd-approved` |
| artifact kinds | `ResearchReport`, `ProductRequirement`, `ReviewReport` | |
| RelationType | `derived-from-v1` | |

Credentials the pack Executors bind are Global names resolved at run time.

## Decisions

- `apply --global` of a changed pack definition is `updated`, not `exists with a different
  spec`: for a kind of scope Any the engine looked the doc up in the default Namespace, missed
  the Global one and fell into create. The lookup now mirrors placement: a doc without a Namespace
  is the Global resource unless its kind is Namespaced, so a Namespaced override of a name the pack
  adds later is left alone. The update runs the Handler's validate as create does, so an upgrade
  never stores a definition create would refuse. Every UAT project since the Spec unit was a fresh
  one because of this. Found in UAT.

- The spec-driven pack is `packs/sdlc`, the default flow `persimmon init` applies; the PRD
  lifecycle it was built beside is `packs/demo`, applied by hand by the examples that drive
  `prd-create`. Until then `init` installed the demo lifecycle and the real process was applied
  by hand under the name AI Native pack. Found in UAT.
- No pack manifest, version, dependency resolution or `pack` verb: reference roadmap excluded
  a pack format from v1. A Pack is a directory and `apply`.
- Composition kinds `Pipeline`, `ReviewLoop`, `Approval` ship with the engine, not the pack
  (`21-composition.md`): a pack ships YAML and cannot ship a Handler. The pack's Workflows stay
  raw Workflows; a Pipeline version is an example, not pack content.
- Deployment out of the v1 lifecycle: no `Rollout`, no `sdlc`, `research`,
  `engineering-iteration` Workflows. Not planned: the shipped pack is the engine's demo and
  teaching vocabulary; delivery processes (waterfall, spec-driven) are designed as packs of
  their own. Found in UAT.
- Traceability Validator and entity indexing deferred; the `list` Engine callback stays for
  Relation queries by any Handler or Adapter.
- Artifact kinds cut from 14 to the 3 the shipped Workflows touch; `PlanTask`,
  `ImplementationReport`, `implements-v1`, `verifies-v1` arrive with the engineering Workflows.
- No reference `tool` Executor in the pack; the type and `subprocess/v1` support stay.
- Local mode human Executor: `cli-human/v1`, terminal prompt when a TTY is attached, file drop
  in `.persimmon/inbox/<taskRun>.yaml` completed by `persimmon complete <taskRun> --file`
  otherwise; `review-ui/v1` is server mode (superseded below).
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
  working loop without a path into the persimmon checkout. Found in UAT. Superseded by the rename
  below: `init` installs the SDLC pack, and the demo loop is applied from the checkout.
- `cli-human/v1` is the file drop; the terminal prompt is `persimmon complete <taskRun>` without
  `--file`, which reads the inbox form and, per output port, asks y/n then findings for a
  ValidationResult port and edits a YAML example for any other, validated against the port
  schema. A per-call Adapter process cannot own the terminal, so the prompt lives in the verb. The pack Gate uses `policy: all` over `prd-structure` and
  `prd-human-review`; `prd-security-scan` joins when `threat-model/v1` ships. Global pack
  Executors bind Global credential names (`github-token`, `registry-token`). Found in
  implementation.
- `examples/<nn>/` are projects, not packs: hand-written definitions plus a `README.md` the user
  follows, `persimmon init` run inside the directory, generated state (`.persimmon/`, `persimmon.yaml`, the
  pack's files, `.gitignore`) ignored by the checkout's `.gitignore`. The SDLC pack is
  installed by `init`; the demo pack and the examples are applied by the user, one scenario each. Found in UAT.
- Pack content matches the shipped Adapters: `retryOn` names `timeout`, `agent_failed`,
  `transient_network` (no Adapter emits `rate_limit`); `lint-script` is dropped, its
  `./scripts/lint.sh` never shipped; `research` declares `workspace: {input: repository}`, else its
  `file` context read the project's README instead of the repository's. Found in UAT.
- A pack ships project files in `files/`, which `init` copies when absent: the rules a project's
  agents read belong with the process that defines the artifacts, and `init` had created no
  `.gitignore`, so `.persimmon/` was committed unless the user knew to ignore it. `init` creates no
  git repository: persimmon runs in existing repositories too. Found in design review.
- `init` updates a project file it wrote and nobody edited: it re-applies a newer pack, so a kept
  file left the project's agents on the old rules with no sign, and an agent following an outdated
  "ask" fails with no output. The digest of what it wrote tells an untouched file from an edited
  one; an edited one is kept and reported as differing, never merged. A 3-way merge (`ainpt
  update`) was weighed and refused: a base copy, a `git` dependency and conflict markers for a file
  a user rarely edits. An unreadable record is empty, so every file is kept; a record entry for a
  file the pack dropped stays, harmless; the record is written only when it changes. An update
  restores no `CLAUDE.md` link: a user who removed it chose to. Found in audit.
- Known limit: `.persimmon/` is ignored by git, so a fresh clone has no record; an AGENTS.md an
  older pack wrote is then kept and reported as differing, not updated. Matching the digests of
  every earlier shipped version would close it; the notice tells the user meanwhile. Found in
  audit.

## Examples

- [`examples/pack-task-global.yaml`](examples/pack-task-global.yaml) and
  [`examples/pack-task-override.yaml`](examples/pack-task-override.yaml): a Global pack Task
  and its port-compatible Namespace override; both validate against `schemas/task.yaml`
- pack members: the files under `packs/demo/`, the Shipped column of the content table
