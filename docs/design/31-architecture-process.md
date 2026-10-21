# Architecture process

status: draft · layer: 2 (`23-pack-sdlc.md`, `26-domain-discovery.md`, `28-prd-process.md`) · schema: the `Architecture` and `Adr` kinds in `packs/sdlc/global/10-artifact-kinds.yaml`

From a Prd, its rules and the derived domain kinds of every context to the product's Architecture:
an agent writes the arc42 baseline and one Adr per strategy decision; a Validator checks every
citation and the shape rules; a human confirms the block cut, the strategy and the quality goals;
the loop feeds findings back, three rounds at most. Once per product, after domain discovery and
before any Spec.

```text
ReviewLoop architect, run once per product with the contexts, models and glossaries listed by the caller (artifacts ports)
  produce: Task write-architecture (architecture-agent) ─▶ Architecture <prd>-architecture, Adr <prd>-adr-1, <prd>-adr-2, ... (an artifacts output, 12-task.md)
  review:  Gate architecture-gate = Validator architecture-consistency (sdd/v1), then architecture-audited (auditor, after consistency
           passed), then architecture-confirmed (human, after both passed)
  previous and feedback fed back; maxRounds 3
```

## Process

| Member | Content |
|---|---|
| Prompt `architecture-rules` | arc42 as the pack reads it: the Prd is the requirements by reference; every context realised by a level 1 block; strategy decisions cite `QG-n` and `C-n`; every quality goal has a scenario, each with its `method` and `provenAt`, a `build` one a `test` or a `fitness` one; one Adr per `S-n`, in order; a structural decision `enforcedBy` a `fitness` scenario, or a negative consequence saying why none |
| Executor `architecture-agent` | `claude-code/v1`, read-only, its own name for per-Namespace override |
| Task `write-architecture` | inputs `prd`, `rules`, `contexts`, `domainModels`, `glossaries` (artifacts), `previous`, `previousAdrs` (the last round's Adrs, carried by the loop), `feedback`; outputs `architecture` (id `<prd>-architecture`) and `adrs` (artifacts, prefix `<prd>-adr`); `base` and `baseAdrs` (optional): the product's last Architecture and Adrs, read as `previous` and `previousAdrs` when those are unbound, so a later Rewrite pack Slice extends the Architecture instead of starting blind (`40-pack-rewrite.md`) |
| Task `confirm-architecture` | human on `cli-human/v1`: reads the Architecture and its Adrs; approve, or one finding per `BB-n`, `S-n`, `QG-n`, `C-n`, `QS-n` or Adr id |
| Validators | `architecture-consistency`: `sdd/v1` over `architecture`, `prd`, `rules`, `contexts`, `domainModels`, `glossaries`, `adrs` (`rules-mismatch` when the Architecture's `businessRules` is not the artifact bound); `architecture-audited`: `task` over `audit-architecture` (inputs `architecture`, `adrs`, `prd`, `rules`, and from round two `previous`, `previousAdrs`, `feedback`; `base` and `baseAdrs` (optional), the Architecture and Adrs the draft extends, so the auditor judges the changes against them; Executor `auditor`; the Prompt `draft-audit-rules`, part "An Architecture": `scenario-undecidable`, `strategy-unfit` and `technology-vague` errors, `adr-unargued` and `responsibility-overlap` warnings; `23-pack-sdlc.md`); `architecture-confirmed` over `confirm-architecture`, whose form shows the auditor's verdict as `audit` (`fromValidator: audit`) |
| Gate `architecture-gate` | consistency, audit and confirmed, `all`, 72h; `audit` `after: [consistency]`, `confirmed` `after: [consistency, audit]` (`14-gate.md`); `base` and `baseAdrs` (optional) handed to `audit` with `onMissing: omit` |
| ReviewLoop `architect` | `produce` `write-architecture`, `review` `architecture-gate`, `maxRounds: 3`; the subject is the Architecture; the Adrs ride beside it as a second output, come back as `previousAdrs` (`carry`, `21-composition.md`) and are republished whole each round, each a copy of its last revision unless a finding names it; `base` and `baseAdrs` (optional) handed to `produce` and `review` |

Run: `persimmon run architect --input 'prd={...}' --input 'rules={...}' --input contexts=@contexts.yaml --input domainModels=@models.yaml --input glossaries=@glossaries.yaml`,
each list a YAML list of RevisionRefs (`08-store.md`), one entry per context in the same order.

## `checkArchitecture`

`adapters/sdd/check.mjs`, pure, `checkArchitecture({architecture, prd, rules, ids, adrs, contexts})` where
`ids` holds the Prd's id and the lists of context, model, glossary and Adr ids paired by
`index.mjs` from `inputs.<port>.refs[i]`, `adrs` maps an Adr id to its content and `contexts` a
BoundedContext id to its content, paired the same way; every finding
`error`:

| Code | Finding |
|---|---|
| `not-an-architecture` | content without `buildingBlocks` or `introduction`; the only finding then |
| `prd-mismatch` | `introduction.prd` is not the id of the Prd bound |
| `capability-unplaced`, `capability-twice` | a Prd capability no BoundedContext evaluated lists, or two do (`34-subdomains.md`) |
| `unknown-context`, `context-unrealised` | a block's context not among those evaluated; a context evaluated that no level 1 block realises (the Prd names no context; `context.business[].context` is not checked: it may name a context of another Namespace or one not yet written) |
| `unknown-parent` | a block's `parent` is no `BB-n` |
| `technology-missing` | a level 1 block without `technology` |
| `model-mismatch`, `glossary-mismatch`, `adr-mismatch` | `domainModels[]`, `glossaries[]`, `decisions[]` differ from the ids evaluated, either way |
| `unknown-driver` | a strategy `addresses` id that is neither a `QG-n` nor a `C-n` |
| `unknown-quality-goal`, `goal-unscenarioed` | a scenario's goal not in the introduction; a goal with no scenario |
| `unknown-relation-end`, `relation-no-block`, `unknown-interface` | a relation end neither a block nor a partner; neither end a block; `interface` not provided by the `to` block, or not required by the `from` block when `to` is a partner |
| `block-unrelated`, `partner-unrelated` | a level 1 block or a partner with no relation |
| `adr-status`, `unknown-adr-driver` | an Adr not `accepted`; a driver that resolves in neither the Architecture (`QG`, `C`, `QS`), the Prd (`G`, `CAP`, `SC`) nor the rules (`BR`) |
| `adr-enforcer` | an applied Adr's `enforcedBy` names a `QS-n` the Architecture lacks, or one not proven at `build` |
| `adr-strategy` | the Adr at position n of `inputs.adrs` names a `strategy` other than `S-n`, or `S-n` is no strategy of the Architecture; a superseded Adr names a strategy the Architecture still has (an Adr without `strategy` is not checked) |
| `id-sequence` | `QG-n`, `C-n`, `S-n`, `BB-n`, `REL-n`, `CC-n`, `QS-n`, `RK-n` not unique and increasing |

The Adapter picks the mode from the payload: `artifacts.plan` first, else `artifacts.spec` (or
`artifacts.model`), else `artifacts.design`, else `artifacts.architecture` (a Prd rides beside it),
else `artifacts.prd`.

## Rules

| Rule | Enforcer |
|---|---|
| the Architecture rule row of `23-pack-sdlc.md`, except `deployment` and `runtime` references and `decisions[]` with status `accepted` being the only Adrs (they are: `adr-status`) | `architecture-consistency` |
| the slot rule: the n-th Adr backs `S-n` and says so in `strategy`, so `<prd>-adr-n` names one decision across rounds and the Architecture alone tells the agent which slots are live (round two never sees round one's Adrs); a dropped `S-n` keeps its slot as a `superseded` Adr still naming it, which the Architecture does not list; the Validator holds a named strategy to its slot and a superseded one to a dropped strategy, and does not count: the kind rule ("detail is an Adr") lets an Architecture apply fewer Adrs than it has strategies, and an Adr taken outside the loop names no strategy and sits in no slot | `architecture-rules`; `adr-mismatch`, `adr-status`, `adr-strategy` |
| `rules` is the product's one BusinessRules, its rules tagged by subdomain, and `checkPrd` holds every capability to the Prd's subdomains (`33-multi-context-product.md`, `34-subdomains.md`) | `prd-consistency` |
| `status: accepted` on the Architecture and its Adrs is the author's claim; the Gate's pass is the fact, read from the run; a rejected round's artifacts are committed revisions all the same, as every produce output is | convention |
| the caller lists every BoundedContext with its model and glossary (`kind:` queries); each capability lives in exactly one of them, the one that lists it (`34-subdomains.md`) | `capability-unplaced`, `capability-twice`; convention for the lists |
| the Architecture is written once per product, after `domain-discovery` and before `spec-all`; a second run publishes `r2` and the Specs that follow cite it | convention |

## Decisions

- An agent writes the Architecture and takes its Adrs, as proposals a human confirms at the Gate:
  the agent already makes the strategy decisions in the Architecture, and an `S-n` without an Adr
  is a decision with no alternatives and no consequences recorded. Adrs inside the Architecture
  content, no second kind, was rejected: the `Adr` kind exists, provenance cites it, and a
  superseded Adr outlives an Architecture revision. Found in design review.
- The human confirms what a Validator cannot judge: the block cut, the strategy and its Adrs, the
  quality goals and their order, the constraints; `architecture-consistency` sits beside it with
  ids and citations. The Prd process has the same split. Found in design review.
- `contexts`, `domainModels` and `glossaries` are `artifacts` inputs the caller lists, one entry per
  context: an Architecture is per product and a block that realises two contexts is the point of the
  view. Filling the lists by query is the roadmap row `10-ports.md` already has. Found in design review.
- The Adrs are an `artifacts` output under the prefix `<prd>-adr`, the first in the pack, and the
  reason a Task may output a list (`12-task.md`). A round two republishes every Adr as its next
  revision. The loop's `previous` carries the subject only, so round two rewrites the Adrs without
  seeing its own: an Adr the human did not name is regenerated from the same inputs and may drift
  in wording. Found in design review; the blind rewrite found in audit.
- The loop now carries the Adrs (`carry: {adrs: previousAdrs}`) and the Task starts each Adr from
  its last revision, changing one only for a finding that names it or its `S-n`. No Validator
  checks the drift: an Adr is prose, and nothing in `checkArchitecture` reads the Adrs' text; the
  instruction is the enforcer until the Design evaluator lands. Found in UAT (example08).
- The n-th Adr backs `S-n` and a dropped strategy keeps its slot as a `superseded` Adr: the first
  live round two dropped `S-2` and `S-5` and republished five Adrs under `adr-1` to `adr-5`, so
  `adr-2` r2 backed `S-3` while r1 had backed `S-2`, one id for two decisions. Position equal to the
  S-number keeps an id one decision for good; the Adr now says its `S-n` outright, below.
  Found in audit.
- An architect Adr cites `QG-n`, `C-n` and `QS-n` of the Architecture published in the same
  attempt, which its provenance does not pin: provenance pins the Task's inputs, and the
  Architecture is an output beside it. The Validator resolves those ids in the Architecture it
  evaluates with the Adrs; a reader follows `decisions[]` back. The pack rule row for an `Adr` says
  so. Found in audit.
- `context.business[].context` is not checked against the contexts evaluated: the worked example
  names `identity` and `accounting`, neighbours no process has written. The pack rule row says so.
  Found in implementation.
- Proven live on `claude-sonnet-5` over the meeting room brief: round one gave seven blocks, an
  event-driven read model, a worker and an analytical store for an office of eighty; the human's
  three findings (merge `BB-2` to `BB-4` into `BB-1`, drop `S-2` and `S-5`, add maintainability)
  came back in round two as four blocks, five strategies with gaps, `QG-5`, `C-7`, `QS-5`, five
  Adrs republished as `r2`. The Validator passed both rounds; the human was the judge of size.
  Found in UAT.
- "Adr n backs `S-n`" pairs by position, so once strategy ids gap (`S-1, S-3, S-4, S-6, S-7`) the
  pairing is implicit: `adr-2` backs `S-3`. The `strategy` field, below, makes it explicit and
  checked. Found in UAT.

- An Adr names the `S-n` it backs in `strategy`, and `adr-strategy` holds it to its slot: the
  positional pairing went implicit as soon as strategy ids gapped, and a reader of `adr-2` had to
  count; now the Adr says it and the Validator checks position against the claim, so a slot that
  changes decision between rounds is a finding, not a convention. The slot rule stays positional
  because round two sees only the Architecture (`previous` carries the subject), and "slot n is
  `S-n`" is the one order it can rebuild blind; "keep the first round's order" could not be followed,
  found in audit of the first cut. The field is optional on the kind: an Adr taken outside the loop
  (the worked example's two) backs no strategy and sits in no slot. An existing project takes the
  field on `apply`, an optional property every committed Adr validates under (`01-kind-definition.md`). Not
  rerun live: the check is pure and the next end-to-end UAT records the first conformant Adrs;
  example07's recording predates the slot rule (`adr-2` backs `S-3`) and names no strategy, said in
  its README. Found in UAT; the field built from the roadmap.
- The auditor takes `base` and `baseAdrs` as the writer does: without them, round one of a later
  Rewrite pack Slice judged a revised Architecture without the one it revises, and could flag a
  block or an Adr the base already settled. The human's form does not take them; the auditor's
  verdict reaches it. Found in review.

## Examples

- A level 1 block names its stack: the language and its version, the framework, the store's
  product ("Node 22, Fastify 5", "PostgreSQL 16", "MinIO"). In the full-Plan UAT the blocks said
  "Node service" and "object store, EU region", and the scaffold, the TestHarness and every
  builder chose for themselves. `checkArchitecture` refuses `technology-missing`; whether a label
  names a product is the auditor's `technology-vague`, since no word list tells a product from a
  category. A choice the Prd and the Adrs do not settle is an Adr or a `Q-n` for the human.
  `examples/` keeps the labels its live runs wrote. Found in UAT.
- `docs/design/examples/sdlc-domain.yaml`: `Architecture/expense-claims-architecture` with its
  two Adrs; passes `checkArchitecture` against the Prd, the `expenses` context, its Glossary and the
  rules (`test/adapters/sdd.test.ts`).
- `examples/example07/room-booking-domain.yaml`: the Architecture the `architect` loop wrote for
  the meeting room brief, with its Adrs.
