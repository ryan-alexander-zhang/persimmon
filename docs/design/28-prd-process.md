# Prd process

status: draft · layer: 2 (`23-pack-sdlc.md`, `27-spec-process.md`) · schema: the `Prd` and `BusinessRules` kinds in `packs/sdlc/global/10-artifact-kinds.yaml`

From a brief to a `Prd`: an agent writes the problem, users, goals, capabilities and success criteria
from a brief and the context's rules and glossary when they exist, writing every rule a capability
must honour into `BusinessRules` and citing it by `BR-n`; a Validator checks the citations and the
ids; a human confirms the Prd at the terminal; the loop feeds findings back up to three rounds.
Pack content plus a second mode of the `sdd/v1` Adapter.

```text
ReviewLoop author-prd
  produce: Task draft-prd (prd-agent) ─▶ Prd, BusinessRules
  review:  Gate prd-gate = Validator prd-consistency (sdd/v1: prd, rules), then prd-audited (audit-prd, auditor, after consistency passed),
           then prd-confirmed (confirm-prd, human, after both passed)
  previous (the Prd) and feedback fed back; maxRounds 3
```

## Where the agent learns how to write a Prd

A "template" is three things, each in its place: the kind's schema (the form: fields, what is
required, the schema with its `description`s, which the runner prints under `## Answer`), a Prompt (the method:
how each field is written and judged), and the Task's `instructions` (what to do with which inputs).
spec-kit's `spec-template.md` holds the first two in one Markdown file that nothing checks; here the
form is refused by the engine when wrong and the method is a Prompt a Namespace can override.

## Process

| Member | Content |
|---|---|
| Prompt `prd-rules` | problem before solution; users as roles; goals are direction and success criteria carry the number, measured in production; the Prd names the brief's subdomains, typed core, supporting or generic (`34-subdomains.md`); a capability is one Spec's worth with its subdomain and the rules that govern it; a rule is written into `BusinessRules`, never into the Prd; what is refused is a non-goal; an unknown is a `Q-n`, and a `Q-n` answered with a policy also becomes a `BR-n` sourced from that answer |
| Executor `prd-agent` | `claude-code/v1`, read-only, its own name so a Namespace picks the model per Task |
| Task `draft-prd` | inputs `brief` (text), `productId` (the id stem), `rules` and `glossary` (optional, the product's current ones), `previous` (the last Prd), `previousRules` (the last round's rules, carried by the loop), `feedback`; outputs `prd` (with the `subdomains` the brief describes) and `rules` (the product's BusinessRules: the input artifact's rules carried forward plus the brief's) |
| Task `confirm-prd` | human on `cli-human/v1`: reads the Prd and the rules at the terminal, approves or rejects with one finding per id |
| Validators | `prd-consistency`: `sdd/v1` over `prd` and `rules` (`rules-mismatch` when the Prd's `businessRules` is not the artifact bound), and from round two `previousRules` and `feedback` (`rule-drift`: a rule dropped, or changed in statement or status, that no finding of the last verdict names); `prd-audited`: `task` over `audit-prd` (inputs `prd`, `rules`; Executor `auditor`; the Prompt `draft-audit-rules`, part "A Prd": `rule-conflict` and `rule-misplaced` errors, `capability-overlap` and `vague-term` warnings; `23-pack-sdlc.md`); `prd-confirmed`: over `confirm-prd`, whose form shows the auditor's verdict as `audit` (`fromValidator: audit`) |
| Gate `prd-gate` | all three, `all`; `audit` `after: [consistency]`, `confirmed` `after: [consistency, audit]`, so the human confirms only a draft the check and the auditor passed (`14-gate.md`) |
| ReviewLoop `author-prd` | `produce` `draft-prd`, `review` `prd-gate`, `maxRounds: 3`; the subject is the Prd; `carry: {rules: previousRules}`, and the review reads `previousRules` and `feedback` (`21-composition.md`) |

## `checkPrd`

`adapters/sdd/check.mjs`, pure, `checkPrd({prd, rules, previousRules, feedback})` (the last two from round two of `author-prd`), every finding `error`:

| Code | Finding |
|---|---|
| `not-a-prd` | content without `capabilities` or `title`; the only finding then |
| `unknown-rule`, `inactive-rule` | a `capabilities[].rules[]` id the BusinessRules lack or hold as not `active` |
| `subdomain-mismatch` | a capability's or a rule's `subdomain` not among the Prd's `subdomains`; a cited rule tagged with another subdomain; an untagged rule when the Prd has more than one subdomain; a subdomain id named twice (`34-subdomains.md`) |
| `unknown-capability` | a `successCriteria[].capabilities[]` id that is no capability |
| `goal-with-number` | a goal statement containing a digit; the number belongs to a success criterion |
| `id-sequence` | `G-n`, `CAP-n`, `SC-n`, `Q-n` of the Prd and `BR-n` of the rules not unique and increasing in document order (a gap is a removed item) |
| `rule-drift` | with `previousRules`: a `BR-n` of them dropped, or changed in `statement` or `status`, whose id no finding of `feedback` names (`results.<validator>.findings[].message`, the gate's own `rule-drift` findings excluded, so a refusal never licenses what it refused) |

The Adapter picks the mode from the payload: `artifacts.spec` (or `artifacts.model`, the
conformance suite's name) runs `checkSpec`; otherwise `artifacts.prd` runs `checkPrd`.

## Rules

| Rule | Enforcer |
|---|---|
| a Prd process runs over one product: the Prd names its subdomains, every capability's `subdomain` is one of them, and with several every rule is tagged with the subdomain whose policy it is; no context is named (`34-subdomains.md`) | `prd-consistency` (`subdomain-mismatch`) |
| the `rules` output is `<productId>-rules` and the Prd `<productId>-prd` (`outputs.<port>.id`, `12-task.md`): a second run with the same `productId` publishes their next revisions, so the rules a Prd run writes are revision n+1 of the context's rules when the input was named the same way | `draft-prd` outputs |
| `author-prd` writes the first Prd of a product: the agent names the subdomains from the brief and the human confirms them at `prd-gate`; the storming cuts the bounded contexts later (`34-subdomains.md`); `productId` stems the Prd's and the rules' ids | convention |
| the Task writes the whole `BusinessRules` artifact each round, from `previousRules` when the loop carries them and from the input `rules` in round one; a `BR-n` keeps its id, statement and status unless a finding of the last verdict names it, a new policy takes the next number; `prd-consistency` refuses a Prd citing a rule the produced artifact lacks, and `rule-drift` a rule changed or dropped unasked | `prd-consistency`; `21-composition.md` |
| a new rule carries `status: active`, `source` naming the brief, or the `Q-n` whose answer is a policy, and `logic` only when the brief states the condition; a rule the brief implies but does not state is a `Q-n`, not a rule, until a human answers it with a policy: then also a rule, one per subdomain it governs, unless an existing `BR-n` already says it | `prd-rules`; `confirm-prd` names the `BR-n` beside a `Q-n` it changes again |
| the human gate is the Prd's reviewer: `prd-consistency` decides form and citations, the human decides scope, goals and whether the capabilities are the right cut | `prd-gate` |

## Decisions

- The agent writes rules into `BusinessRules` while writing the Prd, and the Prd cites them: the rules
  surface when the Prd does ("over the limit needs a director"), the Prd must name what governs each
  capability (`23-pack-sdlc.md`), and the rule text has one home. The Task has two outputs for
  that reason. Found in design review.
- A human gate from the first round, unlike the Spec: a Prd is where scope, users and goals are
  decided, and no Validator decides those. The storming phases have the same gate for the same
  reason. Found in design review.
- The Task is `draft-prd`, not `write-prd`: the demo pack, which `persimmon init` installed then, owns a Global
  `write-prd`, and a Global name is one per project. Found in implementation.
- `brief` is text, not a kind: the input to a Prd is a conversation, a document, a ticket; a kind for
  it would be a Prd with fewer fields. The brief is recorded in the TaskRun's inputs. Found in design
  review.
- `goal-with-number` is decidable and cheap: a digit in a goal is the one rule of `23-pack-sdlc.md`
  ("goals give direction without a number") a regular expression can hold. Found in design review.

- Proven live on `claude-sonnet-5` from a one-paragraph brief, no rules or Glossary bound: one round,
  1m14s to the human gate, `prd-consistency` passed, approved from the terminal with the completion
  file. The Prd had five goals without a number, five capabilities each citing its rules, five
  success criteria with the brief's numbers, four real open questions (per diem evidence, the
  category limits, the director who is also the approver, when retention starts). The rules
  artifact held the brief's four policies plus retention as `BR-1` to `BR-5`, RuleSpeak statements,
  but its `logic.inputs[].factType` named invented fact types (`ClaimLine`) since no Glossary
  existed; the Prompt now forbids `logic` without a Glossary. Two Layer 1 findings on the way: a
  plain-text `--input brief=@file` was parsed as YAML and a colon broke it (`08-store.md`, fixed:
  a string port takes the text as is), and an optional loop input unbound on a run failed `source absent`
  (`21-composition.md`, fixed). Found in UAT.
- The `draft-prd` instructions say the answered rules start as a verbatim copy of the given ones:
  on `claude-sonnet-5` a round two that was told to "fix what the findings name and change nothing
  else" rewrote the BusinessRules whole and renumbered `BR-1` to `BR-10`, the Prd's citations
  surviving only because `CAP-1` cited them as a block. `prd-rules` already said a revision keeps
  every id in place; the Task now says it where the model reads last. A Validator check against
  the previous rules needs the ReviewLoop's `review` to see `previous`, which it did not then.
  Found in UAT.
- The loop carries the rules (`carry: {rules: previousRules}`, `21-composition.md`) and the gate
  reads them with the last verdict: `rule-drift` refuses a `BR-n` dropped or changed in statement
  or status that no finding names, matched by id in the findings' text; the gate's own `rule-drift`
  findings are left out, else round n+1 would keep the drift round n refused. Statement and status only:
  rationale and source may be polished unasked, and a finding naming the rule frees every field.
  Round one has no previous rules and no verdict, so nothing is checked. Found in UAT (example08).
- Proven live on `claude-sonnet-5`: `author-prd` over the car pool brief with the product's rules
  bound, three rounds. Round two, told to deprecate a rule that was already deprecated, republished
  the rules byte-identical; round three, told to reword `BR-8`, changed that one statement line and
  nothing else across twenty rules; `prd-consistency` passed both with `previousRules` and the
  verdict bound. Found in UAT (example08).
- A question answered with a policy becomes a rule as well as a resolution: in the live example08
  run the human answered "a request not approved by the start lapses and the employee is notified";
  it stayed a resolution, the storming modelled the lapse, and no `BR-n` existed for a Spec
  requirement to enforce, so `rule-unenforced` had nothing to hold a Spec to. Which answer is a policy stays the
  agent's call and the human's at `prd-gate`; no check tells a policy from a fact. Found in UAT.

## Examples

- `docs/design/examples/sdlc-domain.yaml`: `Prd/expense-claims` passes `checkPrd` against
  `BusinessRules/expenses-rules` beside it (`test/adapters/sdd.test.ts`).
