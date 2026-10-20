# Inbox: answer a human gate in `persimmon ui`

status: draft · layer: cross-cutting (`25-ui.md`, `20-pack.md` `cli-human/v1`, `14-gate.md`) · schema: none

The second Tool. Every TaskRun parked on a human appears in one list. The human reads its Reading
rendered as a page, notes findings on the items it names, and approves or rejects. That is the
same answer `persimmon complete` gives, without leaving the browser and without stopping `persimmon ui`
for the project lock.

```text
persimmon run … --follow ──▶ parked on you: persimmon complete <taskRun>   (or open persimmon ui)
persimmon ui ──▶ / ──▶ /tools/inbox/
  GET  /api/inbox                       TaskRuns Waiting on a human, every Namespace
  GET  /api/inbox/<ns>/<taskRun>        the cli-human/v1 form: instructions, reading[], inputs, outputs
  GET  /api/kinds/<kindName>            the kind's content schema: field descriptions for the page
  POST /api/inbox/<ns>/<taskRun>        {outputs} ──▶ the complete path ──▶ Signal ──▶ drain in this process
browser: list ──▶ page per Reading entry ──▶ hover an item ──▶ click ──▶ finding inline ──▶ Approve | Reject
```

## Page

| Part | Behaviour |
|---|---|
| list | the parked TaskRuns, newest first: Task name, Namespace, deadline; refreshed every 5 s, so the next gate a drain parks appears without a reload |
| header | the Task's `instructions`, then each value input as a callout (`audit` on `confirm-prd`: the auditor's warnings, read before the human) |
| reading | one section per `reading[]` entry, in order, titled `<Kind> <id> r<n>`; a Prompt as text; an entry with `error` shows the error |
| render | any kind, generically, from the content and the kind schema: an object is a section of labelled fields, the label the property name in words with its schema `description` on hover; an array of objects is a list of cards, one per element, titled by its `id` when it has one; an array of scalars is a bullet list; a string keeps its line breaks |
| EventStorming | the same page, plus a link to the Editor at the revision read (`/tools/eventstorming/?ns=&id=&rev=`) for the board |

## Verdict

Shown when every output of the Task is a ValidationResult value port, as on the four `confirm-*`
Tasks of the SDLC pack. Any other form shows the Reading and says to answer with `persimmon complete`.

| Action | Behaviour |
|---|---|
| hover | the innermost item under the pointer is outlined and shows a comment button: a card, a field, a list entry |
| click | a text box opens under the item; Enter keeps the finding, Escape drops it; a kept finding shows as a chip on the item and in the findings tray, removable |
| anchor | the finding's message starts with the item's `id` (`CAP-2: …`, `BR-4: …`), else with the artifact id and the item's JSON Pointer (`claims-prd /goals/1: …`): the `confirm-*` instructions ask for the id in the message, and ValidationResult has no path field |
| general | one finding box for what no item holds |
| approve | one click; the findings go with it as notes, `severity: info`, `code: note_<n>` |
| reject | enabled with one finding or more, so a ReviewLoop round always has something to fix; findings `severity: error`, `code: blocking_<n>` |
| answer | `{passed, findings, evidence}`, evidence the RevisionRefs of the Reading entries shown, as `askVerdict` builds it at the terminal; checked against the port schema; `POST` it |
| after | the page says the run continues; the TaskRun leaves the list on the next refresh; a 409 says it was answered elsewhere |

## API

Added to `src/server/api.ts` (`25-ui.md`), under the same Host and content-type checks.

| Route | Answer |
|---|---|
| `GET /api/inbox` | `[{namespace, taskRun, task, deadline, form: boolean, verdict: boolean}]`: every TaskRun with `phase: Waiting`, `waitingReason: human`; `form` whether its inbox file exists, `verdict` whether every output is a ValidationResult value port |
| `GET /api/inbox/<ns>/<taskRun>` | the parsed form; 404 when the TaskRun is not parked or has no form |
| `GET /api/kinds/<kindName>` | `{name, apiVersion, kind, schema}`, the kind's content schema; 404 for an unknown or unrevisioned kind |
| `POST /api/inbox/<ns>/<taskRun>` `{outputs}` | `fromFile` with the form, then the signal `complete` sends, the form removed, one drain after the response; 200; 400 with the schema message; 404 unknown; 409 when the TaskRun is no longer waiting on a human |

## Rules

| Rule | Enforcer |
|---|---|
| one completion path: the UI and `persimmon complete` share `fromFile`, the Waiting check, the signal and the form removal | `src/server` imports `cli/signal` |
| agent content is rendered as text by React, never as HTML; a representation stays on its sandboxed route (`25-ui.md`) | `tools/inbox` renders `spec.content` only |
| the content-to-page tree and the finding builder are pure and tested without a DOM | `tools/inbox/src/lib/*.test.ts` |
| the inbox directory is the CLI's, `.persimmon/inbox` under the project | `persimmon ui` passes it to `serve` |

## Decisions

- One generic page for every human gate, not a Prd page: the four `confirm-*` Tasks share one
  executor and one form, and a kind added later renders on day one. A per-kind layout comes when the
  generic one reads badly for a kind. Found in UAT.
- The UI answers the gate. This supersedes the decision that the terminal takes the verdict and
  that a `review-ui` Adapter waits for server mode (`26-domain-discovery.md`): `persimmon ui` holds the
  project lock, so a review in the browser meant stopping it to run `complete`. The executor stays
  `cli-human/v1`; only who signals changes. Found in UAT.
- Findings anchor in the message, not a new field: the `confirm-*` instructions already ask for the
  id in the message and the ReviewLoop feeds messages back; a `path` on the Finding is a schema
  change no consumer reads.
- Reject needs a finding in the UI, while the terminal still takes an empty list: a ReviewLoop
  round with no finding gives the agent nothing to fix. The terminal is left as it is.
- Rendered from the content shape, schema descriptions on hover: no kind-specific code and no
  agent-written HTML on the API's origin. A Markdown string, the DesignSystem's `document.content`,
  shows as plain text with its line breaks: DESIGN.md reads as text, and a Markdown renderer is a
  dependency no other page needs yet.
- A Tool of its own, `tools/inbox/`, its own Vite config beside the Editor's, no dependency added:
  React and Tailwind are already in the root `package.json`; the Editor is a canvas, the Inbox a list
  and a page. `/` redirects to the Inbox: a parked gate is what a user opens the UI for.
- Polling, not a push channel: a 5 s `GET` on loopback costs nothing, and the server stays
  request-response.
- A non-verdict form, the builder's `implement`, is read in the Inbox and answered with
  `persimmon complete`: an artifact answer is code or a document, not a click.
