# Design process

status: draft · layer: 2 (`23-pack-sdlc.md`, `27-spec-process.md`) · schema: the `Design` kind in `packs/sdlc/global/10-artifact-kinds.yaml`

From an Architecture block to its Designs: an agent writes one contract or schema per block
and type (an OpenAPI document for the interface a block provides, an AsyncAPI document for the
events it publishes, a schema for the aggregates it stores) from the Architecture, the DomainModel,
the Glossary and the rules; a Validator checks the asset's index against them; the loop feeds
findings back once. A Design is shared by every capability of the block; no Spec cites it.

```text
Workflow design-all: repeat over `blocks` with one `type` ─▶ ReviewLoop design-one per block
  produce: Task design-asset (design-agent) ─▶ Design
  review:  Gate design-gate = Validator design-consistency (sdd/v1: design, architecture, domainModel, rules),
           then design-audited (Task audit-design, Executor auditor, after consistency passed)
  previous and feedback fed back; maxRounds 2
```

## Process

| Member | Content |
|---|---|
| Prompt `design-rules` | one asset per block and type; the contract whole and standard; the index names what each operation, channel or table realises in the DomainModel; refusals name the rule; field names are Glossary terms; nothing the DomainModel lacks is invented |
| Executor `design-agent` | `claude-code/v1`, read-only, its own name for per-Namespace override |
| Task `design-asset` | inputs `architecture`, `blockId`, `type`, `interface` (optional: which provided interface, else the block's first), `domainModel` and `glossary` (required unless `type` is `ui`), `rules`, `designSystem` and `designs` (required when it is), `previous`, `feedback`; output `design`; `base?` (the Design this run revises) and `changes?` (the downstream answers it applies, each `<artifact id> Q-n: <resolution>`), both or neither; `decisions?` (the owner's answers to this round's open questions, recorded with `previous` the draft); output `open` beside `design`, the ids of its open `Q-n` |
| Task `decide-design`, Workflow `design-draft` | the owner decides a draft's open questions inside the round (`23-pack-sdlc.md`): `design-draft` runs `design-asset`, then, when `open` names any, `decide-design` on `local-reviewer` (inputs `draft`, `open`, `architecture`, `rules`; output `decisions`; Prompt `owner-decisions`) and `design-asset` again with `decisions`; output `design` from whichever path ran (`first`) |
| Validator `design-consistency` | `sdd/v1` over `design`, `architecture`, `domainModel` and `glossary` (optional), `rules`, and for a `ui` Design `designSystem` and `designs`; the Design rule row of `23-pack-sdlc.md` as findings, the document's field names held to the Glossary (`alias-used`, `term-unknown`), and a `ui` screen's Actions and Layout prose read past the index (`32-ui-design-process.md`) |
| Validator `design-audited` | `task` over `audit-design` (inputs `design`, `architecture`, `rules`, and `domainModel` or, for `ui`, `designs`, and from round two `previous` and `feedback`; Executor `auditor`; the Prompt `draft-audit-rules`, part "A Design": `rule-unenforced` and `contract-mismatch` errors, `contract-gap` warnings; `23-pack-sdlc.md`) |
| Gate `design-gate` | consistency, then `audit` `after: [consistency]`, `all`, 35m |
| ReviewLoop `design-one` | `produce` `design-draft` (73h: the owner may be a human), `review` `design-gate` (35m), `maxRounds: 2`, 240h; takes `interface` too, so a block with two provided interfaces gets its second Design from a direct run; `base` and `changes` passed to `design-asset` |
| Workflow `design-all` | `repeat` over `blocks`, one entry per Design: `{block, type, interface?, qualifier?, context?}`; each iteration binds the entry's block, type, interface and qualifier (empty when absent: the block's first interface, no qualifier) and the context's DomainModel and Glossary by id, `<context>-model` and `<context>-glossary` as `derive-domain` names them (`fromArtifact`, `onMissing: omit`), so one run covers every block of every context; `designSystem` and `designs` are required when an entry is `ui`, and a `ui` run follows the `http-api` one its screens call; a block the loop could not design ends the run `design_inconsistent`, an iteration that died before its Gate ran `step_failed`; output `written`; `repeat` runs its loops side by side, `parallel: 4`, one rejected stopping none, and `memo` reuses a loop whose inputs are unchanged since it passed (`11-workflow.md`); the run Succeeds when `steps.each.results` all passed |
| Validator `domain-coverage` | `sdd/v1` over `domainModel` and `designs` (every Design; the ones naming the model are read): each name the model owns with no element realising it is `unrealised`, a warning, or `unrealised-internal`, an info, for a command a policy invokes or an event an external system emits |
| Gate `coverage-gate`, Workflow `design-coverage` | the Gate alone, no Task: `persimmon run design-coverage --input domainModel=<ref> --follow`, the step querying the Designs that name the model (`fromQuery`, `10-ports.md`); output `passed`, the tree lists every gap |
| Workflow `design-check` | `design-gate` alone over one stored Design, its auditor too (35m): `persimmon run design-check --input design=<ref> --input architecture=<ref> --input rules=<ref> --input domainModel=<ref> --input glossary=<ref> --follow` (a `ui` Design: `designSystem=<ref>` and `designs=kind:Design` instead of `domainModel` and `glossary`); for a Design `get Design --behind` names, or a hand-edited one; output `passed`, the tree lists every finding. `glossary` left out is not a finding: the field names go unchecked, as the Validator's port says |

## `checkDesign`

`adapters/sdd/check.mjs`, pure, `checkDesign({design, architecture, domainModel, rules, designs, designSystem, glossary, ids})` with `ids.designSystem` the bound DesignSystem's id, `designs` the bound API Designs by id (a `ui` Design realises their operations, `32-ui-design-process.md`) and `glossary` the bound Glossary's content, every finding `error` but the warnings `dialect`, `layout-unknown` (`32-ui-design-process.md`) and `term-unknown`; the Adapter's `passed` is "no `error` finding":

| Code | Finding |
|---|---|
| `not-a-design` | content without `elements` or `type`; the only finding then |
| `document-unparsed` | the document does not read as its `mediaType` (YAML or JSON error, a duplicate key); the index is not checked against it |
| `element-unbacked`, `document-unindexed` | the index against the document, both ways, from `contract.mjs`: an element whose `name` the document does not declare; a name the document declares with no element. Names per mediaType: OpenAPI `METHOD /path` per `paths` entry (a local `$ref` path item resolved; `webhooks` are not paths), AsyncAPI 3 channel keys and their `messages` keys (a local `$ref` channel resolved; AsyncAPI 2 is `document-unparsed`), JSON Schema `$defs`/`definitions` keys or, with none, the root `title`, DDL `CREATE [OR REPLACE] [TEMP|VIRTUAL] TABLE [schema.]name` (the last identifier; string literals and comments stripped; a view is not a table), markdown `## <screen>` headings. A `ui` action element (`<screen>: <control>`) is backed by any declared screen it starts with |
| `unknown-block` | `block` is no `BB-n` of the Architecture |
| `rules-mismatch` | `businessRules` absent, or not the id of the BusinessRules bound (`33-multi-context-product.md`) |
| `unknown-interface` | `interface` is no interface the block provides |
| `unknown-realised` | an element's `realises` is no command, event, read model label or `AG-n` of the DomainModel (the same name sets as `checkSpec`); for a `ui` Design, no `operation` named as an element of a bound Design |
| `unknown-rule`, `inactive-rule` | a `BR-n` at the root or on an element missing or not `active` |
| `rules-incomplete`, `rules-unplaced` | an element's rule the root `rules[]` lacks; a root rule no element enforces (the root is the union, both ways) |
| `type-mediatype` | `type` and `document.mediaType` do not pair (`http-api` OpenAPI, `async-api` AsyncAPI, `data-schema` JSON Schema or SQL, `ui` markdown) |
| `designsystem-mismatch`, `client-block`, `ui-domainmodel`, `designs-unbound` | a `ui` Design: `designSystem` absent, no DesignSystem bound, or not the id bound; its block realises a context; it names a `domainModel`; no Design is bound to realise (`32-ui-design-process.md`) |
| `domainmodel-unbound` | a Design of another type with no DomainModel bound; one finding, the elements unchecked |
| `id-sequence` | `EL-n`, `Q-n` not unique and increasing |
| `dialect` | `warning`: a DDL word the store the block's `technology` names lacks (`sqlite`: `INTERVAL`, `EXTRACT(`, `SERIAL`, `BIGSERIAL`, `CREATE SCHEMA`, `::`; `postgres`: `AUTOINCREMENT`, `WITHOUT ROWID`, `DATETIME`, `NVARCHAR`); string literals and comments stripped, whole words with any whitespace inside; no store named, or two, no check |
| `alias-used` | a field name of the document (`fieldNames` in `contract.mjs`: every `properties` key of an OpenAPI, AsyncAPI or JSON Schema document at any depth, a container skipped; every column of a DDL `CREATE TABLE`, a constraint item skipped), split into words on case and `_`/`-`, is an alias or a deprecated term of the Glossary, or a deprecated fact type's name less its subject and predicate: the Glossary says what to write instead (`expense: expense is an alias; the Glossary names claim line`); the name as written is looked up before its singular, so `caps` is the alias `cap`. `id` and a name ending in `id`, any case (`claimId`, `CLAIM_ID`), are the document's own; a field named `properties` is a field; a name is reported once per document; a `ui` document, or no Glossary bound, checks nothing |
| `term-unknown` | `warning`: a field name whose words (one trailing `s` forgiven) are no active term and no active fact type's name less its subject and predicate (`claim has total`: `total`): a config column or a refusal's `message` is a fine name no Glossary lists, and the agent said why in a `Q-n` when it is not |

The Adapter picks the mode from the payload: `artifacts.spec` (or `artifacts.model`), else
`artifacts.prd`, else `artifacts.design`.

## `checkCoverage`

| Code | Finding |
|---|---|
| `not-a-domainmodel` | content without `aggregates`; the only finding then |
| `unrealised` (warning) | an aggregate's command, an `events[]` name, a read model or an `AG-n` of the model that no element of a Design naming this model realises; external systems' commands and other contexts' events are not the model's own: realisable by a Design (`domainNames`), never required; a Design of another model, or a `ui` Design, is not read |
| `unrealised-internal` (info) | an unrealised command one of the model's policies invokes, the system's own reaction, which a handler realises and no API operation does; or an event one of the model's `externalSystems` emits, which reaches the model from outside and no Design of it publishes |

## Rules

| Rule | Enforcer |
|---|---|
| the document is the truth, the index its checked view: `contract.mjs` reads the names the document declares and `checkDesign` holds the index to them both ways (`element-unbacked`, `document-unindexed`); a document that does not parse is `document-unparsed`. Past the names, the document's field names are held to the Glossary (`alias-used`, `term-unknown`) and a `ui` screen's Actions and Layout prose is read (`32-ui-design-process.md`); schema shapes, types and units are the agent's | `design-consistency` |
| one Design per block and type by `design-all`, id `<architecture>-<block>-<type>`; a block with two provided interfaces, or realising two contexts, gets its second Design of a type from a run with `qualifier` bound (`interface` beside it for an API), which the id carries: `<architecture>-<block>-<qualifier>-<type>` | `design-rules`; `design-asset` output id |
| `decisions[]` is not checked: no Adr is in the Validator's payload; the Architecture lists its Adrs and the Prompt picks from that list | convention; Validator later |
| `references[]` point outside the engine (a Figma file, a design tool's share link, a git path) as `ExternalResourceRef`s, the tool's version pinned when it has one; the Validator never fetches one, and the document stays whole in `document.content`: a reference is never a stand-in for it | shape: schema; pinning and no stand-in: `design-rules` |
| a `data-schema` asset realises aggregates (`AG-n`), an `http-api` commands and read models, an `async-api` events; an asset of one type may still index the other kinds (an API that also serves an event feed) | `design-rules` |
| a Design cites Architecture, DomainModel, Glossary, BusinessRules and Adrs; never a Spec or a Prd: the contract follows from the domain and the block, not from one capability. A `ui` Design cites the DesignSystem and the block's API Designs in place of the DomainModel and Glossary (`32-ui-design-process.md`) | `design-rules`; convention; `ui-domainmodel` |

## Decisions

- A downstream answer that changes a Design reaches it through `design-one` with `base` and
  `changes`, as a Spec's does through `spec-one` (`27-spec-process.md`): the revision keeps every
  `EL-n` the Plans and the TestDesigns cite and passes the Design's own Gate. In the live run a
  TestDesign answer asked the Booking API for a 404 on an unknown booking, and no run could carry
  it. Keeping the ids is the prompt's rule; a check against `base`, as `checkSpec` has, is the
  upgrade. Found in UAT.

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
- `design-rules` says the document's dialect is the block's `technology`: the live data schema of a
  block declared "Node service, SQLite" was PostgreSQL DDL (`EXTRACT`, `INTERVAL`), and nothing in
  `checkDesign` read `technology`. Now `dialect` warns on a word list per store, a warning because a
  word list is a heuristic and must not block a round; the first `warning` in the pack, so the
  Adapter's `passed` became "no `error` finding". Found in UAT.

- The Validator parses the document for its names and nothing more: the index was hand-written
  and checked against the DomainModel alone, so an operation the document declared and the index
  skipped, or an element naming a path the document lacked, passed. Names are cheap and exact per
  mediaType (`yaml` is a dependency, DDL is a regex over comment-stripped text); schemas and fields
  stay unread, a dialect check is a word list beside this. The first run over the examples found
  example08's fleet API document declared `components` twice, invalid YAML that every earlier gate
  had passed; merged by hand. Found in implementation.
- A Design may link what lives outside the engine, never replace its document with a link: the
  content is digested, frozen in the snapshot, pinned by provenance and parsed by the Validator, and a
  Figma file changes under its link. `references[]` carries `ExternalResourceRef`s, the engine's one
  shape for an outside thing (`00-resource.md`), inlined in the kind schema: the Task handler inlines a
  cross-file `$ref` for value ports only, an artifact port's kind schema reaches the Adapter raw, and
  the agent library rewrites `#/$defs/` alone, so a `resource.yaml#/...` `$ref` would reach the CLI
  unresolved. The alternative, inlining artifact output schemas in the handler too and writing the
  `$ref`, was set aside: the kind schema is also what `validate` and the UI read, and a kind that
  stands alone reads without the engine. Files beside the document (a
  rendered HTML, mockup images) are `representations` of the revision: the agent leaves them
  flat under `<files>/design/` and the runner publishes them (`18-artifact.md`). Found in design review.
- Proven live on `claude-sonnet-5`: `design-all` for the Reservation API of example08's `BB-1`
  passed round one under the contract check, a 283-line OpenAPI document declaring ten operations
  and an index of ten, none unbacked, none unindexed, two open questions. The run's `qualifier`
  carried the type by mistake (`reservations-http-api`, so the id ended `-http-api-http-api`): the
  id template appends `-<type>` itself, and the caller gives the label alone. Found in UAT
  (example08).
- `qualifier` in the Design id: the id was `<architecture>-<block>-<type>`, so the second API of a
  block, or the schema of its second context, published revision 2 of the first Design instead of a
  second one; example07's `BB-1` provided four interfaces and only one was designed, so it never
  showed, and example08's one service block realises two contexts. The caller names the qualifier
  (an interface or a context as a label), as every id stem in the pack is caller-named; the id stays
  unchanged when no qualifier is bound. `design-all` takes `interface` and `qualifier` too, so a run
  over blocks can bind one interface. Found in UAT (example08).
- A command a policy invokes is `unrealised-internal`, an info, not a gap: the live example08
  run left four commands per context unrealised, every one a timeout, a cascade or an update the system
  runs on itself, which no http-api should expose; the warnings now name what a Design still owes.
  The DomainModel does not say whether an actor also issues such a command, so one that an actor
  issues too is noted the same way. An event an external system emits (the garage's "Car
  serviced") is noted the same way: no Design of the model publishes it. `persimmon tree` prints
  info findings beside the warnings. Found in UAT (example08).
- Coverage is a report, not a refusal: `unrealised` is a warning and `design-coverage` Succeeds.
  A stormed command no contract exposes, an aggregate no schema holds, an event with no
  `async-api` Design yet are gaps of the product, not defects of the Designs that exist, and a
  Gate that refused would blame the last Design written. It is its own Workflow, not the last
  step of `design-all`: a fan-out over blocks of one type cannot see the other types' Designs, and
  the report is wanted after every type is in. It lives in the pack and the sdd Adapter, not in a
  CLI verb as `get --behind` does: what a Design realises is the pack's semantics, not the
  engine's. Proven live on the car pool's `car-reservations-model`, seven Designs bound and the four naming it read: five
  commands (`Reject reservation request`, `Release unclaimed reservation`, ...), every event (no
  `async-api` Design), and `AG-3` unrealised; every read model and `AG-1`, `AG-2` realised. Found
  in UAT.

- Field names are held to the Glossary by whole-name match, an alias an error and a missing word a
  warning. The `design-rules` Prompt had said since the first round that domain field and property
  names are Glossary term and fact type names in the document's own convention, never an alias,
  never a domain word the Glossary lacks; nothing checked it. The check splits a name into words on
  case and `_`/`-` and matches the whole against a term's name or a fact type's name less its
  subject and predicate: no stemming, one trailing `s` forgiven, since `claim line has amount` names
  `amount` and nothing shorter. An alias or a deprecated name is an error because the Glossary states
  the right word and the loop's next round can write it; a word the Glossary lacks is a warning
  because `booking_limit_config`'s columns and a refusal's `message` are structure no Glossary
  should list, and a `Q-n` covers the rest. Over the three example files no alias is used and the
  warnings are the names the Glossaries lack (`rule`, `route`, `reason`, `date`, `createdDate`);
  example08, agent-written under the Prompt, warns on `status`, `rule` and `message` only. Proven
  live on the car pool: the stored `car-reservations-glossary` r2 names `slot`, `van need` and
  `damage note`, the hand-loaded `data-schema` Design says `slot_start`, `equipment_need` and
  `damage_location`, ten `term-unknown` warnings; the agent-written `http-api` r2 says `slot` and
  `lateCancellationAndNoShowCount` and passes with three. `glossary` is optional on the Validator
  and the Gate so a `ui` Design and a direct run without one are unchanged. Found in UAT.

## Examples

- `docs/design/examples/sdlc-domain.yaml`: `Design/claims-api`, the OpenAPI contract of `BB-1`'s
  `claims API` with nine elements, one per command and read model of the block; passes `checkDesign`
  (`test/adapters/sdd.test.ts`).
- `design-all` takes one entry per Design with its own context, not one `type` and one DomainModel per run. The
  retest's Architecture had a server block spanning three contexts with four HTTP APIs, and its modules one context
  each: ten `design-all` runs of one block each, one after another, and the loop's parallelism never had more than one
  block. The entry names the context, and the iteration binds that context's DomainModel and Glossary by the ids
  `derive-domain` gives them, so every Design of a product runs in one go. Found in UAT.
