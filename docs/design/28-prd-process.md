# Prd process

status: draft · layer: 2 (`23-pack-ai-native.md`, `27-spec-process.md`) · schema: the `Prd` and `BusinessRules` kinds in `packs/ai-native/global/10-artifact-kinds.yaml`

From a brief to a `Prd`: an agent writes the problem, users, goals, capabilities and success criteria
from a brief and the context's rules and glossary when they exist, writing every rule a capability
must honour into `BusinessRules` and citing it by `BR-n`; a Validator checks the citations and the
ids; a human confirms the Prd at the terminal; the loop feeds findings back up to three rounds.
Pack content plus a second mode of the `sdd/v1` Adapter.

```text
ReviewLoop author-prd
  produce: Task draft-prd (prd-agent) ─▶ Prd, BusinessRules
  review:  Gate prd-gate = Validator prd-consistency (sdd/v1: prd, rules) + prd-confirmed (confirm-prd, human)
  previous (the Prd) and feedback fed back; maxRounds 3
```

## Where the agent learns how to write a Prd

A "template" is three things, each in its place: the kind's schema (the form: fields, what is
required, a `description` on every field the runner prints under `## Answer`), a Prompt (the method:
how each field is written and judged), and the Task's `instructions` (what to do with which inputs).
spec-kit's `spec-template.md` holds the first two in one Markdown file that nothing checks; here the
form is refused by the engine when wrong and the method is a Prompt a Namespace can override.

## Process

| Member | Content |
|---|---|
| Prompt `prd-rules` | problem before solution; users as roles; goals are direction and success criteria carry the number, measured in production; a capability is one Spec's worth with its context and the rules that govern it; a rule is written into `BusinessRules`, never into the Prd; what is refused is a non-goal; an unknown is a `Q-n` |
| Executor `prd-agent` | `claude-code/v1`, read-only, its own name so a Namespace picks the model per Task |
| Task `draft-prd` | inputs `brief` (text), `contextId` (the BoundedContext the capabilities live in), `rules` and `glossary` (optional, the context's current ones), `previous` (the last Prd), `feedback`; outputs `prd` and `rules` (the context's BusinessRules, revised or new) |
| Task `confirm-prd` | human on `cli-human/v1`: reads the Prd and the rules at the terminal, approves or rejects with one finding per id |
| Validators | `prd-consistency`: `sdd/v1` over `prd` and `rules`; `prd-confirmed`: over `confirm-prd` |
| Gate `prd-gate` | both, `all` |
| ReviewLoop `author-prd` | `produce` `draft-prd`, `review` `prd-gate`, `maxRounds: 3`; the subject is the Prd |

## `checkPrd`

`adapters/sdd/check.mjs`, pure, `checkPrd({prd, rules})`, every finding `error`:

| Code | Finding |
|---|---|
| `not-a-prd` | content without `capabilities` or `title`; the only finding then |
| `unknown-rule`, `inactive-rule` | a `capabilities[].rules[]` id the BusinessRules lack or hold as not `active` |
| `context-mismatch` | a `capabilities[].context` that is not the BusinessRules' `context` |
| `unknown-capability` | a `successCriteria[].capabilities[]` id that is no capability |
| `goal-with-number` | a goal statement containing a digit; the number belongs to a success criterion |
| `id-sequence` | `G-n`, `CAP-n`, `SC-n`, `Q-n` not sequential from 1 in document order |

The Adapter picks the mode from the payload: `artifacts.spec` (or `artifacts.model`, the
conformance suite's name) runs `checkSpec`; otherwise `artifacts.prd` runs `checkPrd`.

## Rules

| Rule | Enforcer |
|---|---|
| a Prd process runs over one context: `rules` is one artifact and every capability's `context` is its; a product spanning contexts runs it once per context and the Prds are merged by hand until a Prd may cite several rules artifacts | convention |
| the Task writes the whole `BusinessRules` artifact each round from the input rules and its previous Prd: a ReviewLoop carries one subject back as `previous`, so the rules of the last round are not an input; `prd-consistency` refuses a Prd citing a rule the produced artifact lacks | `prd-consistency`; `21-composition.md` |
| a new rule carries `status: active`, `source` naming the brief, and `logic` only when the brief states the condition; a rule the brief implies but does not state is a `Q-n`, not a rule | `prd-rules` |
| the human gate is the Prd's reviewer: `prd-consistency` decides form and citations, the human decides scope, goals and whether the capabilities are the right cut | `prd-gate` |

## Decisions

- The agent writes rules into `BusinessRules` while writing the Prd, and the Prd cites them: the rules
  surface when the Prd does ("over the limit needs a director"), the Prd must name what governs each
  capability (`23-pack-ai-native.md`), and the rule text has one home. The Task has two outputs for
  that reason. Found in design review.
- A human gate from the first round, unlike the Spec: a Prd is where scope, users and goals are
  decided, and no Validator decides those. The storming phases have the same gate for the same
  reason. Found in design review.
- The Task is `draft-prd`, not `write-prd`: the demo SDLC pack `persimmon init` installs owns a Global
  `write-prd`, and a Global name is one per project. Found in implementation.
- `brief` is text, not a kind: the input to a Prd is a conversation, a document, a ticket; a kind for
  it would be a Prd with fewer fields. The brief is recorded in the TaskRun's inputs. Found in design
  review.
- `goal-with-number` is decidable and cheap: a digit in a goal is the one rule of `23-pack-ai-native.md`
  ("goals give direction without a number") a regular expression can hold. Found in design review.

## Examples

- `docs/design/examples/ai-native-domain.yaml`: `Prd/expense-claims` passes `checkPrd` against
  `BusinessRules/expenses-rules` beside it (`test/adapters/sdd.test.ts`).
