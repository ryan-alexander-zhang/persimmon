# Domain discovery

status: draft · layer: 2 (`23-pack-sdlc.md`, `24-eventstorming.md`) · schema: the `DomainModel` kind in `packs/sdlc/global/10-artifact-kinds.yaml`

From a Prd to the domain kinds: an agent runs the event storming session phase by phase, a
human confirms each phase in the editor, and the design-level model is projected into one
`BoundedContext`, `Glossary` and `DomainModel` per storming context. Pack content only
(`20-pack.md`): Prompts, Tasks, Validators, Gates, ReviewLoops, Workflows, one Pipeline.

```text
Pipeline domain-discovery
  bigPicture: ReviewLoop storm-big-picture ─┐ produce: Task event-storm (level literal)
  process:    ReviewLoop storm-process      ├ review:  Gate storming-gate = Validator eventstorming-grammar (level, prd), then storming-confirmed (human, after the grammar passed)
  design:     ReviewLoop storm-design      ─┘ previous and feedback fed back; base = the phase before
  derive:     Workflow derive-all: repeat over the design phase's `contexts` ─▶ Workflow derive-one per context
                 derive: Task derive-domain ─▶ BoundedContext, Glossary, DomainModel
                 check:  Gate derived-gate = Validator domain-consistency (eventstorming/v1: model, DomainModel, BoundedContext, Prd)
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
| Task `event-storm` | inputs `prd`, `rules` (optional, the BusinessRules the Prd cites), `level`, `base` (the phase before; with `changes` bound, this phase's model as it stands), `changes` (optional, downstream answers applied to `base` and nothing else: a command, an event, a read model, an aggregate, a policy or an edge in the answer's words, every other node, edge and context kept with its id), `previous` (this phase's last round), `feedback`; outputs `model`, `contexts` (the ids in order); an unknown is a hotspot, never a question; `inventory` (optional, a value: the content of a Rewrite pack `SourceInventory`, `40-pack-rewrite.md`; a value, not an artifact, so the SDLC pack names no kind of another pack, since a port's `artifactKind` must resolve when a run starts, `10-ports.md`): with it, a domain event is a state change in the source's words and a context is cut by language and events, never by package; `decisions?` (the owner's answers to this round's open hotspots, recorded with `previous` the round's model); output `open`, the ids of the hotspots still open |
| Task `decide-storming`, Workflow `storming-draft` | the owner decides a phase's open hotspots inside the round (`23-pack-sdlc.md`): `storming-draft` runs `event-storm`, then, when `open` names any, `decide-storming` on `local-reviewer` (inputs `draft`, `open`, `prd`, `rules?`; output `decisions`; Prompt `owner-decisions`: a question its answer, a conflict which side holds, a risk whether the product accepts it) and `event-storm` again with `decisions`; outputs `model` and `contexts` from whichever path ran (`first`) |
| Task `confirm-storming` | human on `cli-human/v1`: open the model in `persimmon ui`, approve or reject with one finding per node, edge or context |
| Validators | `eventstorming-grammar` with `level` and the `prd` (`checkSubdomains`, `34-subdomains.md`); `storming-confirmed` over `confirm-storming`; `domain-consistency`: `eventstorming/v1` with `model`, `glossary` (optional: `checkGlossary`, every term a label of the context), `domainModel`, `context`, `boundedContext` and `prd`, the grammar's `checkBoundedContext` beside `checkDerived` |
| Gates | `storming-gate` (grammar and confirmed, `all`, `confirmed` `after: [grammar]`); `derived-gate` (consistency, binding the derived BoundedContext and the Prd) |
| ReviewLoops `storm-big-picture`, `storm-process`, `storm-design` | `produce` `storming-draft` with the level as a literal (73h: the owner may be a human), `review` `storming-gate`, `maxRounds: 3`; `design` takes `changes` (optional) with `base` then the design-level model itself, and passes `base` to the owner's confirm; `process` and `design` take `base` from the phase before; all three take `rules` (optional); all three take `inventory` (optional); `big-picture` takes `base` (optional), the product's last model, when a later Rewrite pack Slice storms on top of an earlier one |
| Task `derive-domain` | inputs `model`, `contextId`, `prd`, `rules` (optional), and optional `base` (DomainModel), `baseGlossary`, `baseContext` with `changes` (the downstream answers, `<artifact id> Q-n: <resolution>`), applied to the three and nothing else: a term, a fact type or an enum value an answer adds is added in the answer's words, every label stays the model's; outputs `context`, `glossary`, `domainModel`; a projection, invents nothing |
| ReviewLoop `derive-one` | `produce` `derive-domain` (with `base`, `baseGlossary`, `baseContext` and `changes` passed through, optional), `review` `derived-gate` with the produced BoundedContext and the Prd, `maxRounds: 2`; the consistency findings go back as `feedback` with the last `domainModel` as `previous` and the last BoundedContext as `previousContext` (`carry`) |
| Workflow `derive-all` | `repeat` over `contexts`: state `index` only, body `contextId: {expression: "inputs.contexts[state.index - 1]"}`, `until: iteration.index >= inputs.contexts.size()`, `parallel: 4` and `memo` (`11-workflow.md`): the contexts derive side by side, one rejected stopping none, and a context unchanged since its loop passed is reused; the run Succeeds when `steps.each.results` all passed; a context the loop could not derive ends the run `derivation_inconsistent`; an iteration that died before its Gate ran, `step_failed` |
| Pipeline `domain-discovery` | inputs `prd` and `rules` (optional), handed to every phase; every phase has `memo: {when: outputs.passed}`, so a run started again reuses the phases that passed and redoes the one that did not; the three loops then `derive-all`; a loop phase routes on its `passed` (`21-composition.md`), so an exhausted phase ends the run `<phase>_rejected`; outputs `model` and `derived`; `inventory` (optional) is handed to every phase, `base` (optional) to the big-picture phase |

Two Layer 1 changes this needed, each its own unit: `state.<var>` readable in expressions inside
`repeat` (`10-ports.md`, `11-workflow.md`), and a ReviewLoop surfacing every `produce` output
(`21-composition.md`), so the design loop hands `contexts` on.

## `checkDerived`

`tools/eventstorming/grammar` `checkDerived(model, domainModel, context)`, run by `eventstorming/v1`
when `artifacts.domainModel` is present; `passed` iff no error. Labels compare exactly. With
`artifacts.boundedContext` (and `prd`) bound, `checkBoundedContext(model, boundedContext, context, prd)`
runs beside it (`34-subdomains.md`): `derived-subdomain-mismatch`, `derived-classification-mismatch`,
`derived-capability-unknown`, `derived-capability-missing` (a subdomain no other context realises),
`derived-relationship-mismatch` (the storming's map from this context's side), all errors.

| Severity | Codes |
|---|---|
| error | `derived-source-level`, `derived-unknown-context` (also when the Validator's `context` input is unbound), `derived-missing-aggregate`, `derived-extra-aggregate`, `derived-command-mismatch`, `derived-event-mismatch`, `derived-missing-event`, `derived-extra-event`, `derived-event-flag`, `derived-policy-mismatch`, `derived-readmodel-mismatch`, `derived-external-mismatch` |
| error | `derived-term-unknown` (`checkGlossary`, with `artifacts.glossary`: a Glossary term that is no aggregate, entity, value object, read model, actor or external system of the context) |
| warning | `derived-invariant-unsourced`, `derived-unused-constraint` |

## Rules

| Rule | Enforcer |
|---|---|
| a model gap found below (a command, an event, a read model a Spec needs) is fixed in the storming model, never in a derivation: `storm-design` with `base` and `changes`, then `derive-one` for each context the model changed, with `base`, `baseGlossary`, `baseContext` and `changes` naming the parts; `domain-consistency` still refuses a derivation that drifts | `event-storm`; `derived-gate` |
| a phase's model has `meta.level` at least the phase's; the grammar Validator takes the level from the Gate | `storming-gate` |
| a context names one of the Prd's subdomains; at design every context names one and has its type, and every subdomain is realised (`34-subdomains.md`) | `storming-gate` (`checkSubdomains`) |
| the agent asks nothing: an unknown is a hotspot with kind and priority; the human gate is where questions are answered, and an answer given there is modelled into that phase, so the next phase reads it off `base` and never raises the Prd question again; a Prd `Q-n` with a `resolution` is modelled, not raised | Prompts (`storming-dsl`); `confirm-storming` |
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
  mode. Superseded: Progress answers the verdict in `persimmon ui` (`37-progress.md`).
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
- The storming and derivation Tasks take the Prd's `BusinessRules` as context, optional: a Prd
  carries no rule text, only `BR-n` citations, so the big-picture agent raised a hotspot on a
  walk-in limit `BR-10` already stated, and the design-level agent modelled constraints from
  capability descriptions, then asked for the rule text in a hotspot. The human pasted the rules
  into a finding. Optional, so a Prd without rules still storms. Found in UAT.

- A gate's answers reach the next phase through `base`, not through the Prd: the big-picture gate of
  example08 answered all five Prd questions in findings and the confirmed model carried no hotspot,
  yet the process phase raised four of them again from the Prd's `openQuestions`, since a loop's
  `feedback` is its own and nothing wrote the answers anywhere. The DSL Prompt now says a question the
  confirmed base no longer carries was settled there. The durable path is a Prd revision with
  `openQuestions[].resolution` before storming; the Prompt models a resolved question. Found in UAT
  (example08).
- Proven live on `claude-sonnet-5` with the same Prd: big-picture round one raised all five Prd
  questions as hotspots, the gate answered them in four findings, round two modelled the answers
  (`Extended reservation approval lapsed` added) and carried no hotspot; the process phase then
  raised none of the five across 59 nodes, and the design phase raised three new design-level
  hotspots (aggregate shape, the two-reservation cap across instances, the source of car data for
  evaluation), none a Prd question. Found in UAT (example08).
- A model gap found below goes to the storming model through `storm-design` with `base` and
  `changes`, then through `derive-one`. A Spec that needs a command the DomainModel lacks asks
  (`spec-rules`: never invent a label), the owner answers naming the DomainModel, and `derive-one`
  with `changes` cannot add it: a derivation is a projection and `domain-consistency` refuses
  `derived-command-mismatch`. The storming model is the source, so the answer is modelled there,
  at the design level, with `base` the model as it stands and the whole phase chain untouched;
  the derivation then follows with the changed parts as its `changes`. Chosen by the developer in
  the Autopilot retest.

## Examples

- [`examples/sdlc-domain.yaml`](examples/sdlc-domain.yaml): `expense-claims-storming.r2`,
  the model at design level with three aggregates, three constraints, two policies and three read
  models, and `expenses-model`, its DomainModel; `domain-consistency` passes on the pair
- the pack files under `packs/sdlc/global/`: `30-prompts.yaml`, `40-executors.yaml`,
  `50-tasks.yaml`, `60-validators.yaml`, `70-gates.yaml`, `80-workflows.yaml`
- A hotspot is an open question of the model, decided by the owner inside the round. In the Autopilot retest the
  big-picture phase passed four hotspots as information and the process phase spent a whole round on the owner
  deciding them at the confirm; `storming-draft` puts `decide-storming` before the Gate, as every writer loop has
  (`23-pack-sdlc.md`). `derive-all` ran its three contexts one after another; they are independent. Found in UAT.
