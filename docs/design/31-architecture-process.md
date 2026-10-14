# Architecture process

status: draft · layer: 2 (`23-pack-ai-native.md`, `26-domain-discovery.md`, `28-prd-process.md`) · schema: the `Architecture` and `Adr` kinds in `packs/ai-native/global/10-artifact-kinds.yaml`

From a Prd, its rules and the derived domain kinds of every context to the product's Architecture:
an agent writes the arc42 baseline and one Adr per strategy decision; a Validator checks every
citation and the shape rules; a human confirms the block cut, the strategy and the quality goals;
the loop feeds findings back, three rounds at most. Once per product, after domain discovery and
before any Spec.

```text
ReviewLoop architect, run once per product with the contexts, models and glossaries listed by the caller (artifacts ports)
  produce: Task write-architecture (architecture-agent) ─▶ Architecture <prd>-architecture, Adr <prd>-adr-1, <prd>-adr-2, ... (an artifacts output, 12-task.md)
  review:  Gate architecture-gate = Validator architecture-consistency (sdd/v1) + architecture-confirmed (human)
  previous and feedback fed back; maxRounds 3
```

## Process

| Member | Content |
|---|---|
| Prompt `architecture-rules` | arc42 as the pack reads it: the Prd is the requirements by reference; every context realised by a level 1 block; strategy decisions cite `QG-n` and `C-n`; every quality goal has a scenario; one Adr per `S-n`, in order |
| Executor `architecture-agent` | `claude-code/v1`, read-only, its own name for per-Namespace override |
| Task `write-architecture` | inputs `prd`, `rules`, `contexts`, `domainModels`, `glossaries` (artifacts), `previous`, `feedback`; outputs `architecture` (id `<prd>-architecture`) and `adrs` (artifacts, prefix `<prd>-adr`) |
| Task `confirm-architecture` | human on `cli-human/v1`: reads the Architecture and its Adrs; approve, or one finding per `BB-n`, `S-n`, `QG-n`, `C-n`, `QS-n` or Adr id |
| Validators | `architecture-consistency`: `sdd/v1` over `architecture`, `prd`, `rules`, `contexts`, `domainModels`, `glossaries`, `adrs`; `architecture-confirmed` over `confirm-architecture` |
| Gate `architecture-gate` | consistency and confirmed, `all`, 72h |
| ReviewLoop `architect` | `produce` `write-architecture`, `review` `architecture-gate`, `maxRounds: 3`; the subject is the Architecture; the Adrs ride beside it as a second output and are republished whole each round |

Run: `persimmon run architect --input 'prd={...}' --input 'rules={...}' --input contexts=@contexts.yaml --input domainModels=@models.yaml --input glossaries=@glossaries.yaml`,
each list a YAML list of RevisionRefs (`08-store.md`), one entry per context in the same order.

## `checkArchitecture`

`adapters/sdd/check.mjs`, pure, `checkArchitecture({architecture, prd, rules, ids, adrs})` where
`ids` holds the Prd's id and the lists of context, model, glossary and Adr ids paired by
`index.mjs` from `inputs.<port>.refs[i]`, and `adrs` maps an Adr id to its content; every finding
`error`:

| Code | Finding |
|---|---|
| `not-an-architecture` | content without `buildingBlocks` or `introduction`; the only finding then |
| `prd-mismatch` | `introduction.prd` is not the id of the Prd bound |
| `unknown-context`, `context-unrealised`, `prd-context-unread` | a block's context not among those evaluated; a context evaluated that no level 1 block realises; a Prd capability's context not among those evaluated (`context.business[].context` is not checked: it may name a context of another Namespace or one not yet written) |
| `unknown-parent` | a block's `parent` is no `BB-n` |
| `model-mismatch`, `glossary-mismatch`, `adr-mismatch` | `domainModels[]`, `glossaries[]`, `decisions[]` differ from the ids evaluated, either way |
| `unknown-driver` | a strategy `addresses` id that is neither a `QG-n` nor a `C-n` |
| `unknown-quality-goal`, `goal-unscenarioed` | a scenario's goal not in the introduction; a goal with no scenario |
| `unknown-relation-end`, `relation-no-block`, `unknown-interface` | a relation end neither a block nor a partner; neither end a block; `interface` not provided by the `to` block, or not required by the `from` block when `to` is a partner |
| `block-unrelated`, `partner-unrelated` | a level 1 block or a partner with no relation |
| `adr-status`, `unknown-adr-driver` | an Adr not `accepted`; a driver that resolves in neither the Architecture (`QG`, `C`, `QS`), the Prd (`G`, `CAP`, `SC`) nor the rules (`BR`) |
| `id-sequence` | `QG-n`, `C-n`, `S-n`, `BB-n`, `REL-n`, `CC-n`, `QS-n`, `RK-n` not unique and increasing |

The Adapter picks the mode from the payload: `artifacts.plan` first, else `artifacts.spec` (or
`artifacts.model`), else `artifacts.design`, else `artifacts.architecture` (a Prd rides beside it),
else `artifacts.prd`.

## Rules

| Rule | Enforcer |
|---|---|
| the Architecture rule row of `23-pack-ai-native.md`, except `deployment` and `runtime` references and `decisions[]` with status `accepted` being the only Adrs (they are: `adr-status`) | `architecture-consistency` |
| the agent takes one Adr per `S-n`, in order, so `<prd>-adr-n` backs `S-n`; the Validator checks what it can see (status, drivers, the list), not the pairing | `architecture-rules`; convention |
| `status: accepted` on the Architecture and its Adrs is the author's claim; the Gate's pass is the fact, read from the run; a rejected round's artifacts are committed revisions all the same, as every produce output is | convention |
| every context the Prd's capabilities name is in `contexts`, and the caller lists its model and glossary beside it | `prd-context-unread`; convention for the lists |
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
  revision, so an Adr the human did not name changes only if the agent disobeys "change nothing
  else"; a shorter list leaves the tail at its last revision. Found in design review.
- `context.business[].context` is not checked against the contexts evaluated: the worked example
  names `identity` and `accounting`, neighbours no process has written. The pack rule row says so.
  Found in implementation.

## Examples

- `docs/design/examples/ai-native-domain.yaml`: `Architecture/expense-claims-architecture` with its
  two Adrs; passes `checkArchitecture` against the Prd, the `expenses` context, its Glossary and the
  rules (`test/adapters/sdd.test.ts`).
- `examples/example07/room-booking-domain.yaml`: the Architecture the `architect` loop wrote for
  the meeting room brief, with its Adrs.
