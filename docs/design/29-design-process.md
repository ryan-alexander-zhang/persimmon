# Design process

status: draft · layer: 2 (`23-pack-ai-native.md`, `27-spec-process.md`) · schema: the `Design` kind in `packs/ai-native/global/10-artifact-kinds.yaml`

From an Architecture block to its Designs: an agent writes one contract or schema per block
and type (an OpenAPI document for the interface a block provides, an AsyncAPI document for the
events it publishes, a schema for the aggregates it stores) from the Architecture, the DomainModel,
the Glossary and the rules; a Validator checks the asset's index against them; the loop feeds
findings back once. A Design is shared by every capability of the block; no Spec cites it.

```text
Workflow design-all: repeat over `blocks` with one `type` ─▶ ReviewLoop design-one per block
  produce: Task design-asset (design-agent) ─▶ Design
  review:  Gate design-gate = Validator design-consistency (sdd/v1: design, architecture, domainModel, rules)
  previous and feedback fed back; maxRounds 2
```

## Process

| Member | Content |
|---|---|
| Prompt `design-rules` | one asset per block and type; the contract whole and standard; the index names what each operation, channel or table realises in the DomainModel; refusals name the rule; field names are Glossary terms; nothing the DomainModel lacks is invented |
| Executor `design-agent` | `claude-code/v1`, read-only, its own name for per-Namespace override |
| Task `design-asset` | inputs `architecture`, `blockId`, `type`, `interface` (optional: which provided interface, else the block's first), `domainModel`, `glossary`, `rules`, `previous`, `feedback`; output `design` |
| Validator `design-consistency` | `sdd/v1` over `design`, `architecture`, `domainModel`, `rules`; the Design rule row of `23-pack-ai-native.md` as findings |
| Gate `design-gate` | consistency only |
| ReviewLoop `design-one` | `produce` `design-asset`, `review` `design-gate`, `maxRounds: 2`; takes `interface` too, so a block with two provided interfaces gets its second Design from a direct run |
| Workflow `design-all` | `repeat` over `blocks` (BB-n ids) for one `type`, as `spec-all` repeats over capabilities; a block the loop could not design ends the run `design_inconsistent`; output `written` |

## `checkDesign`

`adapters/sdd/check.mjs`, pure, `checkDesign({design, architecture, domainModel, rules})`, every finding `error`:

| Code | Finding |
|---|---|
| `not-a-design` | content without `elements` or `type`; the only finding then |
| `unknown-block` | `block` is no `BB-n` of the Architecture |
| `unknown-interface` | `interface` is no interface the block provides |
| `unknown-realised` | an element's `realises` is no command, event, read model label or `AG-n` of the DomainModel (the same name sets as `checkSpec`) |
| `unknown-rule`, `inactive-rule` | a `BR-n` at the root or on an element missing or not `active` |
| `rules-incomplete`, `rules-unplaced` | an element's rule the root `rules[]` lacks; a root rule no element enforces (the root is the union, both ways) |
| `type-mediatype` | `type` and `document.mediaType` do not pair (`http-api` OpenAPI, `async-api` AsyncAPI, `data-schema` JSON Schema or SQL) |
| `id-sequence` | `EL-n`, `Q-n` not unique and increasing |

The Adapter picks the mode from the payload: `artifacts.spec` (or `artifacts.model`), else
`artifacts.prd`, else `artifacts.design`.

## Rules

| Rule | Enforcer |
|---|---|
| the document is the truth, the index its checked view: a Validator never parses the contract today, so an operation without an element, or an element without an operation, is not a finding until the contract evaluator lands (`91-roadmap.md`) | convention; roadmap |
| one Design per block and type by `design-all`; a block with two provided interfaces gets the second from a direct `design-one` run with `interface` bound; the two are told apart by `interface` | `design-rules`; `design-all` runs once per type |
| `decisions[]` is not checked: no Adr is in the Validator's payload; the Architecture lists its Adrs and the Prompt picks from that list | convention; Validator later |
| a `data-schema` asset realises aggregates (`AG-n`), an `http-api` commands and read models, an `async-api` events; an asset of one type may still index the other kinds (an API that also serves an event feed) | `design-rules` |
| a Design cites Architecture, DomainModel, Glossary, BusinessRules and Adrs; never a Spec or a Prd: the contract follows from the domain and the block, not from one capability | `design-rules`; convention |

## Decisions

- The Task takes `blockId` and `type` and the loop repeats over blocks for one type: a product's
  blocks are few and known from the Architecture, and one asset per block and type is the unit of
  reuse. Running `design-all` three times (one per type) is simpler than a nested repeat. Found in
  design review.
- `interface` is optional on the kind but the Prompt requires it for an `http-api` or `async-api`: a
  `data-schema` has no interface; an API without one would be unplaceable. The Validator checks it when
  present. Found in design review.
- The example is the whole block, nine operations, not a slice for one capability: the Prompt demands
  one operation per command and read model the block's responsibility names, and the live run wrote
  ten; an example that broke its own Prompt taught the wrong shape. Found in audit.

- Proven live on `claude-sonnet-5`: `design-all` over `BB-1` and `BB-4`, type `http-api`, 3m04s,
  both passed `design-consistency` in round one. The claims API had ten operations, one per command
  and read model of the context, a 232-line OpenAPI document, refusals citing the rules; the export
  gateway two. The open questions were real DomainModel gaps: no read model for one claim's detail
  (the approver's screen, QS-4), no fact type for a rejection reason or an export status. Two things
  the Prompt now says: a read model's `updatedBy` may name another context's event (the `Claim Paid`
  question again), and a read model is realised by the block whose responsibility names it (both
  Designs had exposed `Export Status View`). Found in UAT.

## Examples

- `docs/design/examples/ai-native-domain.yaml`: `Design/claims-api`, the OpenAPI contract of `BB-1`'s
  `claims API` with nine elements, one per command and read model of the block; passes `checkDesign`
  (`test/adapters/sdd.test.ts`).
