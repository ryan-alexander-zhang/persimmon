# UI design process

status: draft · layer: 2 (`23-pack-ai-native.md`, `29-design-process.md`, `31-architecture-process.md`) · schema: the `DesignSystem` kind and the `ui` type of the `Design` kind in `packs/ai-native/global/10-artifact-kinds.yaml`

From the Architecture's client blocks to what a build agent needs to make their screens: one
`DesignSystem` per product in the DESIGN.md format, confirmed by a human, and one `ui` Design per
client block, its screens indexed against the DomainModel like any other Design. Closes the gap the
live Plans showed ("No Design for BB-6 (Door Status Screen) is in context", example07).

```text
ReviewLoop design-system, once per product
  produce: Task write-design-system (design-system-agent) ─▶ DesignSystem <prd>-design-system
  review:  Gate design-system-gate = Validator design-system-lint (designmd/v1) + design-system-confirmed (human)
  previous and feedback fed back; maxRounds 3
Workflow design-all with type ui, over the client blocks ─▶ ReviewLoop design-one per block, designSystem and the block's API Designs bound
  produce: Task design-asset (design-agent) ─▶ Design <architecture>-bb-n-ui
  review:  Gate design-gate = Validator design-consistency (sdd/v1), designSystem added
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
shows, each with Purpose, Data (the read model and its fields, Glossary names), Actions (the command
each control submits and the API operation that carries it, as the block's `http-api` Design names
it), States (empty, loading, refused naming the `BR-n`), Layout (the DESIGN.md components and
tokens by name). `designSystem` is the DesignSystem artifact id. `elements` index the document:
one per screen, `realises` the read model it shows, and one per action, `realises` the command it
submits; `name` is the section heading or "`<screen>`: `<control>`". No `interface`: a client block
provides none.

## Process

| Member | Content |
|---|---|
| Prompt `design-system-rules` | the DESIGN.md spec as the pack reads it: every section present and in order, `omitted` only with a reason; the Overview from the Prd's users and the client blocks' `technology` (a kiosk read at ten metres is not a phone); contrast WCAG AA; components for every control the client blocks need; nothing the product does not show |
| Executor `design-system-agent` | `claude-code/v1`, read-only, its own name for per-Namespace override |
| Task `write-design-system` | inputs `prd`, `architecture`, `previous`, `feedback`; output `designSystem` (id `<prd>-design-system`) |
| Task `confirm-design-system` | human on `cli-human/v1`: reads the DESIGN.md; approve, or one finding per section or token that must change |
| Validator `design-system-lint` | `designmd/v1` over `designSystem`, `failOnWarning: true` |
| Validator `design-system-confirmed` | over `confirm-design-system` |
| Gate `design-system-gate` | lint and confirmed, `all`, 72h |
| ReviewLoop `design-system` | `produce` `write-design-system`, `review` `design-system-gate`, `maxRounds: 3` |
| Prompt `design-rules` | gains the `ui` paragraph above |
| Task `design-asset`, ReviewLoop `design-one`, Workflow `design-all` | `type` enum gains `ui`; inputs `designSystem` (optional) and `designs` (artifacts, optional: the `http-api` Designs of the interfaces the block requires) threaded through; `design-all` with `type: ui` runs over the client blocks listed |
| Validator `design-consistency`, Gate `design-gate` | `designSystem` (optional) threaded through |

Run, after `architect` and the `http-api` Designs:
`persimmon run design-system --input 'prd={...}' --input 'architecture={...}'`, then
`persimmon run design-all --input 'blocks=[BB-5, BB-6, BB-7]' --input type=ui --input 'designSystem={...}' --input designs=@designs.yaml <architecture, domainModel, glossary, rules>`.
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
| `designsystem-mismatch` | `designSystem` is not the id of the DesignSystem bound (`ids.designSystem`), or absent on a `ui` Design |
| `client-block` | a `ui` Design's block realises a context (`contexts` non-empty): screens belong to clients |
| the rest | as any Design: `unknown-block`, `unknown-realised` (read models and commands), rules both ways, `id-sequence` |

## Rules

| Rule | Enforcer |
|---|---|
| the DESIGN.md is the truth: the pack adds no field that restates a token or a section; what the file says, the linter checks | kind schema; `design-system-lint` |
| one DesignSystem per product, confirmed by a human: taste is not a Validator's; the linter catches the format, the contrast and the broken reference | `design-system-gate` |
| a `ui` Design cites the DesignSystem, the DomainModel and the block's API Designs; never a Spec: a screen serves every capability that reaches the block | `design-rules`; `checkDesign` |
| the document's components and operations are not checked against the DesignSystem's tokens or the API Design's operations: the document is prose, the Design evaluator parses documents (`91-roadmap.md`) | convention; roadmap |
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
- The `ui` Design is a Design, not a fourth kind: it has a block, a document, an index against the
  DomainModel and rules, and `design-all`, `design-one`, `plan-all` and `checkDesign` take it without
  a new loop. Found in design review.
- No human at `design-gate` for a `ui` Design, as for any Design (`27-spec-process.md`): the human
  confirmed the DesignSystem; a screen's layout follows from it and the block. Found in design review.

- A revisioned KindDefinition never changes (`01-kind-definition.md`), so the `ui` type and `designSystem`
  on the Design kind were refused by `apply` in the project that ran example07: `Design is revisioned;
  its KindDefinition never changes`. The UAT moved to a fresh project loaded from the recorded output.
  A compatible-change rule (optional property, widened enum) is on the roadmap; until then a pack
  upgrade that touches a revisioned kind needs a fresh project. Found in UAT.

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

## Examples

- `examples/example07/`: `DesignSystem/room-booking-prd-design-system` and the `ui` Designs of
  `BB-5`, `BB-6` and `BB-7`, written live; the CAP-5 Plan rerun names their elements.
