# UI design process

status: draft · layer: 2 (`23-pack-sdlc.md`, `29-design-process.md`, `31-architecture-process.md`) · schema: the `DesignSystem` kind and the `ui` type of the `Design` kind in `packs/sdlc/global/10-artifact-kinds.yaml`

From the Architecture's client blocks to what a build agent needs to make their screens: one
`DesignSystem` per product in the DESIGN.md format, confirmed by a human, and one `ui` Design per
client block, its screens indexed against the block's API Designs. Closes the gap the
live Plans showed ("No Design for BB-6 (Door Status Screen) is in context", example07).

```text
ReviewLoop design-system, once per product
  produce: Task write-design-system (design-system-agent) ─▶ DesignSystem <prd>-design-system
  review:  Gate design-system-gate = Validator design-system-lint (designmd/v1) + design-system-confirmed (human)
  previous and feedback fed back; maxRounds 3
Workflow design-all with type ui, over the client blocks ─▶ ReviewLoop design-one per block, designSystem and the block's API Designs bound
  produce: Task design-asset (design-agent) ─▶ Design <architecture>-bb-n-ui
  review:  Gate design-gate = Validator design-consistency (sdd/v1), designSystem and designs added
```

## DESIGN.md

The format is Google Labs' DESIGN.md (`github.com/google-labs-code/design.md`, Apache-2.0, version
`alpha`, package `@google/design.md` 0.4.0): YAML front matter with the tokens (`name`, `colors`,
`typography`, `spacing`, `rounded`, `components`, optional `omitted`), then a markdown body of `##`
sections in this order: Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components,
Do's and Don'ts. Tokens are normative, prose is rationale; `{colors.primary}` references a token.
The pack stores the file verbatim as `document.content` and never restates it in fields: a build
agent reads it as the file it already knows, and `npx @google/design.md export` turns it into a
Tailwind theme or DTCG tokens.

## `DesignSystem`

One per product, id `<prd>-design-system`.

| Field | Content |
|---|---|
| `title`, `prd` | the product; the Prd artifact id |
| `document` | `{mediaType: text/markdown, content}`, the DESIGN.md whole |
| `decisions[]` | Adr artifact ids taken for the visual language, from the Architecture's list |
| `openQuestions[]` | `Q-n`: brand facts the Prd and brief do not give (a company colour, a typeface licence, a kiosk's viewing distance) |

## `ui` Design

A `Design` of `type: ui` for one client block (a block with `contexts: []` that requires an
interface): `document.mediaType: text/markdown`, one `## <screen>` section per screen the block
shows, whichever context serves it, each with Purpose, Data (the operation whose response the
screen shows and the fields it renders, as that operation's schema names them), Actions (each
control and the operation it submits, as the block's `http-api` Designs name it), States (empty,
loading, refused naming the `BR-n`), Layout (the DESIGN.md components and tokens by name).
`designSystem` is the DesignSystem artifact id. No `domainModel`: a client knows the operations it
calls, not the model behind them, so it cites the API Designs and no Glossary. `elements` index the
document: one per screen, `realises: {kind: operation, name}` the operation whose response it
shows (a form screen that reads nothing: the operation its action submits), and one per action, the
operation it submits, `name` as the API Design's element names it
("`GET /rooms/{roomId}/status`"); the element `name` is the section heading or
"`<screen>`: `<control>`". An operation a screen needs that no API Design offers is a `Q-n`, never
an invented one. No `interface`: a client block provides none.

## Process

| Member | Content |
|---|---|
| Prompt `design-system-rules` | the DESIGN.md spec as the pack reads it: every section present and in order, `omitted` for token groups only, with a reason; the Overview from the Prd's users and the client blocks' `technology` (a kiosk read at ten metres is not a phone); contrast WCAG AA; components for every control the client blocks need; nothing the product does not show |
| Executor `design-system-agent` | `claude-code/v1`, read-only, its own name for per-Namespace override |
| Task `write-design-system` | inputs `prd`, `architecture`, `previous`, `feedback`; output `designSystem` (id `<prd>-design-system`) |
| Task `confirm-design-system` | human on `cli-human/v1`: reads the DESIGN.md; approve, or one finding per section or token that must change |
| Validator `design-system-lint` | `designmd/v1` over `designSystem`, `failOnWarning: true` |
| Validator `design-system-confirmed` | over `confirm-design-system` |
| Gate `design-system-gate` | lint and confirmed, `all`, 72h |
| ReviewLoop `design-system` | `produce` `write-design-system`, `review` `design-system-gate`, `maxRounds: 3` |
| Prompt `design-rules` | gains the `ui` paragraph above |
| Task `design-asset`, ReviewLoop `design-one`, Workflow `design-all` | `type` enum gains `ui`; inputs `designSystem` and `designs` (artifacts: the `http-api` Designs of the interfaces the block requires) `required: {expression: "inputs.type == 'ui'"}`, `domainModel` and `glossary` `required: {expression: "inputs.type != 'ui'"}` (`10-ports.md`): a run that lacks what its `type` needs is refused at `run`; threaded through with `onMissing: omit` where the engine does not add it (a Workflow step, a Gate's Validator binding; the loop adds it to `produce` and `review`, `21-composition.md`); `design-all` with `type: ui` runs over the client blocks listed |
| Validator `design-consistency`, Gate `design-gate` | `designSystem` and `designs` (optional) threaded through; `domainModel` optional |

Run, after `architect` and the `http-api` Designs:
`persimmon run design-system --input 'prd={...}' --input 'architecture={...}'`, then
`persimmon run design-all --input 'blocks=[BB-5, BB-6, BB-7]' --input type=ui --input 'designSystem={...}' --input designs=kind:Design <architecture, rules>`: every Design of the project at its latest revision (`33-multi-context-product.md`), the `http-api` ones the screens realise among them; or a list file of those alone; no `domainModel`, no `glossary`.
`plan-all` then takes the `ui` Designs in its `designs` list like any other.

## `designmd/v1`

`adapters/designmd/index.mjs`, evaluator Role: `lint(artifacts.designSystem.content.document.content)`
from `@google/design.md/linter`; a finding `{severity, rule, message}` becomes `{severity, code: rule, message}`;
`passed` iff no error, nor a warning when `configuration.failOnWarning`. Infos pass through. A content
without `document.content` is `not-a-design-system`, the only finding then. No Engine callbacks.

## `checkDesign` for `ui`

| Code | Finding |
|---|---|
| `type-mediatype` | `ui` pairs with `text/markdown` only |
| `designsystem-mismatch` | `designSystem` absent on a `ui` Design, no DesignSystem bound to the Validator, or the id is not the one bound (`ids.designSystem`) |
| `client-block` | a `ui` Design's block realises a context (`contexts` non-empty): screens belong to clients |
| `ui-domainmodel` | a `ui` Design names a `domainModel`: its elements realise operations, not model labels |
| `domainmodel-unbound` | a Design of another type with no DomainModel bound to the Validator (its port is optional so a `ui` run binds none): one finding, the elements are not checked |
| `designs-unbound` | no Design is bound to the Validator's `designs`: nothing to realise; one finding, the elements are not checked |
| `unknown-realised` | an element's `realises` is not `{kind: operation, name}` with `name` an element name of a bound Design |
| `document-unindexed`, `element-unbacked` | a `## <screen>` heading of the document with no element named like it, a screen a Plan cannot realise; an element whose screen is no heading (`29-design-process.md`, every type) |
| `action-unknown` | a `METHOD /path` in backticks under a screen's Actions that is not an element name of a bound Design |
| `action-unbacked` | an action element (`<screen>: <control>`) whose `realises.name` is not in backticks under that screen's Actions, or the screen has no Actions |
| `layout-unknown` (warning) | a backticked name under a screen's Layout that is not a `components` key of the DesignSystem's front matter, nor a key of `colors`, `typography`, `spacing` or `rounded` bare or as `<group>.<key>`; no front matter to read, no check |
| the rest | as any Design: `unknown-block`, rules both ways, `id-sequence` |

A `ui` Design drawn in a design tool names it in `references[]` (`29-design-process.md`): the
markdown stays the document the screens are read from; the Figma file, pinned by version when the tool has one, is where
the pixels are (example07's `bb-5-ui`).

## Rules

| Rule | Enforcer |
|---|---|
| the DESIGN.md is the truth: the pack adds no field that restates a token or a section; the linter checks the tokens (references, contrast, orphans, section order), the human checks the prose: that every section is present with something to say is not a linter rule | kind schema; `design-system-lint`; `confirm-design-system` |
| one DesignSystem per product, confirmed by a human: taste is not a Validator's; the linter catches the format, the contrast and the broken reference | `design-system-gate` |
| a `ui` Design cites the DesignSystem and the block's API Designs; never a DomainModel, a Glossary or a Spec: a client knows the operations it calls, not the model behind them, and a screen serves every capability that reaches the block | `design-rules`; `checkDesign` (`ui-domainmodel`, `unknown-realised`) |
| a screen's prose is read where it names things: a `METHOD /path` in backticks under Actions is an operation of a bound Design, an action element's operation is in its screen's Actions, a backticked name under Layout is a component or token of the DesignSystem (advice); a part opens with `### <Part>` or a `**<Part>.**` line, fenced code is skipped; the rest of the prose is prose | `checkDesign`; `design-rules` |
| a `ui` Design is per block, as every Design: the Architecture already cut one block per client surface | `design-all` |

## Decisions

- Two artifacts, not one: DESIGN.md describes a visual language, product-wide, with nothing per
  screen; the Plan needs elements per block to realise. The DesignSystem is to the `ui` Designs what
  the Architecture is to the API Designs: once per product, confirmed by a human, cited by id.
  Found in design review.
- The official format verbatim, as a `text/markdown` document, instead of a YAML kind with the same
  fields: the agents that build the screens already read DESIGN.md, the official linter and exporters
  read the file and nothing else, and the format is `alpha`, so a restated schema would drift. The
  kind holds the file and the pack's own links (`prd`, `decisions`, `openQuestions`). Found in design
  review.
- Dependency `@google/design.md@0.4.0` (runtime, exact): supplies the DESIGN.md parser and linter
  (section order, broken token references, WCAG contrast, missing primary or typography). Compared:
  an own front matter and section-order check (sixty lines, no contrast, no reference resolution, and
  it would restate a moving spec), and `npx` at evaluation time (fetches from the network inside a
  Validator, refused by the credential and provenance rules). The package pulls the remark stack,
  `zod` and `yaml` (86 packages, 15 MB); `yaml` dedupes with ours. Imported from the Adapter only, no
  `src/` import. Found in design review.
- `failOnWarning: true` on the pack's Validator: `section-order`, `contrast-ratio`, `missing-primary`
  and `missing-typography` are warnings to the linter and defects to a design system an agent wrote
  for other agents. A project that wants the linter's defaults sets its own Validator. Found in
  design review.
- A `ui` Design's elements are screens and actions with the existing `realises` shape (one label
  each): a Plan task names the screen it builds as an element, and the screen's read model is the
  label a consistency check can hold it to; a second shape for UI elements would give the Plan two
  grammars. Found in design review.
- A `ui` Design realises operations of the block's API Designs (`realises.kind: operation`, `name`
  the API Design's element name) and carries no `domainModel`, replacing the read-model and command
  labels above. example08's web application serves two contexts, and a Design binds one model: round
  one indexed every screen and failed `unknown-realised` on the second context's nine elements; round
  two kept those four screens in the document and dropped their elements, so no Plan could realise
  them. The model was the wrong layer: a client knows the operations it calls, not the model behind
  them; the API Design already holds each operation to the model. One `ui` Design per client block
  stays, whatever contexts it shows; `document-unindexed` holds every `## <screen>` to an element,
  which is what round two slipped past. The same `realises` shape with a fifth kind keeps the Plan's
  one grammar. example07's three `ui` Designs re-realised by hand (five operations of the booking
  API). Found in UAT.
- The `ui` Design is a Design, not a fourth kind: it has a block, a document, an index against the
  DomainModel and rules, and `design-all`, `design-one`, `plan-all` and `checkDesign` take it without
  a new loop. Found in design review.
- No human at `design-gate` for a `ui` Design, as for any Design (`27-spec-process.md`): the human
  confirmed the DesignSystem; a screen's layout follows from it and the block. Found in design review.

- A revisioned KindDefinition never changes (`01-kind-definition.md`), so the `ui` type and `designSystem`
  on the Design kind were refused by `apply` in the project that ran example07: `Design is revisioned;
  its KindDefinition never changes`. The UAT moved to a fresh project loaded from the recorded output.
  `apply` now takes a schema change where every committed revision still validates
  (`01-kind-definition.md`); example08's project (`uat3`) still refuses this pack's Design kind,
  its two `ui` Designs written against the DomainModel fail the new schema, which is the rule
  working. Found in UAT.

- Live round one on `claude-sonnet-5`: the file came back whole and in order, twelve typography levels
  and fifteen components, and the linter refused seven `border` sub-tokens (`broken-ref`: not in the
  closed set `backgroundColor`, `textColor`, `typography`, `rounded`, `padding`, `size`, `height`,
  `width`). The Prompt listed five and said "with", not "only"; it now names the set and says a
  border or a shadow is prose. The human's findings beside the linter's: a report page no client block
  shows, and a kiosk's stale state as a badge rather than a whole screen. Found in UAT.

- Round two (3m49s) passed the linter first time and answered both human findings in place: the
  report page became a sentence saying no client block shows it, and the kiosks got
  `door-status-panel-offline` and `floor-room-tile-offline` with "last updated at HH:MM" as a
  `label-sm` use. Dropping `border` made the agent redesign the secondary button and the input as
  filled controls instead of saying the border in prose, so "change nothing else" bent where the
  linter's finding reached into the look; the human approved at r2. Found in UAT.

- `design-all` with `type: ui` over `BB-5`, `BB-6`, `BB-7` live on `claude-sonnet-5`: three Designs,
  each round one (1m54s, 1m42s, 55s), `design-consistency` clean. Six elements for the booking app
  (two screens, four actions, the rules on each action), one each for the kiosks. Their questions are
  gaps upstream, not in the screens: the API Design has no operation to list rooms by fit, and the
  DomainModel has no fact for a room's name, so a door screen cannot say which room it is. One Design
  wrote its subsections as bold labels, another as `###` headings; the Prompt now says `###`. Found
  in UAT.

- `plan-all` rerun over `CAP-1` and `CAP-5` with the five Designs listed: both round one (1m23s, 35s).
  The CAP-5 Plan now has a task per kiosk with the screen as its element and no open question; the
  CAP-1 Plan gained a `BB-5` task realising the booking screen and its Book action. The question the
  live chain raised twice ("No Design for BB-6 is in context") is closed. Found in UAT.

- Found in audit: the optional `designSystem` and `designs` bindings had no `onMissing: omit` on the
  Gate's Validator binding and on `design-all`'s step, and the ReviewLoop expansion added it to
  `produce` but not to `review`; every `http-api` or `data-schema` run would have failed `source absent`
  at bind, and the live UAT missed it because it bound both. The expansion now treats `review` like
  `produce` (Layer 1), the pack binds the rest explicitly. Also from the audit: the Prompt told the
  agent to list a prose section in `omitted` (the linter accepts token groups only, `unknown-omission`)
  and counted prose as a token use (`orphaned-tokens` counts component references only); a `ui`
  Design with no DesignSystem bound passed on its own claim; and the Adapter let a parser exception
  end the round without feedback and a list-shaped front matter pass with no findings.
- `checkDesign` on a `ui` Design refuses when no DesignSystem is bound: the Validator's `designSystem`
  input is optional so the other types run without one, and the rule that a `ui` Design needs it lives
  in the check, not the port. Found in audit.
- `designs=kind:Design` serves the `ui` run as well as `plan-all`: live on example08 the `ui` Design
  of `BB-3` passed round one with all five Designs bound (two APIs, two data schemas, its own r1),
  eight screens and twenty elements realising the APIs' operations, the same open question as with
  the two-API list; the data schemas and the old `ui` Design are context the agent reads past and
  elements the Validator never matches. The example's list files are gone. Found in UAT (example08).

- Layout names are a warning, not an error: example08's live screens put field names in Layout
  backticks (`passengerCount`, `serviceState`) beside the DesignSystem's, and a `status-badge-*`
  glob; refusing a screen for those would be the Validator's taste, and a word list is a heuristic
  (`dialect`). Actions are an error: a `METHOD /path` in backticks is a precise claim, and both
  live examples make it precisely. The Prompt now says fields belong in Data. Found in
  implementation.

## Examples

- `examples/example07/`: `DesignSystem/room-booking-prd-design-system` and the `ui` Designs of
  `BB-5`, `BB-6` and `BB-7`, written live against the DomainModel and re-realised by hand to the
  booking API's operations; the CAP-5 Plan rerun names their elements.
