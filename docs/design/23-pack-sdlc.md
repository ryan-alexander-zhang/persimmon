# SDLC pack

status: draft · layer: 2 · schema: none; the pack is a directory of ordinary Resource files (`20-pack.md`)

A delivery process built on the engine's Layer 1 kinds, borrowed from the spec-driven tools and
skills collections people already run (`docs/reference/80-sdlc-pack-references.md`). `persimmon init`
applies it (`20-pack.md`). This file grows one artifact kind at a time.

```text
every arrow: "cites", downstream ──▶ upstream; the arrow's head is a Task input of its tail

Glossary, BusinessRules, DecisionTable ──▶ BoundedContext     one each per context; a table cites BR-n
EventStorming ──▶ Prd r1 (the idea)                          the board, in the tool's DSL (24-eventstorming.md)
the domain kinds above ──▶ EventStorming (derived, unit 2); Prd r2 ──▶ BoundedContext, BusinessRules (CAP-n cite them)
Adr ──▶ Prd, rules (baseline) or Architecture (later)          taken with the Architecture by `architect`, one per strategy decision; or by hand
Architecture ──▶ Prd, rules, BoundedContext (3, 5), Adr (9), Glossary (12), DomainModel (8)   arc42 baseline, once per product (31-architecture-process.md)
Spec per CAP-n ──▶ Prd, Architecture, DomainModel, Glossary, rules
Design per block and type ──▶ Architecture, DomainModel, Glossary, rules
DesignSystem once ──▶ Prd, Architecture;  Design (ui) per client block ──▶ Architecture, rules, DesignSystem, the block's API Designs (no DomainModel)
Plan per Spec ──▶ Spec (by id, latest), Architecture, Design (many)
AcceptanceRecord per T-n ──▶ Plan, Spec, Architecture, Design, Glossary, rules;  TestOutcome ──▶ AcceptanceRecord   (35-build-process.md)
why, for whom: Prd · exactly what: Spec · how: Architecture, Design (reusable assets) · work: Plan · proof: AcceptanceRecord, TestOutcome
```

Every arrow is a Task input: the author Task reads the upstream artifact, so `provenance.inputs`
pins the revision it cited. Ids inside content (`BR-n`, `CAP-n`, `QG-n`) are for the reader and the
Validators; the engine never resolves them. Links point upstream only: a Spec never names a
Design and a Design never names a Spec; the Plan of a Spec names the Designs its tasks realise
elements of, and "which Designs serve this Spec" is read off it.

## Artifact kinds

All in group `sdd.persimmon.ai`, Namespaced, Immutable, revisioned, `snapshot: "None"`
(`18-artifact.md`). Schemas in `packs/sdlc/global/10-artifact-kinds.yaml`.

| Kind | Answers | Content |
|---|---|---|
| `BoundedContext` | where one model holds | `name`, `purpose`, `inScope[]`, `outOfScope[]`, `owner?`, `classification?`, `bigBallOfMud?`, `subdomain`, `capabilities[] CAP-n` (`34-subdomains.md`), `relationships[] {context, role: upstream\|downstream\|peer, pattern, note?}` |
| `Glossary` | what words mean here, what can be said about them | `title`, `context`, `terms[] {name, definition, aliases?, related?, status, replacedBy?}`, `factTypes[] {name, subject, predicate, object: term \| {type, unit?, values?}, description?, status}` |
| `BusinessRules` | what is always true here, one per product | `title`, `owner`, `rules[] {id BR-n, subdomain? (one of the Prd's, required with several; `34-subdomains.md`), type: fact\|constraint\|derivation\|decision, statement, rationale, source?, owner?, effectiveFrom?, effectiveTo?, status, examples?, factType?, logic?}`; `logic {inputs[] {name, factType}, when?: Condition, then: {violation} \| {derive, expression} \| {decision: {output: literal}}}`; `Condition` is `{all[]}`, `{any[]}`, `{not}` or `{field, op, value?}` with `op` in eq ne lt lte gt gte in notIn present absent |
| `DecisionTable` | which outcome for which inputs | `title`, `context`, `decision`, `owner`, `source?`, `effectiveFrom?`, `effectiveTo?`, `status`, `cites[] BR-n`, `inputs[] {name, factType}`, `outputs[] {name, type, values?}`, `hitPolicy: unique\|first\|priority\|any\|collect`, `rows[] {id R-n, when: {input: unary test}, then: {output: literal}, cites?, note?}` |
| `Adr` | one decision and why | `title`, `status: proposed\|accepted\|rejected\|superseded\|deprecated`, `deciders[]`, `context`, `drivers[] QG-n\|C-n\|QS-n\|BR-n\|G-n\|CAP-n\|SC-n`, `decision`, `alternatives[] {option, rejectedBecause}`, `consequences[] {kind, statement}`, `supersedes?` (Adr id), `strategy?` (`S-n` of the Architecture it backs), `enforcedBy?[] QS-n` (proven at `build`) |
| `Architecture` | how the product is shaped (arc42) | `title`, `owner`, `status`, 1 `introduction {prd, qualityGoals[] QG-n (ISO 25010:2023), stakeholders[]}`, 2 `constraints[] C-n`, 3 `context {business[], technical[]}`, 4 `strategy[] S-n`, 5 `buildingBlocks[] BB-n` (`parent?` for lower levels, `technology?`) and `relations[] {id REL-n, from, to, description, interface?, technology?}`, 6 `runtime[] RT-n?`, 7 `deployment?`, 8 `concepts[] CC-n` + `domainModels[]`, 9 `decisions[]` (Adr ids), 10 `qualityScenarios[] QS-n {method test\|fitness\|load\|chaos\|observe, provenAt build\|release\|runtime}`, 11 `risks[] RK-n?`, 12 `glossaries[]` |
| `EventStorming` | what happens in the domain, in whose words | DSL v4.1 of the event storming tool, `24-eventstorming.md`: `version`, `meta {name, level}`, `contexts[]`, `contextRelationships[]`, `nodes[]`, `edges[]` |
| `Prd` | why, for whom, what capabilities | `title`, `problem`, `users[]`, `goals[] G-n`, `nonGoals[]`, `subdomains[] {id, name, description, type: core\|supporting\|generic}`, `capabilities[] {id CAP-n, name, description, priority, subdomain, rules?}`, `successCriteria[] {id SC-n, statement, capabilities?}`, `assumptions[]`, `openQuestions[] {id Q-n, question, resolution?}` |
| `Spec` | exactly what one capability does | `title`, `prd`, `capability` CAP-n, `architecture`, `domainModel`, `stories[] {id US-n, role, goal, benefit, requirements[] FR-n, commands?[], events?[], readModels?[], acceptance[] {id AC-n, title, given[], when[], then[]}}` (Connextra; Given/When/Then), `requirements[] {id FR-n, pattern: ubiquitous\|event-driven\|state-driven\|unwanted-behaviour\|optional\|complex, statement, rules?[] BR-n}` (EARS), `qualities[] {scenario QS-n, delta?}`, `openQuestions[] {id Q-n, question, resolution?}` |
| `Plan` | the work that builds one Spec | `title`, `spec`, `architecture`, `designs[]` (Design ids), `tasks[] {id T-n, title, description?, block BB-n, covers[] FR-n, verifiedBy[] AC-n\|QS-n, elements?[] {design, element EL-n}, dependsOn?[] T-n}` in build order, `openQuestions[]` |
| `AcceptanceRecord` | which tests prove one Plan task | `plan`, `spec`, `task` T-n, `verifies[] {scenario AC-n\|QS-n, tests[]}`, `summary`, `openQuestions[]` (`35-build-process.md`) |
| `TestOutcome` | what the project's tests did | `command`, `exitCode`, `head?`, `dirty?`, `tests[] {classname, name, status: passed\|failed\|errored\|skipped, message?}`, `outputTail?`, read from JUnit XML |
| `Design` | one reusable contract or schema of one block | `title`, `type: http-api\|async-api\|data-schema\|ui`, `architecture`, `block` BB-n, `interface?`, `domainModel` (absent on `ui`), `designSystem?`, `document {mediaType, content}` (OpenAPI 3.1, AsyncAPI 3, JSON Schema, DDL or a `ui` screen document, embedded whole), `elements[] {id EL-n, name, realises {kind: command\|event\|readModel\|aggregate\|operation, name}, rules?[] BR-n}`, `rules[] BR-n`, `decisions[]` (Adr ids), `references?[]` (ExternalResourceRefs: a Figma file, a design tool's link, a repository path; pointers, never the document), `openQuestions[]` |
| `DesignSystem` | the product's visual language, once | `title`, `prd`, `document {mediaType: text/markdown, content}` (DESIGN.md verbatim, `32-ui-design-process.md`), `decisions[]` (Adr ids), `openQuestions[]` |

## Citation

| Citing | Field | Cites | How |
|---|---|---|---|
| `Glossary`, `BusinessRules`, `DecisionTable` | `context` | one `BoundedContext` | artifact id; one Glossary per context |
| `BusinessRules` `logic.inputs[]`, `DecisionTable` `inputs[]` | `factType` | `Glossary` fact types | by name; the fact type's `object` is the input's type |
| `DecisionTable` | `cites[]`, `rows[].cites[]` | `BusinessRules` rules | `BR-n`; the table implements them |
| `BoundedContext` | `relationships[].context` | other `BoundedContext`s | artifact id; each side keeps its own view |
| `Prd` | `capabilities[].subdomain` | one of its own `subdomains[]` | an id inside the Prd; the BoundedContext that realises the subdomain lists the capability (`34-subdomains.md`) |
| `Prd` | `capabilities[].rules[]` | `BusinessRules` rules | `BR-n`; the rules artifact is a Task input |
| `Prd` | `successCriteria[].capabilities[]` | its own capabilities | `CAP-n`; absent means the product as a whole |
| `Architecture` | `introduction.prd` | one `Prd` | artifact id; the requirements are the Prd, never restated |
| `Architecture` | `decisions[]`, `domainModels[]`, `glossaries[]`, `buildingBlocks[].contexts[]`, `context.business[].context` | `Adr`, `DomainModel`, `Glossary`, `BoundedContext` | artifact ids; an Adr is taken first, or with the Architecture by `architect`, and the Architecture revision that applies it lists it |
| `Adr` | `drivers[]`, `enforcedBy[]`, prose | `QG-n`, `C-n`, `QS-n` of the Architecture, `BR-n` of the rules, `G-n`, `CAP-n`, `SC-n` of the Prd; `enforcedBy` a `build` `QS-n` of the Architecture | by id, in the revisions provenance pins |
| `Spec` | `prd`, `capability` | one `Prd`, one of its capabilities | artifact id and `CAP-n`; the BoundedContext bound beside it, which lists the capability, is the Spec's context, never restated (`34-subdomains.md`) |
| `Spec` | `domainModel`, `stories[].commands[]`, `events[]`, `readModels[]` | one `DomainModel` and its names | artifact id; command, event and read model labels by name, never redefined |
| `Spec` | `architecture`, `qualities[].scenario` | one `Architecture` and its `QS-n` | artifact id; a `delta` only tightens a scenario |
| `Spec` | `requirements[].rules[]` | `BusinessRules` rules | `BR-n`, "enforces"; the Prd capability's `rules[]` is "governed by": two relations, one rule text |
| `Spec` | `stories[].requirements[]` | its own `FR-n` | "covers"; a scenario cites nothing, it belongs to its story |
| `Spec` | `stories[].role`, `benefit` prose | `Prd` users, `G-n` | by name, by id |
| `Design` | `architecture`, `block`, `interface` | one `Architecture`, one of its blocks, an interface it provides | artifact id, `BB-n`, interface name |
| `Design` | `domainModel`, `elements[].realises` | one `DomainModel` and its names; a `ui` Design: no `domainModel`, the block's API Designs bound to the Validator | artifact id; a command, event or read model label, or `AG-n`; a `ui` Design: `{kind: operation, name}`, an element name of a bound Design |
| `Design` | `rules[]`, `elements[].rules[]` | `BusinessRules` rules | `BR-n`, "enforces"; the root list is the union of the elements' |
| `Design` | `decisions[]` | `Adr` | artifact ids |
| `Design` | `references[]` | something outside the engine | `ExternalResourceRef {provider, type, id, locator, version?, url?}` (`00-resource.md`); shape by schema; the Validator neither checks nor fetches one |
| `Plan` | `spec`, `tasks[].covers`, `verifiedBy` | one `Spec`, its `FR-n`, `AC-n` and the `build` `QS-n` its `qualities` cite | artifact id; every `FR-n` is covered and every `AC-n` and cited `build` `QS-n` verified by a task |
| `Plan` | `architecture`, `tasks[].block` | one `Architecture` and its blocks | artifact id, `BB-n`; one block per task |
| `Plan` | `designs[]`, `tasks[].elements[]` | the `Design`s and their `EL-n` | artifact ids, listed in `designs`; the Design's `block` is the task's. The Spec-to-Design link lives here only |
| `AcceptanceRecord` | `plan`, `spec`, `task`, `verifies[].scenario` | one `Plan`, its `Spec`, one `T-n`, the task's `AC-n` and `QS-n` | artifact ids, `T-n`, `AC-n`, `QS-n`; `verifies[].tests[]` names test cases of the `TestOutcome` by string |
| any | prose | `Glossary` terms | by using the term; `aliases` never appear in documents |

## Project files

`packs/sdlc/files/AGENTS.md` is the project's agent rules; `init` places it, with `CLAUDE.md` a
symlink to it (`20-pack.md`). When `init` placed both, every agent in the project reads it: a
human's coding agent, and the pack's own agents, which run in the project directory; a project
that kept its own `AGENTS.md` or `CLAUDE.md` carries section 8 itself.

| Section | Content |
|---|---|
| 1-4 | Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution: the ai-native-project-template's wording; a new dependency or a build is an `Adr` for the next `architect` run, the only writer of Adrs |
| 5 Language Consistency | each context's `Glossary` artifact is its glossary; a conflicting or missing term is resolved in the Glossary, never by a local synonym |
| 6 Artifact Workflow | the run order (`author-prd`, `domain-discovery`, `architect`, `spec-all`, `design-all`, `design-system` before a `ui` `design-all`, `plan-all`, `build-all`); artifacts live in the store, read with `persimmon get`, an exported file is a copy; a finding is fixed upstream; an unknown is a `Q-n`; code only against a revision its Gate passed (a loop out of rounds still publishes its rejected revision), `get --behind` for stale ones; the builder's steps (`35-build-process.md`), for the developer's agent reading an inbox form: the form is the brief, the findings in `inputs.feedback`, the build rules win for a build task, build where `repository` names, answer with `complete --file` from the project directory in the background, never run git: the developer reviews the diff and commits once the Gate passed |
| 7 Output Discipline | the template's wording, scoped to replies to a human: a Task's documents keep the length their Prompt asks |
| 8 Persimmon Tasks | an agent whose prompt is a persimmon Task (it ends with `## Answer`), not a developer's agent reading an inbox form, follows its Task's Prompt over this file; never asks, since a pack agent runs with no one to answer and an agent that stops returns no output: an unknown goes into its output; never runs git or a `persimmon` command, whose store the engine holds; writes only where its Task allows |

## Rules

| Rule | Enforcer |
|---|---|
| a `Q-n` resolved in a document an Adapter published is an agent's answer in a human's place, told to the human as a `question-agent-resolved` warning unless the last round had it; who produced it is `provenance.actor`, the channel that published it, not a field the agent fills | every `sdd/v1` document check (`35-build-process.md`) |
| ids (`BR-n`, `R-n`, `G-n`, `CAP-n`, `SC-n`, `Q-n`, `QG-n`, `C-n`, `S-n`, `BB-n`, `REL-n`, `RT-n`, `CC-n`, `QS-n`, `RK-n`, `US-n`, `FR-n`, `AC-n`) unique in a document and increasing in document order (`AC-n`: within its story, since scenarios nest under stories and a revision's new one may belong to any), from 1 on a first draft, never reused across revisions: a removed item leaves a gap, a new one takes the next number; term and fact type `name`s unique in a Glossary, never reused; a revision keeps every id and name and fixes in place | author Prompt; `spec-consistency` for `US-n`, `FR-n`, `AC-n`, `Q-n` of a Spec; `prd-consistency` for `G-n`, `CAP-n`, `SC-n`, `Q-n` of a Prd and `BR-n` of the rules it writes; Validator later for the rest |
| a term's `aliases` never name another term; a `relationships[]` entry's `role` fits its `pattern` (conformist, anticorruption-layer: downstream; open-host-service, published-language: upstream; shared-kernel, partnership, separate-ways: peer; customer-supplier: either) | Validator later |
| a `fact` names its `factType` and is a structural rule over it (cardinality, necessity); a `fact`'s or `constraint`'s `then` is a `violation`, a `derivation`'s is `derive` + `expression`, a `decision`'s is `decision`; `when` absent means always; a rule without `logic` is informal and says so in `rationale` | Validator later |
| a `decision` rule's `then.decision` keys are outputs of the `DecisionTable` that cites it; in a `unique` table every row cites exactly one `decision` rule and every `decision` rule the table cites sits in exactly one row; a row's `cites` ⊆ the table's `cites`, which also holds the constraints behind its inputs | Validator later |
| `logic.inputs` and table `inputs` name active fact types; a fact type's `subject` and a string `object` name terms; a condition `field` names an input; `then.derive` names an input; an input over a term-valued fact type takes `eq`, `ne`, `in`, `notIn`, `present`, `absent` only (equality is identity) | Validator later |
| a `unique` table's rows never overlap (DMN) and, as a pack rule, cover every combination of its inputs' types; `first` and `priority` rows are ordered | Validator later |
| `expression` and unary tests are a FEEL subset: literals, `- + * /`, `if then else`, comparisons, `[a..b]`, `a, b`, `-` for any; nothing in the pack evaluates them yet | convention; evaluator later |
| a withdrawn rule or term stays with `status: deprecated` (`replacedBy` for a term) so no citation dangles | author Prompt; Validator later |
| cited `context` exists, except `relationships[].context` and `Architecture.context.business[].context`, which may name a context in another Namespace or not yet written; cited `BR-n` exists and is active in the BusinessRules the document names in `businessRules`, which is the artifact bound (`rules-mismatch`); `related` and `replacedBy` resolve | `prd-consistency` for a Prd's `capabilities[].rules[]`, `spec-consistency` for a Spec's `requirements[].rules[]`; Validator later for the rest; schema cannot see across documents or entries |
| an unknown fact is a `Q-n`, never a guess; a Prd with open questions is valid and gated later | author Prompt |
| inside an `Architecture`: `strategy[].addresses`, `qualityScenarios[].qualityGoal`, `buildingBlocks[].parent`, `deployment.nodes[].hosts`, `deployment.channels[].from/to` (nodes), `runtime[].steps[].from/to` and `relations[].from/to` (a `BB-n` or a `context.business[].partner`, at least one end a block) resolve; `relations[].interface` is an interface the `to` block provides, or the `from` block requires when `to` is a partner; every level 1 block and every partner has a relation; every `QG-n` has at least one `QS-n`; level 1 blocks' `contexts` cover every `BoundedContext` the Prd's capabilities name; `decisions[]` name Adrs with status `accepted` | `architecture-consistency` (`31-architecture-process.md`), except `deployment` and `runtime` |
| a Spec never cites a Design, a Design never cites a Plan, an Architecture never names a Spec story: every artifact cites upstream only; downstream is a Relation query | author Prompt; convention |
| in a `Design`: `block` resolves and `interface` is one it provides; every element's `realises` resolves in the DomainModel (a `ui` Design: in the API Designs bound, `ui-domainmodel`, `designs-unbound`; another type with none bound: `domainmodel-unbound`); rules resolve, are active, and the root `rules[]` is exactly the union of the elements'; `type` and `document.mediaType` pair; ids unique and increasing; `decisions[]` is not checked (no Adr in the payload). The document is read for the names it declares and the index must match them both ways (`document-unparsed`, `element-unbacked`, `document-unindexed`, `29-design-process.md`); a DDL word the block's store lacks is a `dialect` warning; the document's field names, split into words, are Glossary terms or fact type names less subject and predicate (an alias or a deprecated name `alias-used`, a word the Glossary lacks a `term-unknown` warning); whether every name of the DomainModel is realised across its Designs is `domain-coverage`'s report (`29-design-process.md`) | `design-consistency`, `domain-coverage` (`29-design-process.md`) |
| in a `Spec`: `capability` is a `CAP-n` of `prd`; `role` is a Prd user; `commands`, `events`, `readModels` resolve in the DomainModel; `stories[].requirements` resolve in the Spec and every `FR-n` is covered by a story; `requirements[].rules` resolve and are active; every `BR-n` the Prd capability lists is enforced by a requirement; each `statement` opens with its pattern's keyword (`The`, `When`, `While`, `If`, `Where`; `complex` opens with `While`, `When` or `If` and holds two of those clauses before `shall`); `qualities[].scenario` resolves in `architecture`; the capability is in the bound BoundedContext's `capabilities`, `domainModel.context` is that context's id, and `capability` is the `capabilityId` the Spec was written for | `spec-consistency` (`27-spec-process.md`) |
| in a `Plan`: `spec` and `architecture` are the ids of the Spec and Architecture evaluated; every `FR-n` of the Spec is in some task's `covers` and every `AC-n` and every `build` `QS-n` the Spec cites in some `verifiedBy`, and each cited one exists, a `QS-n` one the Spec cites and the Architecture proves at `build`; `block` resolves in `architecture`; `dependsOn` names lower `T-n` only, so document order is build order and no cycle is possible; `elements[].design` is in `designs[]`, the Design is in the payload, its `block` equals the task's and the `EL-n` exists; every listed Design is realised by some task and none is listed twice; ids unique and increasing | `plan-consistency` (`30-plan-process.md`) |
| in an `AcceptanceRecord`: `task`, `plan` and `spec` are the ones bound and the Plan builds that Spec; every `AC-n` and `QS-n` the task is verified by has one row and no row names another; every named test matches one test case of the `TestOutcome` and passed; no other test case is red; a non-zero exit has a red test case; a test the last round named and ran still runs; no open question lacks a resolution | `acceptance-evidence` (`35-build-process.md`) |
| an `Adr`'s `drivers` resolve in the revisions its `provenance.inputs` pin (a Prd and rules for a baseline Adr, an Architecture later), or, for an Adr the `architect` loop takes beside its Architecture, in that Architecture, which provenance does not pin and `decisions[]` names | `architecture-consistency` for the Adrs an Architecture applies; Validator later for a baseline Adr |
| `goals` give direction without a number; `successCriteria` carry the number; `successCriteria` and `capabilities` name no technology, architecture or task | author Prompt; `prd-consistency` refuses a digit in a goal |
| a success criterion is an outcome measured in production over time, decided by measurement; a behaviour one test decides on one run is an acceptance scenario and belongs to a Spec story; a capability no success criterion names is reported | author Prompt; Validator later |

## Decisions

- Two levels, not one: a `Prd` per product or initiative (why, for whom, capabilities), a `Spec`
  per capability (stories, requirements, acceptance scenarios, cited qualities). spec-kit's `spec.md` is the second;
  BMAD's PRD mixes both. A PRD revises rarely and is judged on goals and scope; a spec revises per
  feature and is judged on completeness and testability. A brownfield change is a Spec revision.
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
- Success criteria live in the `Prd` only, acceptance scenarios in the `Spec` only. spec-kit keeps both
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
  holds the data schema, API and runtime detail, so acceptance scenarios stay storage-free. arc42's
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
- No NFR text in a Spec: `qualities[]` cites Architecture scenarios by `QS-n` with an optional `delta`
  that only tightens. Free NFR prose is where duplicates and contradictions breed. Found in design
  review.
- Brownfield changes are a new revision of the Spec, never a change kind: the engine keeps every
  revision and diffs them. OpenSpec's change artifact exists because files have no revisions. Found in
  design review.
- A `Spec` holds three objects of different nature, each in its standard form, joined by citation:
  stories are the user's side (Connextra: `role`, `goal`, `benefit`) and cover requirements by `FR-n`;
  requirements are the system's side (EARS, one sentence over "the system", never a building block)
  and enforce rules by `BR-n`; acceptance scenarios (Given/When/Then with concrete values) belong to
  a story and cite nothing; `AC-n` is numbered across the Spec, not per story, so a Design or a
  test cites one id. An earlier draft had EARS criteria under stories and no `FR-n`, then
  criteria citing `FR-n` (the classic traceability matrix): the first merged two kinds of knowledge,
  the second put a link on the wrong object. Kiro, spec-kit and BMAD each settle on one of the three
  forms; this takes all three with one link each. Found in design review.
- Entities are not restated: a story names the DomainModel's commands, events and read models, and a
  name the model lacks is a gap in the model, fixed upstream, never a "not in model" marker that
  nobody clears. Found in design review.
- The Prd capability's `rules[]` stays beside the Spec's `requirements[].rules[]`: "governed by" and
  "enforces" are two relations over one rule text, and the Validator reports a governing rule no
  requirement enforces; without the Prd list that gap is only an agent's opinion. A single source of
  truth means one definition, not one citation. Relations are of three classes: ownership (a Prd owns
  its capabilities, a Spec its stories, requirements and scenarios), normative dependency (governed
  by, enforces, covers), verification (a TestCase verifies, `91-roadmap.md`). Found in design review.
- Writing the first Spec found two Prd gaps its own review missed: the Glossary term says a claim line's
  amount is in the currency paid while the fact type says EUR, and CAP-1 refuses an incomplete submission
  while CAP-2 and BR-9 route an incomplete claim back. Both stay open questions of the Spec, not guesses;
  the cheapest Prd check is the Spec after it. Found in audit.
- Ids are unique and increasing, not contiguous: "sequential from 1" and "a revision keeps every id,
  never reused" contradict each other the moment a human drops a capability. A gap now marks the
  removal; nothing is renumbered, nothing reused; the Validators check order and uniqueness only.
  Found in audit.
- A `Design` is a reusable asset, one per block and type, not a document per capability: an API or a
  schema serves every capability that touches its block, and a design per `CAP-n` would restate it
  per capability or own what belongs to a block. The first proposal (components, data, operations,
  flows per capability) was dropped for this; components become child blocks of the Architecture,
  flows and tactics wait for the Plan. Found in design review.
- A Spec never cites a Design: the Spec says what, an endpoint is how, and a Spec naming `POST /claims`
  revises with the API and invites its authors to invent one. The Plan cites the Spec and the Design
  assets that realise it; "which designs realise CAP-1" is answered there. Found in design review.
- The contract is embedded whole (`document`) and indexed by hand (`elements[]`), not parsed: the
  Validator checks the index against the DomainModel today, and a later evaluator may parse OpenAPI or
  AsyncAPI to check the index against the document. One truth is the document; the index is the
  Validator's view of it and may lag, which is a finding for that evaluator. Found in design review.
- Group `sdd.persimmon.ai`, kind `Prd`: the demo pack's `ProductRequirement` and example06's
  `EarsPrd` keep their names in `engineering.persimmon.ai`; no collision.

- `Plan` per Spec, not per Design or per release: a task covers requirements and is verified by
  scenarios, both the Spec's, so the Plan's unit is the Spec's. It names every Design it builds
  against through an `artifacts` input (`10-ports.md`), one per block and type, because a task on
  the claims core realises an API operation and a schema table at once. No estimate, owner or
  status field: status is the state of the runs that later cite the Plan. Found in design review.

- Every pack Task names what it publishes through `outputs.<port>.id` (`12-task.md`): the storming
  `<prd>-storming`, the derived kinds `<context>`, `<context>-glossary`, `<context>-model`, a Spec
  `<prd>-<cap-n>`, a Prd run's `<context>-prd` and `<context>-rules`, a Design `<bb-n>-<type>`, a
  Plan `<spec>-plan`. A second run or a second loop round publishes the next revision of the same
  identity, which is what a revision means; the runner's `<logicalExecutionId>-<port>` gave each a
  new one. A storming context id and every `contextId` input are DNS labels of at most 40
  characters, so `<context>-prd-cap-n-plan` stays an Id; a Design is `<architecture>-<bb-n>-<type>`
  because `BB-n` numbers are per Architecture. Found in audit.
- The five `-all` loops (`derive-all`, `spec-all`, `design-all`, `plan-all`, `build-all`) keep only the cursor
  `index` in `repeat` state and read the list as `inputs.<list>[state.index - 1]`: a step binding
  inside a `repeat` sees `inputs` as any step does, so the copy of the list into state (a second
  schema, `fromInput` in `initial`, `fromState` in `next`) said nothing the input did not. Found in
  audit.
- A citing document (Prd, Spec, Design, Architecture) names its BusinessRules artifact in
  `businessRules`: a `BR-n` is a bare id, so which artifact it means lived only in the run's binding
  and the publisher's provenance; two products in one Namespace each have a `BR-11`, and a Spec that
  names `prd` and `domainModel` by id named no rules. The id is the qualifier, as `CAP-1` is the
  Prd's; the Validator holds the name to the artifact bound (`rules-mismatch`) and refuses a document
  without it; and to what the upstream document names (a Spec's Prd, a Design's Architecture, an
  Architecture's Prd), else a document bound to another product's rules passes by copying the id it
  was bound with. A DomainModel, DecisionTable or Adr cites `BR-n` through the artifact it hangs off
  and carries no field. Optional on the kinds, so committed revisions still validate; a gate run by
  hand over an old revision reports the field absent, which is what the pack asks for now. Found in
  design review.
  Proven live: `design-all` for example08's Reservation API wrote `businessRules: car-pool-rules`
  from the `rules` input and passed `design-consistency` in round one (3m24s). Found in UAT
  (example08).
- The five `-all` loops end `step_failed` when an iteration died before its Gate ran, and
  `<x>_inconsistent` only when the Gate rejected the last round (`when: steps.each.phase ==
  "Succeeded"`, `dispatch: first`): four `design-all` runs died in the agent CLI and every WorkflowRun
  said `design_inconsistent`, the one Failed reason the loop had; the cause sat two levels down in
  `steps.each.error`, where it still is. No engine change: a `when` already reads a finished step's
  phase. Proven live: `design-all` over `BB-1` with the design agent bound to a credential nobody
  set ended `step_failed` in zero seconds, `steps.each.error` `permission_denied: step rounds: step
  produce: credential ghost-credential not found`, and `persimmon tree` shows the chain down to the
  TaskRun. Found in UAT (example08).
- Every agent Task carries `retryPolicy: {maxAttempts: 3, backoff: {exponential, 1m, 5m, jitter: none}}`
  with no `retryOn` or `abortOn`, so the Adapter's `retryable` decides: a `403`/`429`/`5xx` the CLI
  reports is retried, and so is every other failure the Adapter calls retryable (`error_max_turns` as
  `timeout`, an unparsed answer, an API `400` as `agent_failed`), which costs up to three agent runs
  where the failure repeats; a dead login (`permission_denied`) is not. The waits are 1m and 2m,
  the recovery the live 403 showed. Absent `retryPolicy` meant one attempt, so the Adapter's honesty
  changed nothing. The attempt deadline is bounded by the step's (`12-task.md`), and every agent
  step in the pack gives 30m, the Task's own `timeout`: a retry after a fast refusal gets nearly the
  whole budget, a retry after a 30m timeout gets none, which is the intent. The human `confirm-*`
  Tasks keep one attempt. Found in UAT (example08).
- A second example is the pack's own output, not a hand-written one: `examples/example07/room-booking-domain.yaml`
  is what `author-prd`, `domain-discovery`, `spec-all`, `design-all` and `plan-all` produced on a small
  real brief with a human at the Gates, so a regression in a prompt, a Task context or a Validator shows
  against artifacts the pack once wrote. The hand-written expense claims example stays: it covers `DecisionTable`,
  which no process produces yet, and a baseline Adr taken before the Architecture. Found in UAT.
- A draft's auditor is a `task` Validator in the draft's Gate, `<kind>-audited` over Task
  `audit-<kind>` on the Executor `auditor`, for a Prd, a Spec, an Architecture and a Design: the
  deterministic check decides form and citation, and nothing decided meaning (whether an `AC-n`
  can be decided by one test, whether two rules can both hold) before a human, or for a Spec and a
  Design no human at all. A Validator, not a Task in `produce` as the build's auditor is: a draft
  is an artifact a Validator's inputs take, and only a Gate's `after` runs it once the check
  passed, so no agent call is spent on a draft the check refuses; `confirmed` runs after both, so
  the human never reads a draft the auditor refused. Its `passed` is the Task's answer and no
  `cel` recomputes it, so the Task's output schema ties it to its findings: `passed` is false
  exactly when a finding is an `error`, and an answer that says otherwise fails the Task as a
  schema violation, never passes. One Prompt, `draft-audit-rules`, with a part per kind: the
  shared stance (an error only for a defect the writer can fix in this draft, naming its id; a
  doubt is a warning; never rewrite) is one text. Plan and storming have none: `plan-consistency`
  decides most of a Plan and the build's auditor reads its tests; a human confirms each storming
  phase. A Namespace that wants no auditor overrides the Gate by name. Its verdict on a passing
  draft reaches the human's form as the confirm Task's `audit` input (`fromValidator`, `14-gate.md`),
  so its warnings are judged, not lost in the GateResult. Found in design review (`35-build-process.md`).
- The draft auditors live over the worked example, which every check passes: each refused it on a
  real defect the hand-written example always had (two rules no claim can satisfy together, a
  quality scenario its method cannot decide, a contract field a schema cannot fill), and none
  refused falsely in six runs; the human confirming an Architecture read the auditor's verdict in
  the form. A fixed defect lets the next run reach a deeper one, so a Prd or a Design passes after
  more rounds than `maxRounds` allows a draft with several gaps. So the shared rules ask for every
  defect in one pass: after it a Design run reported four errors where it had reported one or two,
  a Prd run two, and still not every defect it had found before. With the defects fixed the example
  passes every auditor, warnings riding to the human's form; a Design audit took 6m02s, inside its
  30m. It does not stay passed: the next run refused the same unchanged rules (BR-3 against BR-8), so
  an auditor's verdict on one draft varies run to run, and a passing round is a sample, not a
  fixpoint. Found in UAT.
- From round two the auditor reads the last draft and the last verdict (`previous`, `feedback`, and
  `previousRules` or `previousAdrs` beside a Prd or an Architecture, bound by the loop's `review`), and
  raises an error only on an item that changed or on a defect the last audit named that is still
  there; a new defect in an unchanged item is a `found-late` warning the human reads. Round one finds
  everything it can, and nothing found later can block, so a loop ends. A last audit that was
  skipped judged nothing, so the next round audits as round one. Nothing compares items
  mechanically: the auditor is held to the rule by its Prompt, as to its codes. An advisory
  auditor on a human's Gate was rejected: it stops sparing the human a draft the auditor refuses.
  Found in UAT (a Prd refused on rules unchanged since a round that passed). Live over a Spec with
  one planted defect: round one refused it, round two with it fixed and nothing else changed passed
  in 56s against round one's 2m03s; no `found-late` arose, so that code is unobserved live.
- The project's `AGENTS.md` is pack content, not a fence per Task workspace: the pack's agents run
  in the project directory and read it, so one file carries the coding rules and the rules for a
  Task's agent (section 8). example02 and example04 keep their own `AGENTS.md`: a Task workspace
  inside the persimmon checkout needs its fence, and their rules name the example's files. Found in
  design review.

## Examples

- [`examples/sdlc-domain.yaml`](examples/sdlc-domain.yaml): one domain, expense claims, as a big-picture
  `EventStorming` model, a
  `BoundedContext`, its `Glossary` with fact types, `BusinessRules` with logic, the `DecisionTable`
  that routes a claim, the `Prd` that cites them, two `Adr`s and the `Architecture` that applies
  them, a design-level `EventStorming` and the `DomainModel` derived from it, the `Spec` of `CAP-1`, the
  `Design` of the claims API (OpenAPI, one asset for three capabilities), the `Plan` of that Spec, and
  the `AcceptanceRecord` and `TestOutcome` of its `T-1` (`35-build-process.md`); validates after the pack is applied
- [`examples/example07/room-booking-domain.yaml`](../../examples/example07/room-booking-domain.yaml): one domain, meeting room booking,
  produced by the pack live on `claude-sonnet-5`: `author-prd` (two rounds, the human decided two open
  questions), `domain-discovery` (five storming revisions, the human rejected one hotspot and merged an
  aggregate), `architect` (two rounds, the human cut seven blocks to four), `spec-all` over six
  capabilities, `design-all` for the booking core's HTTP API and data schema, `plan-all` over the six
  Specs. Twenty-six artifacts at revision 1 (the rounds collapsed), validates after the pack is applied
