# AI Native pack

status: draft · layer: 2 · schema: none; the pack is a directory of ordinary Resource files (`20-pack.md`)

A delivery process built on the engine's Layer 1 kinds, borrowed from the spec-driven tools and
skills collections people already run (`docs/reference/80-ai-native-pack-references.md`). This
file grows one artifact kind at a time; the demo pack `packs/sdlc/` is untouched.

```text
BoundedContext ──┬─▶ Glossary        one per context: terms and fact types (SBVR), the ubiquitous language
                 ├─▶ BusinessRules   one per context: BR-n, one RuleSpeak sentence each, typed logic over fact types
                 └─▶ DecisionTable   one per decision (DMN subset): inputs over fact types, hit policy, rows; cites BR-n
                        │ cited by id
Prd ── capabilities CAP-n ──▶ Spec (one per capability, later) ──▶ Design ──▶ Tasks
      why, for whom              exactly what                      how        work
```

Every arrow is a Task input: the author Task reads the upstream artifact, so `provenance.inputs`
pins the revision it cited. Ids inside content (`BR-n`, `CAP-n`) are for the reader and the
Validators; the engine never resolves them.

## Artifact kinds

All in group `sdd.persimmon.ai`, Namespaced, Immutable, revisioned, `snapshot: "None"`
(`18-artifact.md`). Schemas in `packs/ai-native/global/10-artifact-kinds.yaml`.

| Kind | Answers | Content |
|---|---|---|
| `BoundedContext` | where one model holds | `name`, `purpose`, `inScope[]`, `outOfScope[]`, `owner?`, `relationships[] {context, role: upstream\|downstream\|peer, pattern, note?}` |
| `Glossary` | what words mean here, what can be said about them | `title`, `context`, `terms[] {name, definition, aliases?, related?, status, replacedBy?}`, `factTypes[] {name, subject, predicate, object: term \| {type, unit?, values?}, description?, status}` |
| `BusinessRules` | what is always true here | `title`, `context`, `owner`, `rules[] {id BR-n, type: fact\|constraint\|derivation\|decision, statement, rationale, source?, owner?, effectiveFrom?, effectiveTo?, status, examples?, factType?, logic?}`; `logic {inputs[] {name, factType}, when?: Condition, then: {violation} \| {derive, expression} \| {decision: {output: literal}}}`; `Condition` is `{all[]}`, `{any[]}`, `{not}` or `{field, op, value?}` with `op` in eq ne lt lte gt gte in notIn present absent |
| `DecisionTable` | which outcome for which inputs | `title`, `context`, `decision`, `owner`, `source?`, `effectiveFrom?`, `effectiveTo?`, `status`, `cites[] BR-n`, `inputs[] {name, factType}`, `outputs[] {name, type, values?}`, `hitPolicy: unique\|first\|priority\|any\|collect`, `rows[] {id R-n, when: {input: unary test}, then: {output: literal}, cites?, note?}` |
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
| any | prose | `Glossary` terms | by using the term; `aliases` never appear in documents |

## Rules

| Rule | Enforcer |
|---|---|
| ids (`BR-n`, `R-n`, `G-n`, `CAP-n`, `SC-n`, `Q-n`) unique in a document, sequential from 1, never reused across revisions; term and fact type `name`s unique in a Glossary, never reused; a revision keeps every id and name and fixes in place | author Prompt; Validator later |
| a term's `aliases` never name another term; a `relationships[]` entry's `role` fits its `pattern` (conformist, anticorruption-layer: downstream; open-host-service, published-language: upstream; shared-kernel, partnership, separate-ways: peer; customer-supplier: either) | Validator later |
| a `fact` names its `factType` and is a structural rule over it (cardinality, necessity); a `fact`'s or `constraint`'s `then` is a `violation`, a `derivation`'s is `derive` + `expression`, a `decision`'s is `decision`; `when` absent means always; a rule without `logic` is informal and says so in `rationale` | Validator later |
| a `decision` rule's `then.decision` keys are outputs of the `DecisionTable` that cites it; in a `unique` table every row cites exactly one `decision` rule and every `decision` rule the table cites sits in exactly one row; a row's `cites` ⊆ the table's `cites`, which also holds the constraints behind its inputs | Validator later |
| `logic.inputs` and table `inputs` name active fact types; a fact type's `subject` and a string `object` name terms; a condition `field` names an input; `then.derive` names an input; an input over a term-valued fact type takes `eq`, `ne`, `in`, `notIn`, `present`, `absent` only (equality is identity) | Validator later |
| a `unique` table's rows never overlap (DMN) and, as a pack rule, cover every combination of its inputs' types; `first` and `priority` rows are ordered | Validator later |
| `expression` and unary tests are a FEEL subset: literals, `- + * /`, `if then else`, comparisons, `[a..b]`, `a, b`, `-` for any; nothing in the pack evaluates them yet | convention; evaluator later |
| a withdrawn rule or term stays with `status: deprecated` (`replacedBy` for a term) so no citation dangles | author Prompt; Validator later |
| cited `context` exists, except `relationships[].context`, which may name a context in another Namespace or not yet written; cited `BR-n` exists and is active in the input revision; `related` and `replacedBy` resolve | Validator later; schema cannot see across documents or entries |
| an unknown fact is a `Q-n`, never a guess; a Prd with open questions is valid and gated later | author Prompt |
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
- Every object in the five schemas closes with `additionalProperties: false`: a misspelt optional field
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

- [`examples/ai-native-domain.yaml`](examples/ai-native-domain.yaml): one domain, expense claims, as a
  `BoundedContext`, its `Glossary` with fact types, `BusinessRules` with logic, the `DecisionTable`
  that routes a claim, and the `Prd` that cites them; validates after the pack is applied
