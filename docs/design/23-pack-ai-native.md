# AI Native pack

status: draft · layer: 2 · schema: none; the pack is a directory of ordinary Resource files (`20-pack.md`)

A delivery process built on the engine's Layer 1 kinds, borrowed from the spec-driven tools and
skills collections people already run (`docs/reference/80-ai-native-pack-references.md`). This
file grows one artifact kind at a time; the demo pack `packs/sdlc/` is untouched.

```text
every arrow: "cites", downstream ──▶ upstream; the arrow's head is a Task input of its tail

Glossary, BusinessRules, DecisionTable ──▶ BoundedContext     one each per context; a table cites BR-n
EventStorming ──▶ Prd r1 (the idea)                          the board, in the tool's DSL (24-eventstorming.md)
the domain kinds above ──▶ EventStorming (derived, unit 2); Prd r2 ──▶ BoundedContext, BusinessRules (CAP-n cite them)
Adr ──▶ Prd, rules (baseline) or Architecture (later)          taken first, pinned by provenance
Architecture ──▶ Prd, BoundedContext (3, 5), Adr (9), Glossary (12), DomainModel (8, later)   arc42 baseline, once per product
Spec per CAP-n (later) ──▶ Prd, Architecture, domain kinds
Design per CAP-n (later) ──▶ Spec, Architecture;  Plan (later) ──▶ Design;  work ──▶ Plan
why, for whom: Prd · exactly what: Spec · how: Architecture, Design · work: Plan
```

Every arrow is a Task input: the author Task reads the upstream artifact, so `provenance.inputs`
pins the revision it cited. Ids inside content (`BR-n`, `CAP-n`, `QG-n`) are for the reader and the
Validators; the engine never resolves them. Links point upstream only: a Design cites its Spec, a
Spec never names a Design; "which Design implements this Spec" is a Relation query.

## Artifact kinds

All in group `sdd.persimmon.ai`, Namespaced, Immutable, revisioned, `snapshot: "None"`
(`18-artifact.md`). Schemas in `packs/ai-native/global/10-artifact-kinds.yaml`.

| Kind | Answers | Content |
|---|---|---|
| `BoundedContext` | where one model holds | `name`, `purpose`, `inScope[]`, `outOfScope[]`, `owner?`, `relationships[] {context, role: upstream\|downstream\|peer, pattern, note?}` |
| `Glossary` | what words mean here, what can be said about them | `title`, `context`, `terms[] {name, definition, aliases?, related?, status, replacedBy?}`, `factTypes[] {name, subject, predicate, object: term \| {type, unit?, values?}, description?, status}` |
| `BusinessRules` | what is always true here | `title`, `context`, `owner`, `rules[] {id BR-n, type: fact\|constraint\|derivation\|decision, statement, rationale, source?, owner?, effectiveFrom?, effectiveTo?, status, examples?, factType?, logic?}`; `logic {inputs[] {name, factType}, when?: Condition, then: {violation} \| {derive, expression} \| {decision: {output: literal}}}`; `Condition` is `{all[]}`, `{any[]}`, `{not}` or `{field, op, value?}` with `op` in eq ne lt lte gt gte in notIn present absent |
| `DecisionTable` | which outcome for which inputs | `title`, `context`, `decision`, `owner`, `source?`, `effectiveFrom?`, `effectiveTo?`, `status`, `cites[] BR-n`, `inputs[] {name, factType}`, `outputs[] {name, type, values?}`, `hitPolicy: unique\|first\|priority\|any\|collect`, `rows[] {id R-n, when: {input: unary test}, then: {output: literal}, cites?, note?}` |
| `Adr` | one decision and why | `title`, `status: proposed\|accepted\|rejected\|superseded\|deprecated`, `deciders[]`, `context`, `drivers[] QG-n\|C-n\|QS-n\|BR-n\|G-n\|CAP-n\|SC-n`, `decision`, `alternatives[] {option, rejectedBecause}`, `consequences[] {kind, statement}`, `supersedes?` (Adr id) |
| `Architecture` | how the product is shaped (arc42) | `title`, `owner`, `status`, 1 `introduction {prd, qualityGoals[] QG-n (ISO 25010:2023), stakeholders[]}`, 2 `constraints[] C-n`, 3 `context {business[], technical[]}`, 4 `strategy[] S-n`, 5 `buildingBlocks[] BB-n` (`parent?` for lower levels, `technology?`) and `relations[] {id REL-n, from, to, description, interface?, technology?}`, 6 `runtime[] RT-n?`, 7 `deployment?`, 8 `concepts[] CC-n` + `domainModels[]`, 9 `decisions[]` (Adr ids), 10 `qualityScenarios[] QS-n`, 11 `risks[] RK-n?`, 12 `glossaries[]` |
| `EventStorming` | what happens in the domain, in whose words | DSL v4.0 of the event storming tool, `24-eventstorming.md`: `version`, `meta {name, level}`, `contexts[]`, `contextRelationships[]`, `nodes[]`, `edges[]` |
| `Prd` | why, for whom, what capabilities | `title`, `problem`, `users[]`, `goals[] G-n`, `nonGoals[]`, `capabilities[] {id CAP-n, name, description, priority, context, rules?}`, `successCriteria[] {id SC-n, statement, capabilities?}`, `assumptions[]`, `openQuestions[] {id Q-n, question, resolution?}` |

## Citation

| Citing | Field | Cites | How |
|---|---|---|---|
| `Glossary`, `BusinessRules`, `DecisionTable` | `context` | one `BoundedContext` | artifact id; one Glossary per context |
| `BusinessRules` `logic.inputs[]`, `DecisionTable` `inputs[]` | `factType` | `Glossary` fact types | by name; the fact type's `object` is the input's type |
| `DecisionTable` | `cites[]`, `rows[].cites[]` | `BusinessRules` rules | `BR-n`; the table implements them |
| `BoundedContext` | `relationships[].context` | other `BoundedContext`s | artifact id; each side keeps its own view |
| `Prd` | `capabilities[].context` | one `BoundedContext` per capability | artifact id; a Prd may span contexts |
| `Prd` | `capabilities[].rules[]` | `BusinessRules` rules | `BR-n`; the rules artifact is a Task input |
| `Prd` | `successCriteria[].capabilities[]` | its own capabilities | `CAP-n`; absent means the product as a whole |
| `Architecture` | `introduction.prd` | one `Prd` | artifact id; the requirements are the Prd, never restated |
| `Architecture` | `decisions[]`, `domainModels[]`, `glossaries[]`, `buildingBlocks[].contexts[]`, `context.business[].context` | `Adr`, `DomainModel`, `Glossary`, `BoundedContext` | artifact ids; an Adr is taken first and cites the revision it was taken against in provenance, the Architecture revision that applies it lists it |
| `Adr` | `drivers[]`, prose | `QG-n`, `C-n`, `QS-n` of the Architecture, `BR-n` of the rules, `G-n`, `CAP-n`, `SC-n` of the Prd | by id, in the revisions provenance pins |
| any | prose | `Glossary` terms | by using the term; `aliases` never appear in documents |

## Rules

| Rule | Enforcer |
|---|---|
| ids (`BR-n`, `R-n`, `G-n`, `CAP-n`, `SC-n`, `Q-n`, `QG-n`, `C-n`, `S-n`, `BB-n`, `REL-n`, `RT-n`, `CC-n`, `QS-n`, `RK-n`) unique in a document, sequential from 1, never reused across revisions; term and fact type `name`s unique in a Glossary, never reused; a revision keeps every id and name and fixes in place | author Prompt; Validator later |
| a term's `aliases` never name another term; a `relationships[]` entry's `role` fits its `pattern` (conformist, anticorruption-layer: downstream; open-host-service, published-language: upstream; shared-kernel, partnership, separate-ways: peer; customer-supplier: either) | Validator later |
| a `fact` names its `factType` and is a structural rule over it (cardinality, necessity); a `fact`'s or `constraint`'s `then` is a `violation`, a `derivation`'s is `derive` + `expression`, a `decision`'s is `decision`; `when` absent means always; a rule without `logic` is informal and says so in `rationale` | Validator later |
| a `decision` rule's `then.decision` keys are outputs of the `DecisionTable` that cites it; in a `unique` table every row cites exactly one `decision` rule and every `decision` rule the table cites sits in exactly one row; a row's `cites` ⊆ the table's `cites`, which also holds the constraints behind its inputs | Validator later |
| `logic.inputs` and table `inputs` name active fact types; a fact type's `subject` and a string `object` name terms; a condition `field` names an input; `then.derive` names an input; an input over a term-valued fact type takes `eq`, `ne`, `in`, `notIn`, `present`, `absent` only (equality is identity) | Validator later |
| a `unique` table's rows never overlap (DMN) and, as a pack rule, cover every combination of its inputs' types; `first` and `priority` rows are ordered | Validator later |
| `expression` and unary tests are a FEEL subset: literals, `- + * /`, `if then else`, comparisons, `[a..b]`, `a, b`, `-` for any; nothing in the pack evaluates them yet | convention; evaluator later |
| a withdrawn rule or term stays with `status: deprecated` (`replacedBy` for a term) so no citation dangles | author Prompt; Validator later |
| cited `context` exists, except `relationships[].context` and `Architecture.context.business[].context`, which may name a context in another Namespace or not yet written; cited `BR-n` exists and is active in the input revision; `related` and `replacedBy` resolve | Validator later; schema cannot see across documents or entries |
| an unknown fact is a `Q-n`, never a guess; a Prd with open questions is valid and gated later | author Prompt |
| inside an `Architecture`: `strategy[].addresses`, `qualityScenarios[].qualityGoal`, `buildingBlocks[].parent`, `deployment.nodes[].hosts`, `deployment.channels[].from/to` (nodes), `runtime[].steps[].from/to` and `relations[].from/to` (a `BB-n` or a `context.business[].partner`, at least one end a block) resolve; `relations[].interface` is an interface the `to` block provides, or the `from` block requires when `to` is a partner; every level 1 block and every partner has a relation; every `QG-n` has at least one `QS-n`; level 1 blocks' `contexts` cover every `BoundedContext` the Prd's capabilities name; `decisions[]` name Adrs with status `accepted` | Validator later |
| a Spec never cites a Design, a Design never cites a Plan, an Architecture never names a Spec story: every artifact cites upstream only; downstream is a Relation query | author Prompt; convention |
| an `Adr`'s `drivers` resolve in the revisions its `provenance.inputs` pin (a Prd and rules for a baseline Adr, an Architecture later); the Adr carries no artifact id of its own for them | Validator later |
| `goals` give direction without a number; `successCriteria` carry the number; `successCriteria` and `capabilities` name no technology, architecture or task | author Prompt |
| a success criterion is an outcome measured in production over time, decided by measurement; a behaviour one test decides on one run is an acceptance criterion and belongs to a Spec story; a capability no success criterion names is reported | author Prompt; Validator later |

## Decisions

- Two levels, not one: a `Prd` per product or initiative (why, for whom, capabilities), a `Spec`
  per capability (stories, EARS acceptance, FR, NFR, entities). spec-kit's `spec.md` is the second;
  BMAD's PRD mixes both. A PRD revises rarely and is judged on goals and scope; a spec revises per
  feature and is judged on completeness and testability. Brownfield deltas (OpenSpec) attach at the
  spec level.
- `BusinessRules` is a kind of its own, one per `BoundedContext`: rules outlive any document, a
  domain owner signs them, and a citation by `BR-n` re-checks every citing document when they change.
  Types `fact | constraint | derivation | decision` (Business Rules Group, with von Halle's inference as
  `decision`); process rules are EARS in a Spec.
- Rules are layered, no single standard: SBVR for the vocabulary (`Glossary.factTypes`), RuleSpeak for
  the sentence every rule has, a typed condition tree as the one machine form (`rules[].logic`), a DMN
  subset for decisions (`DecisionTable`), governance fields on every rule and table (`owner`, `source`,
  `effectiveFrom`, `effectiveTo`, `status`). A natural-language sentence is never the only basis for a
  judgement: an agent extracts, explains and maps rules; a Validator checks them; a test derives from
  them. Nothing in the pack evaluates logic or FEEL yet; the forms are chosen so an evaluator can.
  Found in design review.
- `DecisionTable` is its own kind beside the `decision` rule type: a decision rule is one signed
  outcome with its rationale and source; the table is the whole question, checkable for coverage and
  overlap. Rows and rules cite each other one to one. The sentence and the cells duplicate on purpose.
  A decision written as a constraint ("must be approved without a decision") named no violation; the
  reader and the Validator need "pick" and "stop" told apart. Found in design review.
- Success criteria live in the `Prd` only, acceptance criteria in the `Spec` only. spec-kit keeps both
  in `spec.md`; here an outcome (users, time, a number from production) and a behaviour (one story, one
  test, one run) are judged by different people at different times, so they never share a list. The
  chain is SC ← CAP ← Spec ← US ← AC; `successCriteria[].capabilities` is the only explicit link.
  Found in design review.
- `Glossary` is a kind of its own, one per `BoundedContext`: the same word means different things in
  different contexts, and every artifact in a context uses the same language. Term identity is
  `name`; documents cite by using the term.
- `BoundedContext` is an artifact kind, not a free string: hand-written now, derived from an event
  storming artifact later, same shape either way. The context map lives in `relationships` inside
  the content, each side its own view, because a Relation carries no pattern attribute and the map is
  part of what a domain owner reviews.
- Two levels of design. The `Architecture` (arc42, once per product) comes right after the `Prd`,
  before any `Spec`: constraints, quality scenarios and building blocks are the frame a Spec is written
  inside, and a Spec writes only its deltas to them. A capability `Design` comes after its Spec and
  holds the data schema, API and runtime detail, so acceptance criteria stay storage-free. arc42's
  activities have no fixed order; here iteration is a revision. Found in design review.
- `Adr` is a kind of its own, one artifact per decision, not arc42's section 9 as a list: a decision
  outlives the document that first applied it, Architecture and every Design share it, and a status
  change is a revision of the same id. Section 9 lists Adr ids. Found in design review.
- `Architecture.introduction` holds no requirements prose, only the Prd's id: one truth, in the Prd.
  Found in design review.
- Fields are the truth, diagrams are views: a C4 container diagram is `buildingBlocks[]` plus
  `relations[]`, rendered into representations by a render Task later, never typed into content. Mermaid
  is a picture grammar with no model, so it is output only; a model DSL (LikeC4) stays a candidate for
  sections 3, 5, 6, 7 if the YAML proves clumsy to write. Relations are explicit because interface-name
  matching cannot say which block a partner talks to. Found in design review.
- `runtime[]` carries no Spec story id: the Spec is downstream of the Architecture, and a scenario
  naming `US-n` was the one downstream link in the pack. Which scenario realises a story is a Relation
  query. Baseline Adrs are driven by the Prd and the rules, never by a `QG-n` that first exists in the
  Architecture that lists them. Found in audit.
- Every object in the seven schemas closes with `additionalProperties: false`: a misspelt optional field
  (`effectivefrom`) passed silently and the Validators would never see it. Found in audit.
- RuleSpeak keeps its rule keyword in every `statement`: `must`, `must not`, `may ... only`, `must be
  computed as`, `must be considered <outcome> if`. "is computed as" and "is <outcome> when" read as
  descriptions, not rules. Found in audit.
- `fact` stays as a type and means a structural rule over one named fact type (SBVR structural
  necessity: cardinality, mandatory); the fact types themselves live in the Glossary. BRG's word, SBVR's
  meaning. Found in audit.
- Table-level `cites` and row `cites` both stay: a row cites the one decision rule it is; the table cites
  those and the constraints behind its inputs (`complete` is BR-2 over every line). Found in audit.
- `goals` stay beside `successCriteria` as direction without a number: a metric changes, the reason
  survives. Found in audit.
- Group `sdd.persimmon.ai`, kind `Prd`: the demo pack's `ProductRequirement` and example06's
  `EarsPrd` keep their names in `engineering.persimmon.ai`; no collision.

## Examples

- [`examples/ai-native-domain.yaml`](examples/ai-native-domain.yaml): one domain, expense claims, as a big-picture
  `EventStorming` model, a
  `BoundedContext`, its `Glossary` with fact types, `BusinessRules` with logic, the `DecisionTable`
  that routes a claim, the `Prd` that cites them, two `Adr`s and the `Architecture` that applies
  them; validates after the pack is applied
