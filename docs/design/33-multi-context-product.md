# Multi-context product

> The Prd's `contextIds` and the context tags on capabilities and rules are superseded by
> `34-subdomains.md`: the Prd names subdomains, the storming cuts the contexts.

status: draft · layer: 2 (`23-pack-sdlc.md`, `26-domain-discovery.md`, `28-prd-process.md`, `31-architecture-process.md`) and one CLI convenience (`08-store.md`) · schema: the `BusinessRules` kind in `packs/sdlc/global/10-artifact-kinds.yaml`

One product, several bounded contexts, through the whole chain. Today the Prd process runs over
one context (`28-prd-process.md`: "a product spanning contexts runs it once per context and the
Prds are merged by hand"), while domain discovery, the Architecture and the Plans already take the
product whole. This closes the gap with the smallest change: the rules become product-level with a
context tag on each rule, the Prd takes the product's context ids, and the caller stops listing the
domain artifacts by hand.

```text
brief ─▶ author-prd (productId, contextIds) ─▶ Prd <product>-prd, BusinessRules <product>-rules (contexts[], rules[].context)
      ─▶ domain-discovery: storm the product, derive-all per context                     unchanged
      ─▶ architect: contexts, domainModels, glossaries by `kind:` query, rules one        unchanged but the query
      ─▶ spec-all per context (its capability ids, its model), design-all per context    unchanged, run per context
      ─▶ design-system once, design-all ui over the client blocks, plan-all once          unchanged
```

## Why product-level rules

A Spec, a Design and an Adr cite a rule as `BR-n` with no artifact id (`23-pack-sdlc.md`,
relation rows). Two rules artifacts would number from `BR-1` each, so a citation would be ambiguous
the moment a product had two contexts. One artifact per product keeps `BR-n` unique everywhere a
rule is cited; the context a rule governs is a tag on the rule, which is where it belongs (a rule is
enforced where its command is refused, one context). Every downstream check reads rule ids only
(`checkSpec`, `checkDesign`, `checkArchitecture`), so nothing but `checkPrd` changes.

## `BusinessRules`

| Field | Change |
|---|---|
| `contexts[]` | replaces `context`: the BoundedContext ids these rules govern, at least one |
| `rules[].context` | the context the rule is enforced in; required by the Validator when `contexts` has more than one, one of them when present |

A one-context product writes `contexts: [room-booking]` and tags nothing. The kind is revisioned, so
the rename reaches an existing project only as a fresh one (`91-roadmap.md`); the recorded examples
are migrated by the rename alone, said in their README.

## Process

| Member | Change |
|---|---|
| Task `draft-prd`, ReviewLoop `author-prd` | inputs `productId` (the id stem) and `contextIds` (one or more) replace `contextId`; outputs `<productId>-prd` and `<productId>-rules`; a one-context product passes the same id twice |
| Prompt `prd-rules` | `capabilities[].context` is one of `contextIds`, never another; `rules.contexts` is `contextIds`; with more than one context every rule carries `context`; a capability that needs two contexts is two capabilities, as before |
| Validator `prd-consistency` (`checkPrd`) | `context-mismatch`: a capability's `context` not in `rules.contexts`; a cited rule whose `context` is set and differs from the capability's; a rule without `context` when `contexts` has more than one |
| Prompt `storming-big-picture` | (superseded, `34-subdomains.md`) the Prd's capability contexts are the storming contexts, with the ids the Prd uses, so `derive-all` publishes the BoundedContexts the capabilities cite (already said; restated with the list) |
| Prompt `derive-domain-rules` | invariants and `rules` citations take the rules tagged with this context, or untagged |
| (`spec-all` takes the BoundedContext too, `34-subdomains.md`) `spec-all`, `design-all` | unchanged: one run per context, with that context's capability ids or blocks and its DomainModel and Glossary; a Workflow cannot read a Prd to pick a capability's context, so the caller does (`27-spec-process.md`, `29-design-process.md` rows stand) |
| `architect`, `design-system`, `plan-all` | unchanged |

## `kind:` query at `run`

`persimmon run <wf> --input <port>=kind:<Kind>` on an `artifacts` port: the CLI lists every
artifact of that kind in the run's Namespace at its latest committed revision, ordered by id, and
binds the refs as if given in a file. Refused on any other port, and when nothing of that kind is in
the Namespace. Inside a Workflow, a step filters the same set by content with `fromQuery`
(`10-ports.md`). In local mode a project is one product, so "every BoundedContext" is the product's;
`persimmon run architect --input contexts=kind:BoundedContext --input domainModels=kind:DomainModel --input glossaries=kind:Glossary ...`.

## Rules

| Rule | Enforcer |
|---|---|
| one BusinessRules per product, `BR-n` unique across the product, each rule tagged with the context that enforces it when the product has more than one; a Prd, Spec, Design or Architecture names the artifact in `businessRules`, the Validator holds it to the one bound and to what the upstream document names (a Spec's Prd, a Design's Architecture, an Architecture's Prd), so a `BR-n` is a pair (artifact id, `BR-n`) and two products' `BR-11` never meet | `prd-consistency`, `spec-consistency`, `design-consistency`, `architecture-consistency` (`rules-mismatch`) `prd-consistency` |
| a capability lives in one context and cites rules of its context (or untagged ones) | `prd-consistency` |
| (`spec-all` takes the BoundedContext too, `34-subdomains.md`) `spec-all` and `design-all` run once per context: the caller passes that context's capability ids or block ids with its DomainModel and Glossary | convention; roadmap for a per-item pick |
| a `ui` Design of a client block that reads two contexts takes the DomainModel of the one it reads most; its other read models are `Q-n` until `design-asset` takes a list of models | convention; roadmap |
| `kind:` lists the Namespace's artifacts of one kind, latest revision each: the whole product, because a local project is one product | CLI; `08-store.md` |

## Decisions

- Rules product-level with a tag, not one artifact per context: `BR-n` is cited bare by every
  downstream kind and must stay unique; the roadmap row "`rules` as a list" would have made every
  Validator and Prompt take a list and still left `BR-1` ambiguous. Found in design review.
- `productId` beside `contextIds` instead of deriving the product id from the first context: the
  Prd and the rules name the product, the contexts name parts of it; a one-context product repeats
  the id and nothing else changes. Found in design review.
- The query is a `run` convenience, not an engine binding: every list the pack needs is given at
  `run` by the person who starts the step, and local mode has one product per project, so "every
  artifact of a kind" is the right list without a filter language. Found in design review.
- (`spec-all` also binds the BoundedContext since `34-subdomains.md`.) `spec-all` and `design-all` stay per context: a Workflow reads no artifact content, so it cannot
  map a capability to its context's model; two runs with explicit ids are honest and cheap. Found in
  design review.
- Live on `claude-sonnet-5` (example08, `uat3`): the Prd came back with nine capabilities over the
  two contexts and the rules tagged; the human rejected round one on a capability's name and one
  rule. Each storming phase passed at round two after one human rejection; the derivation of both
  contexts passed first time. The Architecture's round one cut two services and a gateway; the
  rejection asked for one deployable realising both contexts, which `kind:` queries bound the lists
  for. Nine Specs, four Designs of `BB-1` (two APIs, two schemas, told apart by `qualifier`), the
  DesignSystem and the `ui` Design each passed round one. Found in UAT.
- A storming phase re-raised Prd questions a previous Gate had settled: a Gate's answers live in
  that loop's `feedback` only. The Prompt now reads a settled question off the confirmed `base` and
  never raises it again (`26-domain-discovery-process.md`). Found in UAT.
- A client block over two contexts showed the `ui` Design's `domainModel` was the wrong layer: a
  Design binds one model, the web application serves two. The `ui` Design now realises operations of
  the block's API Designs and binds no model (`32-ui-design-process.md`). Found in UAT.

## Examples

- `examples/example08/`: a company car pool over two subdomains and two contexts, `reservations` and
  `fleet-care`, thirty-six artifacts produced live under `34-subdomains.md`: one Prd and rules, one
  storming, two of each context kind, the Architecture and four Adrs, seven Specs, six module Designs
  (http-api, async-api, data-schema for each of two modules), the DesignSystem, one `ui` Design over
  both APIs, seven Plans. An earlier recording, under this design's context tags, was the first under
  the Adr slot rule (`31-architecture-process.md`) and the `ui` index over operations
  (`32-ui-design-process.md`).
