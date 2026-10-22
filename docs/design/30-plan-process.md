# Plan process

status: draft · layer: 2 (`23-pack-sdlc.md`, `27-spec-process.md`, `29-design-process.md`) · schema: the `Plan` kind in `packs/sdlc/global/10-artifact-kinds.yaml`

From a Spec and the Designs it will be built against to its Plan: an agent writes the tasks in
build order, each on one Architecture block, covering the Spec's requirements, verified by its
acceptance scenarios and the `build` quality scenarios it cites, realising elements of the Designs; a Validator checks coverage and every
reference; the loop feeds findings back once. The Plan is the only artifact linking a Spec to
Designs.

```text
Workflow plan-all: repeat over `capabilities` ─▶ ReviewLoop plan-one per Spec, the Spec bound by id (fromArtifact)
ReviewLoop plan-one, run per Spec by ref or from plan-all, the Designs listed by the caller (an artifacts port, 10-ports.md)
  produce: Task write-plan (plan-agent) ─▶ Plan
  review:  Gate plan-gate = Validator plan-consistency (sdd/v1: plan, spec, architecture, designs, domainModel?, base?)
  previous and feedback fed back; maxRounds 2
```

## Process

| Member | Content |
|---|---|
| Prompt `plan-rules` | one block per task; tasks cover every `FR-n` and verify every `AC-n` and every `build` `QS-n` the Spec cites; a scenario on the task after which it can pass, every operation its When calls and its Then observes built by that task or one before it; elements only of Designs in context, of the task's block; earlier tasks only; no estimate, owner, path or technology |
| Executor `plan-agent` | `claude-code/v1`, read-only, its own name for per-Namespace override |
| Task `write-plan` | inputs `spec`, `architecture`, `designs` (artifacts), `domainModel?`, `base?` (the Spec's Plan before this run), `previous`, `feedback`, `decisions?` (the owner's answers to this round's open questions, recorded with `previous` the draft); outputs `plan`, `open` (the ids of its open `Q-n`); `changes?` beside `base` (the downstream answers this run applies, each `<artifact id> Q-n: <resolution>`) |
| Task `decide-plan`, Workflow `plan-draft` | the owner decides a draft's open questions inside the round (`23-pack-sdlc.md`): `plan-draft` runs `write-plan`, then, when `open` names any, `decide-plan` on `local-reviewer` (inputs `draft`, `open`, `spec`, `architecture`; output `decisions`; Prompt `owner-decisions`) and `write-plan` again with `decisions`; output `plan` from whichever path ran (`first`) ; `check` (Gate `plan-check`, the consistency Validator alone) runs on the last draft written, after `record` or straight after `write`, and `fix` (`write-plan` with `previous` and `feedback`) when it refuses |
| Validator `plan-consistency` | `sdd/v1` over `plan`, `spec`, `architecture`, `designs`, `domainModel?`, `base?`; the Plan rule row of `23-pack-sdlc.md` as findings |
| Gate `plan-gate` | consistency only |
| ReviewLoop `plan-one` | `produce` `plan-draft` (73h: the owner may be a human), `review` `plan-gate`, `maxRounds: 2`, 240h; `changes` passed to `write-plan` with `base` |
| Workflow `plan-all` | `repeat` over `capabilities` as `spec-all` does, `{id, context}` entries; each iteration binds `spec` by `fromArtifact` to `<prd>-cap-n` at its latest revision (`10-ports.md`), the context's DomainModel `<context>-model`, `designs` once for the product, `base` to the Spec's Plan `<spec>-plan` when one exists (`fromArtifact`, `onMissing: omit`); a Spec the loop could not plan ends the run `plan_inconsistent`; a step that fails ends it `step_failed`, `steps.each.error` naming the cause (`spec: source absent` for a capability without a Spec, `iteration_limit` past twenty); output `written`; `repeat` runs its loops side by side, `parallel: 4`, one rejected stopping none, and `memo` reuses a loop whose inputs are unchanged since it passed instead of running it again (`11-workflow.md`); the run Succeeds when `steps.each.results` all passed |

Run one: `persimmon run plan-one --input 'spec={kind: artifact, ref: {...}}' --input 'architecture={...}' --input designs=@designs.yaml`,
where `designs.yaml` is a YAML list of RevisionRefs (`08-store.md`). Run all:
`persimmon run plan-all --input 'prd={...}' --input 'capabilities=[CAP-1, CAP-2]' --input 'architecture={...}' --input designs=@designs.yaml`.

## `checkPlan`

`adapters/sdd/check.mjs`, pure, `checkPlan({plan, spec, architecture, designs, domainModel, base, ids})` where `designs`
maps artifact id to content, paired by `index.mjs` from `inputs.designs.refs[i]` and
`artifacts.designs[i]`; every finding `error` but `task-renumbered` (warning):

| Code | Finding |
|---|---|
| `not-a-plan` | content without `tasks` or `spec`; the only finding then |
| `spec-mismatch`, `architecture-mismatch` | `spec` or `architecture` is not the id of the input bound (`inputs.spec.ref.id`, `inputs.architecture.ref.id`); a content carries no id of its own |
| `design-duplicate` | an id listed twice in `designs[]` |
| `unknown-requirement`, `unknown-scenario` | a `covers` or `verifiedBy` id the Spec lacks; a `QS-n` the Spec's `qualities` do not cite |
| `scenario-not-build` | a `verifiedBy` `QS-n` whose Architecture `provenAt` is not `build` |
| `requirement-unplanned`, `scenario-unverified` | an `FR-n` no task covers; an `AC-n`, or a `build` `QS-n` the Spec cites, no task verifies |
| `unknown-block` | a task's `block` is no `BB-n` of the Architecture |
| `unknown-task`, `dependency-forward` | `dependsOn` names no task; names one not earlier (itself included) |
| `unknown-design`, `design-unread`, `design-unused` | an element's `design` not in `designs[]`; listed but not among the Designs evaluated; listed but no task realises an element of it |
| `design-block`, `unknown-element` | the Design's `block` is not the task's; the `EL-n` is not in the Design |
| `task-renumbered` | warning: with `base` bound, a `T-n` of the base now on another block, or whose `covers`, `verifiedBy` and elements share nothing with the task holding that id now |
| `element-unplanned` | an element of a Design evaluated that realises a command or read model a story of the Spec names, or, with `domainModel` bound, the aggregate handling such a command, and that no task realises; a Design whose `domainModel` is not the Spec's is another context's and needs nothing |
| `id-sequence` | `T-n`, `Q-n` not unique and increasing |

The Adapter picks the mode from the payload: `artifacts.plan` first (a Plan payload carries a
`spec` too), else `artifacts.spec` (or `artifacts.model`), else `artifacts.prd`, else
`artifacts.design`.

## Rules

| Rule | Enforcer |
|---|---|
| a Design's content carries no artifact id, so the Validator pairs `artifacts.designs[i]` with `inputs.designs.refs[i].id`; a Plan run without `inputs.designs` finds every element `design-unread` | `index.mjs`; convention |
| the Plan cites Spec, Architecture and Designs; never a Prd, DomainModel or Glossary directly: the Spec already names the domain, the Designs the contracts | `plan-rules`; convention |
| a task sits on one block; `elements` of a Design whose `block` differs from the task's is a finding; a block without a Design in context gets no elements and a `Q-n` | `plan-rules`; `plan-consistency` |
| every operation the capability needs is built by a task: the elements realising its stories' commands and read models, and the aggregate those commands act on | `plan-rules`; `plan-consistency` |
| a Plan written again starts from the one it replaces and keeps its task ids: a built task's AcceptanceRecord is `<plan>-<t-n>` | `plan-rules`; `plan-consistency` |
| document order is build order: `dependsOn` names lower ids only, so a cycle cannot be written | `plan-consistency` |

## Decisions

- A downstream answer that changes a Plan reaches it through `plan-one` with `base` and `changes`:
  in the live run a TestDesign found AC-2 on a task before the one building what its Then observes,
  and its answer moves the scenario; the revision keeps the task ids and passes `plan-gate`. Found
  in UAT.

- The Designs reach the Plan through one `artifacts` input the caller lists, not a query: the engine
  has no Relation query yet (`91-roadmap.md`) and the caller knows the blocks the Spec touches.
  Found in design review.
- `plan-all` binds each Spec by `fromArtifact` (`10-ports.md`) to `<prd>-cap-n`, the id
  `write-spec` chooses (`12-task.md`), so it runs after `spec-all` without anyone copying refs.
  The Designs are passed once for the whole product: a Plan lists only the Designs its tasks
  realise elements of, so extra Designs in the payload are no finding. The per-capability query
  ("every Design of the blocks this Spec touches") stays roadmap. Found in design review.
- A Plan names a task for every Design element its capability needs, and the check finds one left
  out. In the live run no task named `EL-11`, `GET /claims/{claimId}`, the read of the Claim that
  nearly every case goes through; the TestDesign's human had to decide it was `T-1`'s, and the
  Plan never said so. A story names its commands and read models; the aggregate's read is reached
  through the DomainModel, which says which aggregate handles each command, so the check reads it
  when bound. The Plan still cites no DomainModel. Every element of the Design is not required: one
  Design serves several capabilities. Found in UAT.
- A Plan written again starts from the one it replaces, `base`, and keeps every task's id. In the
  live run a fresh `plan-one` split four tasks into six: the old `T-2`, the receipt store, became
  `T-3`, and `T-2` now meant the claim's read, so the AcceptanceRecord `submit-a-claim-plan-t-2`
  named other work in each revision. The check compares a task by its block and by what it covers,
  verifies and realises, since a task may rightly grow or shrink. A warning, not an error, unlike
  the TestDesign's `case-renumbered` (`39-test-process.md`): document order is build order, so a new
  task an old one needs can come first only under a lower id, and the Plan Gate has no human to
  overrule a refusal. Found in UAT.
- A scenario sits on the task after which it can pass: the operations its When calls and its Then
  observes are built by then. In the live Autopilot run `AC-2` (Bob's cancel of Alice's booking is
  refused, and her booking stays) was on `T-1`, which builds the cancel, while `GET /my-bookings`,
  the only operation showing that the booking stays, is `T-3`'s: no case could pass, as the check
  refused the step `step-premature`, the auditor refused the case at `unit`, and the human refused it
  without the assertion. No check enforces it here: which operation a Then observes is prose until
  the TestDesign names it in a step, where `step-premature` finds it (`39-test-process.md`). Found in
  UAT.
- `verifiedBy` and `covers` may both be empty on a task (groundwork), but every `FR-n`, `AC-n` and cited
  `build` `QS-n` of the Spec must be in some task: coverage is a Spec-level rule, not a task-level one. Found in
  design review.

- Proven live on `claude-sonnet-5`: `plan-one` over the example Spec, Architecture and the one
  Design, 47s, passed `plan-consistency` in round one. Seven tasks, one per requirement, all on
  `BB-1`, each depending on the one before; every `FR-n` and `AC-n` covered, every element of
  `claims-api`'s four operations named; provenance pins the Spec, the Architecture and the Design.
  Two things the Prompt could say better: a chain where every task depends only on the previous
  one is an order, not a dependency graph, and the receipt store (`BB-2`) got no task because no
  requirement names it; both are judgement, not findings. Found in UAT.
- Run again after `write-plan` chose its id (`inputs.spec.id + '-plan'`): the output was
  `Plan/submit-a-claim-plan.r2`, the next revision of the example's `r1`, 1m07s, round one. Found
  in UAT.
- `plan-all` live on `claude-sonnet-5` over `capabilities: [CAP-1]` with the Spec stored as
  `expense-claims-cap-1`: `fromArtifact` bound it, the loop wrote `Plan/expense-claims-cap-1-plan.r1`,
  29s, round one, `written 1`. Found in UAT.

## Examples

- `docs/design/examples/sdlc-domain.yaml`: `Plan/submit-a-claim-plan`, four tasks over `BB-1`
  and `BB-2` covering `FR-1`..`FR-6`, verified by `AC-1`..`AC-7`, realising `EL-1`..`EL-4` of
  `claims-api`; passes `checkPlan` (`test/adapters/sdd.test.ts`).
