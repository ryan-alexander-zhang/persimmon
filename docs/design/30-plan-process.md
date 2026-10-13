# Plan process

status: draft · layer: 2 (`23-pack-ai-native.md`, `27-spec-process.md`, `29-design-process.md`) · schema: the `Plan` kind in `packs/ai-native/global/10-artifact-kinds.yaml`

From a Spec and the Designs it will be built against to its Plan: an agent writes the tasks in
build order, each on one Architecture block, covering the Spec's requirements, verified by its
acceptance scenarios, realising elements of the Designs; a Validator checks coverage and every
reference; the loop feeds findings back once. The Plan is the only artifact linking a Spec to
Designs.

```text
ReviewLoop plan-one, run per Spec by ref, the Designs listed by the caller (an artifacts port, 10-ports.md)
  produce: Task write-plan (plan-agent) ─▶ Plan
  review:  Gate plan-gate = Validator plan-consistency (sdd/v1: plan, spec, architecture, designs)
  previous and feedback fed back; maxRounds 2
```

## Process

| Member | Content |
|---|---|
| Prompt `plan-rules` | one block per task; tasks cover every `FR-n` and verify every `AC-n`; elements only of Designs in context, of the task's block; earlier tasks only; no estimate, owner, path or technology |
| Executor `plan-agent` | `claude-code/v1`, read-only, its own name for per-Namespace override |
| Task `write-plan` | inputs `spec`, `architecture`, `designs` (artifacts), `previous`, `feedback`; output `plan` |
| Validator `plan-consistency` | `sdd/v1` over `plan`, `spec`, `architecture`, `designs`; the Plan rule row of `23-pack-ai-native.md` as findings |
| Gate `plan-gate` | consistency only |
| ReviewLoop `plan-one` | `produce` `write-plan`, `review` `plan-gate`, `maxRounds: 2`; no `plan-all`: a Workflow cannot find the Spec of `CAP-n` by id until a producer may choose artifact ids (`91-roadmap.md`) |

Run: `persimmon run plan-one --input 'spec={kind: artifact, ref: {...}}' --input 'architecture={...}' --input designs=@designs.yaml`,
where `designs.yaml` is a YAML list of RevisionRefs (`08-store.md`).

## `checkPlan`

`adapters/sdd/check.mjs`, pure, `checkPlan({plan, spec, architecture, designs})` where `designs`
maps artifact id to content, paired by `index.mjs` from `inputs.designs.refs[i]` and
`artifacts.designs[i]`; every finding `error`:

| Code | Finding |
|---|---|
| `not-a-plan` | content without `tasks` or `spec`; the only finding then |
| `unknown-requirement`, `unknown-scenario` | a `covers` or `verifiedBy` id the Spec lacks |
| `requirement-unplanned`, `scenario-unverified` | an `FR-n` no task covers; an `AC-n` no task verifies |
| `unknown-block` | a task's `block` is no `BB-n` of the Architecture |
| `unknown-task`, `dependency-forward` | `dependsOn` names no task; names one not earlier (itself included) |
| `unknown-design`, `design-unread`, `design-unused` | an element's `design` not in `designs[]`; listed but not among the Designs evaluated; listed but no task realises an element of it |
| `design-block`, `unknown-element` | the Design's `block` is not the task's; the `EL-n` is not in the Design |
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
| document order is build order: `dependsOn` names lower ids only, so a cycle cannot be written | `plan-consistency` |

## Decisions

- The Designs reach the Plan through one `artifacts` input the caller lists, not a query: the engine
  has no Relation query yet (`91-roadmap.md`) and the caller knows the blocks the Spec touches.
  Found in design review.
- No `plan-all`: `spec-all` names its Specs `<run>-<port>` and a Workflow has no way to find the
  Spec of `CAP-n`; chaining `spec-one` then `plan-one` in one Workflow would carry the ref but
  also need the Designs per capability. Deferred with producer-chosen ids. Found in design review.
- `verifiedBy` and `covers` may both be empty on a task (groundwork), but every `FR-n` and `AC-n` of
  the Spec must be in some task: coverage is a Spec-level rule, not a task-level one. Found in
  design review.

- Proven live on `claude-sonnet-5`: `plan-one` over the example Spec, Architecture and the one
  Design, 47s, passed `plan-consistency` in round one. Seven tasks, one per requirement, all on
  `BB-1`, each depending on the one before; every `FR-n` and `AC-n` covered, every element of
  `claims-api`'s four operations named; provenance pins the Spec, the Architecture and the Design.
  Two things the Prompt could say better: a chain where every task depends only on the previous
  one is an order, not a dependency graph, and the receipt store (`BB-2`) got no task because no
  requirement names it; both are judgement, not findings. Found in UAT.

## Examples

- `docs/design/examples/ai-native-domain.yaml`: `Plan/submit-a-claim-plan`, four tasks over `BB-1`
  and `BB-2` covering `FR-1`..`FR-6`, verified by `AC-1`..`AC-7`, realising `EL-1`..`EL-4` of
  `claims-api`; passes `checkPlan` (`test/adapters/sdd.test.ts`).
