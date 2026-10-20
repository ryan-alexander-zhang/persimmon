# Progress: a product's flow as a map, the human gate answered on it

status: draft · layer: cross-cutting (`25-ui.md`, `20-pack.md` `cli-human/v1`, `14-gate.md`, `23-pack-sdlc.md`) · schema: none

The second Tool, the home of `persimmon ui`. One product's SDLC phases are drawn as a graph: what is
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
[PRD]──▶[Domain]──▶[Architecture]──┬──▶[Specs]─────────────┬──▶[Plans]──▶[Build]
                                   └──▶[Design system]──▶[Designs]──┘
```

| Part | Behaviour |
|---|---|
| product | a product is a Prd id; a run belongs to every Prd its input and output artifacts reach through `provenance.inputs`, and an `author-prd` run with no output yet to `<productId>-prd`; the top bar picks one, the product with a step waiting on you first, then the newest |
| phase | one node per phase, from the pack's top-level workflows: PRD `author-prd`; Domain `domain-discovery` and its storm and derive workflows; Architecture `architect`; Design system `design-system`; Specs `spec-all`, `spec-one`; Designs `design-all`, `design-one`; Plans `plan-all`, `plan-one`; Build `build-all`, `build-one` |
| state | from the phase's newest run: not started, running (with the review loop's round), waiting on you, approved, rejected after its last round (`passed: false`), failed with its error; a phase with several runs (one per context) says how many are done |
| needs you | the only saturated colour on the map: a phase holding a TaskRun parked on a human here; the top bar counts them across products and jumps to the first |
| edges | as the artifacts cite upstream (`23-pack-sdlc.md`): solid once the upstream phase is done |
| refresh | every 3 s; the open panel and the review in progress are kept |

## Panel

| Part | Behaviour |
|---|---|
| runs | the phase's runs, newest first; the newest opens |
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
| an array of objects | one subsection per element, headed by its `id` and its short `name`, `title`, `label` or `statement` |
| short scalar fields of an element (enum, number, id, short string) | one line under its heading: `Priority P1, subdomain expenses` |
| an array of scalars | a list; ids (`BR-2`) as inline tags |
| a nested object | an indented block of the same rules |
| EventStorming | the same, and "Open the board" to the Editor at that revision |

## Verdict

Shown when every output of the parked Task is a ValidationResult value port, as on the four
`confirm-*` Tasks of the SDLC pack. Any other form shows its Reading and says to answer with
`persimmon complete`.

| Action | Behaviour |
|---|---|
| select | select text in the document: "Add finding" appears beside the selection |
| note | a box opens there; Enter keeps the finding, Shift+Enter breaks the line, Escape drops it; the quoted text is marked in the document |
| heading | the comment button on a subsection heading notes a finding on the whole element |
| anchor | the message starts with the nearest `id` around the selection and the field below it (`CAP-2 description: …`), else the artifact id and the section (`claims-prd problem: …`), then the quote: `CAP-2 description: "builds a claim from lines" — split per approver tier` |
| general | one box for what no passage holds |
| approve | one click; findings go with it as notes, `severity: info`, `code: note_<n>` |
| reject | enabled with one finding or more; findings `severity: error`, `code: blocking_<n>` |
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
| the flow, the document blocks and the finding builder are pure and tested without a DOM | `tools/progress/src/lib/*.test.ts` |

## Decisions

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
  generic renderer; a per-kind layout comes when a kind reads badly in it.
- Findings by selecting text, as in a document editor, plus a heading button for a whole element:
  the Inbox's outline and button on every hovered item was noise. The anchor is still the nearest
  `id` in the message, the quote added, because the ReviewLoop feeds messages back and ValidationResult
  has no path field.
- One saturated colour, persimmon, means "waiting on you"; every other state is ink, green or red at
  low saturation, so the eye finds the gate first. Fonts are the system's: the Tool runs offline.
- React Flow for the map: already a dependency of the Editor; nothing else added. A fixed layout,
  not an automatic one: eight phases in a known order need no graph layout library.
- Polling every 3 s: loopback, request-response, and a drain changes a run within seconds.
- The UI answers the gate, superseding decision 350; reject needs a finding; a non-verdict form is
  answered with `persimmon complete`; only this project directory's parked TaskRuns are offered
  and answered, while the map shows every run on the Store.
  Kept from the Inbox (decisions 487–493, 499).
