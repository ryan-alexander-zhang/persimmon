# Domain discovery

status: draft · layer: 2 (`23-pack-ai-native.md`, `24-eventstorming.md`) · schema: the `DomainModel` kind in `packs/ai-native/global/10-artifact-kinds.yaml`

From a Prd to the domain kinds: an agent runs the event storming session phase by phase, a
human confirms each phase in the editor, and the design-level model is projected into one
`BoundedContext`, `Glossary` and `DomainModel` per storming context. Pack content only
(`20-pack.md`): Prompts, Tasks, Validators, Gates, ReviewLoops, Workflows, one Pipeline.

```text
Pipeline domain-discovery
  bigPicture: ReviewLoop storm-big-picture ─┐ produce: Task event-storm (level literal)
  process:    ReviewLoop storm-process      ├ review:  Gate storming-gate = Validator eventstorming-grammar (level) + storming-confirmed (human)
  design:     ReviewLoop storm-design      ─┘ previous and feedback fed back; base = the phase before
  derive:     Workflow derive-all: repeat over the design phase's `contexts` ─▶ Workflow derive-one per context
                 derive: Task derive-domain ─▶ BoundedContext, Glossary, DomainModel
                 check:  Gate derived-gate = Validator domain-consistency (eventstorming/v1, two artifacts)
```

## `DomainModel`

One per `BoundedContext`, derived from a design-level `EventStorming`. Names are the storming
labels unchanged; attributes are Glossary fact type names, so the Glossary stays the only place a
thing is defined.

| Field | Content |
|---|---|
| `context`, `source` | the BoundedContext id; the EventStorming id (the revision is provenance) |
| `aggregates[]` | `{id AG-n, name, root, entities[] {name, attributes[]}, valueObjects[], commands[], events[], invariants[] {statement, rules?}}`; `commands` are the labels `handledBy` it, `events` the labels it `emits`, invariants the `rule` of the constraints on its commands |
| `events[]` | `{name, pivotal?, temporal?, attributes?}`, every domain event of the context |
| `policies[]` | `{id POL-n, name, when[], then[], condition?, execution, parameters?}` from `triggers` and `invokes` |
| `readModels[]` | `{name, informs[], updatedBy?, fields[]}` from `informs` and `updates` |
| `externalSystems[]` | `{name, issues?, handles?, emits?}`, every external system with an edge into or out of the context |

## Process

| Member | Content |
|---|---|
| Prompts `storming-dsl`, `storming-big-picture`, `storming-process`, `storming-design`, `derive-domain-rules` | the old tool's skill references as Prompt text; the design Prompt carries the context map |
| Task `event-storm` | inputs `prd`, `level`, `base` (the phase before), `previous` (this phase's last round), `feedback`; outputs `model`, `contexts` (the ids in order); an unknown is a hotspot, never a question |
| Task `confirm-storming` | human on `cli-human/v1`: open the model in `persimmon ui`, approve or reject with one finding per node, edge or context |
| Validators | `eventstorming-grammar` with `level`; `storming-confirmed` over `confirm-storming`; `domain-consistency`: `eventstorming/v1` with `model`, `domainModel` and `context`, the grammar's `checkDerived` |
| Gates | `storming-gate` (grammar and confirmed, `all`); `derived-gate` (consistency) |
| ReviewLoops `storm-big-picture`, `storm-process`, `storm-design` | `produce` `event-storm` with the level as a literal, `review` `storming-gate`, `maxRounds: 3`; `process` and `design` take `base` from the phase before |
| Task `derive-domain` | inputs `model`, `contextId`, `prd`; outputs `context`, `glossary`, `domainModel`; a projection, invents nothing |
| ReviewLoop `derive-one` | `produce` `derive-domain`, `review` `derived-gate`, `maxRounds: 2`; the consistency findings go back as `feedback` with the last `domainModel` as `previous` |
| Workflow `derive-all` | `repeat` over `contexts`: state `index` only, body `contextId: {expression: "inputs.contexts[state.index - 1]"}`, `until: !iteration.outputs.passed || iteration.index >= inputs.contexts.size()`; a context the loop could not derive ends the run `derivation_inconsistent` |
| Pipeline `domain-discovery` | the three loops then `derive-all`; a loop phase routes on its `passed` (`21-composition.md`), so an exhausted phase ends the run `<phase>_rejected`; outputs `model` and `derived` |

Two Layer 1 changes this needed, each its own unit: `state.<var>` readable in expressions inside
`repeat` (`10-ports.md`, `11-workflow.md`), and a ReviewLoop surfacing every `produce` output
(`21-composition.md`), so the design loop hands `contexts` on.

## `checkDerived`

`tools/eventstorming/grammar` `checkDerived(model, domainModel, context)`, run by `eventstorming/v1`
when `artifacts.domainModel` is present; `passed` iff no error. Labels compare exactly.

| Severity | Codes |
|---|---|
| error | `derived-source-level`, `derived-unknown-context` (also when the Validator's `context` input is unbound), `derived-missing-aggregate`, `derived-extra-aggregate`, `derived-command-mismatch`, `derived-event-mismatch`, `derived-missing-event`, `derived-extra-event`, `derived-event-flag`, `derived-policy-mismatch`, `derived-readmodel-mismatch`, `derived-external-mismatch` |
| warning | `derived-invariant-unsourced`, `derived-unused-constraint` |

## Rules

| Rule | Enforcer |
|---|---|
| a phase's model has `meta.level` at least the phase's; the grammar Validator takes the level from the Gate | `storming-gate` |
| the agent asks nothing: an unknown is a hotspot with kind and priority; the human gate is where questions are answered | Prompts; `confirm-storming` |
| a derivation is a projection: every name a storming label, every relation an edge; `domain-consistency` refuses drift | `derived-gate` |
| `glossary.context` and `domainModel.context` cite the storming context id, and the BoundedContext artifact the Task publishes carries that id (`outputs.context.id: inputs.contextId`, `12-task.md`), the Glossary `<context>-glossary`, the DomainModel `<context>-model`; a second derivation publishes their next revisions | `derive-domain` outputs; Validator later |
| `allowedHosts` on the storming Executor is declarative: the shipped agent Adapters do not enforce `security` (`13-executor.md`) | convention; roadmap |
| the relationship names map camelCase to kebab in the derivation; the kinds keep their own enums | `derive-domain-rules` |

## Decisions

- Prompts, not a Skill: the old skill's references are the phase instructions and fit a one-shot
  Task; its interview loop does not, since an agent in a Task cannot ask. The human gate is where
  the interview happens, in the editor. No Skill fetch, no git source, pack YAML only.
- The agent derives and a Validator checks, instead of a script deriving: a pack ships YAML only
  and an Executor program path is not portable; the pattern is the rules', the agent extracts and
  the deterministic side decides. `checkDerived` is strict on labels so a drifted projection fails.
- `base` beside `previous` on `event-storm`: a ReviewLoop's `previous` is the last round of the
  same loop and may not be bound from outside, while the process phase must start from the
  big-picture model. Two inputs, one rule in the instructions: previous, else base, else the Prd.
- The derive loop is a `repeat` over the `contexts` list the design phase answers: a Workflow
  cannot read artifact content, so the Task says the ids, and the loop needs `state` in expressions.
  Found in design review.
- The human gate is `cli-human/v1` pointing at `persimmon ui`: the form carries the artifact name,
  the editor shows the board, the terminal takes the verdict. A `review-ui` Adapter waits for server
  mode.
- `confirm-storming` is its own Task rather than an Approval, because the phase Gate also needs
  the grammar Validator with a bound level, and an Approval's approvers are Tasks only.

- Proven live on `claude-sonnet-5`: `domain-discovery` ran big-picture, process and design in one
  round each (79 s, 102 s, 159 s), every grammar check clean, each human gate completed from the
  terminal; `derive-all` then produced the three artifacts for the one context and `domain-consistency`
  passed first time (158 s). The first derivation died in zero seconds because the `DomainModel` kind
  is the first with `$defs` and the CLI resolves `$ref` from the schema root; the runner now hoists
  every port's `$defs`. Found in UAT.
- What the human gate is for, seen in the run: event labels that read as states ("Claim routed to
  approver"), the Prd's three contexts collapsed into one, that one classified `supporting` where the
  Prd calls it core, and the routing policy carrying the 5000 EUR threshold in prose rather than as a
  parameter. A reject with findings sends each back; the Prompts stay as written, the gate decides.
  Found in UAT.

- The derivation is a ReviewLoop too: one drifted label would otherwise end the Pipeline after days
  of human gating, with no word to the agent; the consistency findings name the labels, so they are the
  feedback. A design-level policy without `execution` is a grammar error, since the DomainModel
  requires it and the gate must refuse what the derivation cannot carry. Found in audit.

## Examples

- [`examples/ai-native-domain.yaml`](examples/ai-native-domain.yaml): `expense-claims-storming.r2`,
  the model at design level with three aggregates, three constraints, two policies and three read
  models, and `expenses-model`, its DomainModel; `domain-consistency` passes on the pair
- the pack files under `packs/ai-native/global/`: `30-prompts.yaml`, `40-executors.yaml`,
  `50-tasks.yaml`, `60-validators.yaml`, `70-gates.yaml`, `80-workflows.yaml`
