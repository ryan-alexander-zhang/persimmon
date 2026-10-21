# Progress: a product's flow as a map, the human gate answered on it

status: draft · layer: cross-cutting (`25-ui.md`, `20-pack.md` `cli-human/v1`, `14-gate.md`, `23-pack-sdlc.md`) · schema: none

The second Tool, the home of `persimmon ui`. One product's phases are drawn as a graph, the SDLC
pack's and, for a rewrite, the Rewrite pack's around them (`40-pack-rewrite.md`): what is
done, what runs, which round a review loop is in, and the one step waiting on you. A phase opens a
side panel with its runs round by round, every artifact a run made readable as a document, and, when
a human gate waits, the document under review with Approve and Reject. That is the same answer
`persimmon complete` gives, without leaving the browser and without stopping `persimmon ui` for the
project lock.

```text
persimmon ui ──▶ / ──▶ /tools/progress/#<product>/<phase>
  GET  /api/runs                        top-level WorkflowRuns: workflow, phase, steps, inputs, upstream artifacts, parked TaskRuns
  GET  /api/runs/<ns>/<name>            the run and every run it owns, nested, as `persimmon tree` walks it
  GET  /api/artifacts/<ns>/<kind>/<id>/<rev>   (25-ui.md) a revision, read as a document
  GET  /api/kinds/<kindName>            the kind's content schema: field descriptions
  GET  /api/inbox, /api/inbox/<ns>/<taskRun>   the TaskRuns parked on a human here, and one's form
  POST /api/inbox/<ns>/<taskRun>        {outputs} ──▶ the complete path ──▶ Signal ──▶ drain in this process

map ──click a phase──▶ panel: runs, rounds, verdicts, artifacts ──"Review"──▶ document + findings ──▶ Approve | Reject
```

## Map

```text
            [PRD]
              │
           [Domain]
              │
        [Architecture]
          ┌───┴────────┐
      [Specs]   [Design system]
          │            │
          │       [Designs]
          ├────────────┤
       [Plans]    [Test setup]
          │            │
          │      [Test design]
          └───┬────────┘
           [Build]
```

A rewrite's map: the Rewrite pack's phases before Domain, Recover PRD in the PRD station's place
(the Prd is recovered, not authored), Parity after Build; the SDLC phases between them as above.

```text
          [Survey]
              │
         [Inventory]
              │
        [Characterize]
              │
        [Recover PRD]
              │
           [Domain]
             ...
           [Build]
              │
           [Parity]
```

| Part | Behaviour |
|---|---|
| product | a product is a Prd id; a run belongs to every Prd its input and output artifacts reach through `provenance.inputs`, and a run with no Prd upstream but a `productId` input (`author-prd` before its first draft, every Rewrite pack run before `recover-prd`) to `<productId>-prd`, the id the Prd will take; the top bar picks one, the product with a step waiting on you first, then the newest |
| phase | one node per phase, from the pack's top-level workflows: PRD `author-prd`; Domain `domain-discovery` and its storm and derive workflows; Architecture `architect`; Design system `design-system`; Specs `spec-all`, `spec-one`; Designs `design-all`, `design-one`; Plans `plan-all`, `plan-one`; Test setup `setup-tests`, `harness-work`; Test design `test-design-all`, `test-design-one` (`39-test-process.md`); Build `build-all`, `build-one`; for a rewrite, a product with any Rewrite pack run: Survey `survey`, `survey-work`; Inventory `inventory`, `inventory-work`; Characterize `characterize`, `characterize-work`; Recover PRD `recover-prd`, `recover-work`, in the PRD station's place; Parity `parity`, `parity-work`. A loop's `<name>-round` runs are owned by the loop's run, never top level, so no phase names them |
| state | from the phase's newest run, the map reading top to bottom beside the panel: not started, running (with the review loop's round), waiting on you, approved, rejected after its last round (`passed: false`), failed with its error; a phase with several runs (one per context) says how many are done; a run for a Slice (a `slice` input, `SL-n`) leads its line with the Slice: `SL-2: Round 1, running` |
| needs you | the only saturated colour on the map: a phase holding a TaskRun parked on a human here; the top bar counts them across products and jumps to the first |
| edges | as the artifacts cite upstream (`23-pack-sdlc.md`), Architecture to Designs drawn through Design system, a Spec to its TestDesign through Test setup: solid once the upstream phase is done |
| refresh | every 3 s; the open panel and the review in progress are kept |

## Products

`#products`, a button in the top bar: every product of the project and how they talk, read from
the store, not from runs, so it stands before any run.

| Part | Behaviour |
|---|---|
| node | one per Prd (`prds.sdd.persimmon.ai`, latest revision): its `title`, a chip per subdomain with its type; clicking it opens the product's map |
| edge | one per `externalSystem` of the product's latest storming (`<prd id>-storming`, `26-domain-discovery.md`) whose `properties.product` (DSL 4.2, `24-eventstorming.md`) names another product, labelled with the external system's label, from the product that talks to the one it names |
| missing | a product named and not in the store is a dashed node titled by its stem, "No Prd": the link is wrong or the Prd not yet published; nothing opens from it |
| no relationship type | an edge says who talks to whom; the DDD pattern between products is the Architecture's `context.business` (`31-architecture-process.md`) |

## Panel

| Part | Behaviour |
|---|---|
| runs | the phase's runs, newest first, each named by its Slice when it has one and its start; the newest opens, on its review when one waits on you |
| rounds | a review loop's rounds in order, each the produced artifacts and the review: one line per Validator, passed or not, its findings under it, the human's own among them; a fan-out (`spec-all`) lists its children the same way |
| artifact | any artifact a round made opens as a document in the panel, read-only |
| review | a TaskRun parked on a human here shows "Review"; it opens the form's Reading as documents, the Task's instructions above them, value inputs (the auditor's verdict) beside them |

## Document

Any kind, from its content and schema, set as prose to read rather than a form.

| Content | Set as |
|---|---|
| the content's `title` or `name` | the document title |
| a top-level field | a section, its heading the field name in words, its schema `description` on hover |
| a string | paragraphs; line breaks kept |
| an array of objects | one subsection per element, headed by its `id` (else its `ref`, as a ParityLedger item names what it accounts for) and its short `name`, `title`, `label` or `statement` |
| short scalar fields of an element (enum, number, id, short string) | one line under its heading: `Priority P1, subdomain expenses` |
| an array of scalars | a list; ids (`BR-2`) as inline tags |
| a nested object | an indented block of the same rules |
| EventStorming | the same, and "Open the board" to the Editor at that revision |
| SourceInventory | the same, sections in reading order rather than the agent's: entry points, then the entities and external systems they reach, guards, declarations, state changes, absences, plumbing patterns, tests, unread, open questions |
| ParityLedger | the same, the verdict first, then slices, entry points with their Oracle, items with their account and reason, differences, unreached, then the rest |

## Changes between rounds

In a review of revision 2 or later, each document shows what changed since the revision before
it, the one the last round reviewed. A switch beside the document's title turns it off; it starts on.

| Change | Shown as |
|---|---|
| words added or removed in a passage | added underlined in green, removed struck through in red, word by word |
| a short field changed | the new value, the old one struck through beside it |
| an element added or removed | matched by its `id`, so a reordered list is no change: an added element tagged "Added", a removed one faded and tagged "Removed" |
| a list entry added or removed | the entry tagged the same way |
| a section with no change | folded to its heading and "unchanged", opened on a click |

## Verdict

Shown when every output of the parked Task is a ValidationResult value port, as on the four
`confirm-*` Tasks of the SDLC pack. Any other form shows its Reading and says to answer with
`persimmon complete`: a draft the pack gives an agent, or a Rewrite pack decision (`cut-slices`,
`decide-recovery`, `review-parity`), a typed `decisions` value the human writes as a file, the
form's schema saying its shape.

| Action | Behaviour |
|---|---|
| select | select text in the document: "Add finding" appears beside the selection |
| note | a box opens there with the quote; Enter keeps the finding, Shift+Enter breaks the line, Escape drops it; a passage with a finding carries a persimmon rule in the margin, and every finding is listed above the buttons, removable |
| heading | the comment button on a subsection heading notes a finding on the whole element |
| anchor | the message starts with the nearest `id` around the selection and the field below it (`CAP-2 description: …`), else the artifact id and the section (`claims-prd problem: …`), then the quote: `CAP-2 description: "builds a claim from lines" — split per approver tier` |
| general | one box for what no passage holds |
| approve | one click; findings go with it as notes, `severity: info`, `code: note_<n>` |
| request changes | the reject, named for what it does in a review loop; enabled with one finding or more; findings `severity: error`, `code: blocking_<n>` |
| answer | `{passed, findings, evidence}`, evidence the RevisionRefs shown, as `askVerdict` builds it at the terminal, posted to `/api/inbox` |
| after | the phase turns to running and its next round appears on the next refresh; a 409 says it was answered elsewhere |

## API

Added to `src/server/api.ts` (`25-ui.md`), under the same Host and content-type checks. Read only
but `POST /api/inbox`.

| Route | Answer |
|---|---|
| `GET /api/runs` | `{directory, runs: [{namespace, name, workflow, phase, waitingReason?, error?, created, steps: {<id>: {phase, iteration?}}, inputs, outputs, upstream: [{kind, id}], parked: [{taskRun, task, verdict}]}]}`: every WorkflowRun without an owner; `upstream` every artifact its input and output refs reach through `provenance.inputs`; `parked` its descendants waiting on a human that this engine drives, with an inbox form |
| `GET /api/runs/<ns>/<name>` | `{kind, name, label, phase, waitingReason?, error?, created, finished?, outputs?, result?, children: [...]}`, nested; `label` the child's name minus its owner's, as the tree prints it |
| `GET /api/inbox` | `{directory, parked: [{namespace, taskRun, task, deadline, form, verdict}]}`: every TaskRun Waiting on a human that this engine drives (`08-store.md`) |
| `GET /api/inbox/<ns>/<taskRun>` | the parsed form; 404 when the TaskRun is not parked here or has no form |
| `GET /api/kinds/<kindName>` | `{name, apiVersion, kind, schema}`, the kind's content schema |
| `POST /api/inbox/<ns>/<taskRun>` `{outputs}` | `fromFile` with the form, the signal `complete` sends, the form removed, one drain after the response; 200; 400 with the schema message; 404 unknown; 409 not waiting on a human, or another project directory's, which the message names |

## Rules

| Rule | Enforcer |
|---|---|
| the server knows no pack: products, phases and their order are the Tool's, over the generic run and lineage routes | `tools/progress/src/lib/flow.ts` |
| one completion path: the UI and `persimmon complete` share `fromFile`, the Waiting and project directory checks, the signal and the form removal | `src/server` imports `cli/signal` |
| the map, the inbox and the dispatcher agree on which Runs this engine drives: one predicate | `owns` from `src/reconcile/dispatch.ts` |
| the run tree is the CLI's walk: `ownedBy` and the label rule | `src/server` imports `cli/tree` |
| agent content is rendered as text by React, never as HTML | `tools/progress` renders `spec.content` only |
| the flow, the document blocks, the finding builder and the product graph are pure and tested without a DOM | `tools/progress/src/lib/*.test.ts` |

## Decisions

- A Products page, not a Domain kind: an organisation of several products (a CRM and the agent it
  routes to, each its own Prd, domain and storming) needed one picture of who talks to whom, and the
  only cross-product fact persimmon holds is an external system naming another product (DSL 4.2).
  The page reads Prds and stormings and draws that; a product's inside stays its own map. No
  relationship type on the edge, since the pattern between products is the Architecture's, and no
  gate on the link, since a Gate cannot query every Prd: a wrong id shows as a dashed node. Found
  in a reading of `cai-workspace`.
- A map of the product's phases is the home, not a list of tasks: the human asked where the product
  is, what came before the gate and what comes after, and a list of parked tasks answered none of it.
  The review is a panel on the map so the place stays in view. Found in UAT; supersedes the Inbox list.
- The phases are the SDLC pack's and live in the Tool: the server lists runs and their lineage
  without naming a kind or a workflow, as the Editor is a Tool over one kind. A project's own
  workflow appears on no phase until the Tool names it.
- A product is a Prd id found through `provenance.inputs`: every SDLC artifact cites the Prd
  upstream, so lineage groups runs without a product field on the run. `author-prd` before its
  first draft is grouped by its `productId`, the stem the Prd id takes.
- Documents, not forms: the Inbox's grid of labels and values read as a database row. Sections,
  paragraphs and one meta line per element read as the PRD or architecture document it is. Still one
  generic renderer; a per-kind layout comes when a kind reads badly in it. The first is a section
  order: a SourceInventory set its guards before the entities and external systems its entry points
  cite, and a ParityLedger's verdict, the reader's first question, goes first. Found in UAT (the
  jpetstore Survey).
- Findings by selecting text, as in a document editor, plus a heading button for a whole element:
  the Inbox's outline and button on every hovered item was noise. The anchor is still the nearest
  `id` in the message, the quote added, because the ReviewLoop feeds messages back and ValidationResult
  has no path field.
- One saturated colour, persimmon, means "waiting on you"; every other state is ink, green or red at
  low saturation, so the eye finds the gate first. Fonts are the system's: the Tool runs offline.
- React Flow for the map: already a dependency of the Editor; nothing else added. A fixed layout,
  not an automatic one: ten phases in a known order need no graph layout library.
- Changes between rounds compare the two revisions' documents, not their JSON: blocks pair by the
  anchor a finding would name, so an element follows its `id` and a reordered list shows no change,
  and only prose is diffed word by word. The word diff is the `diff` package (jsdiff 9.0.0): no
  dependencies of its own, its own types, maintained; a hand-written longest common subsequence was
  the alternative, and the repository reuses a maintained library before it builds one. Found in UAT.
- A rewrite is a product before it has a Prd: its runs carry `productId`, so they group under
  `<productId>-prd`, the id `recover-prd` gives, and the SDLC runs that later cite that Prd land on
  the same map. Keying products by the stem instead was rejected: every link already names the Prd
  id. The Rewrite phases show only on a product that has a Rewrite pack run, so a product from an
  idea keeps its map. Found in UAT (a Survey parked on `cut-slices` showed "No product yet").
- Polling every 3 s: loopback, request-response, and a drain changes a run within seconds.
- The UI answers the gate, superseding decision 350; reject needs a finding; a non-verdict form is
  answered with `persimmon complete`; only this project directory's parked TaskRuns are offered
  and answered, while the map shows every run on the Store.
  Kept from the Inbox (decisions 487–493, 499).
