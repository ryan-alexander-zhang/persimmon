# Spec process

status: draft · layer: 2 (`23-pack-sdlc.md`, `26-domain-discovery.md`) · schema: the `Spec` kind in `packs/sdlc/global/10-artifact-kinds.yaml`

From a Prd capability to its `Spec`: an agent writes stories, requirements and acceptance scenarios
from the Prd, the Architecture, the DomainModel, the Glossary and the rules of the capability's
context; a Validator checks that every name, rule and quality scenario the Spec uses exists upstream, that
every requirement is covered by a story and that every rule governing the capability is enforced;
the loop feeds findings back once. Pack content
plus one shipped evaluator Adapter.

```text
Workflow spec-all: repeat over `capabilities` ─▶ ReviewLoop spec-one per CAP-n
  produce: Task write-spec (spec-agent) ─▶ Spec
  review:  Gate spec-gate = Validator spec-consistency (sdd/v1: spec, prd, domainModel, architecture, rules, context),
           then spec-audited (Task audit-spec, Executor auditor, after consistency passed)
  previous and feedback fed back; maxRounds 2
```

## Process

| Member | Content |
|---|---|
| Prompt `spec-rules` | how a Spec is written: cite, never restate; Connextra stories covering EARS requirements enforcing rules; Given/When/Then scenarios with values; an unknown is a `Q-n` |
| Executor `spec-agent` | `claude-code/v1`, read-only, the same configuration as `storming-agent` under its own name, so a Namespace overrides the model per Task |
| Task `write-spec` | inputs `prd`, `capabilityId`, `architecture`, `context` (the BoundedContext, `34-subdomains.md`), `domainModel`, `glossary`, `rules`, `previous`, `feedback`, `base?` (the Spec this run revises), `changes?` (the downstream answers it applies, each `<artifact id> Q-n: <resolution>`); output `spec` |
| Validator `spec-consistency` | `sdd/v1` over `spec`, `prd`, `domainModel`, `architecture`, `rules`, and optionally `context`, `base` and the value `capabilityId`; the rule row of `23-pack-sdlc.md` as findings, `rules-mismatch` when the Spec's `businessRules` is not the artifact bound |
| Prompt `draft-audit-rules`, part "A Spec" | what the auditor judges that `spec-consistency` cannot (`23-pack-sdlc.md`): `ac-undecidable`, `ac-contradicts-rule`, `requirement-unproven`, `boundary-untested`, `value-missing` and `scenario-unreachable` errors; a `scope-doubt` warning |
| Task `audit-spec` | inputs `spec`, `prd`, `rules`, `domainModel`, `architecture`, and from round two `previous` and `feedback` (`spec-one`'s `review` binds them; `23-pack-sdlc.md`); Executor `auditor`; output `audit`, a ValidationResult whose schema ties `passed` to "no `error` finding"; 30m, three attempts |
| Validator `spec-audited` | `task` over `audit-spec`, `resultOutput: audit` |
| Gate `spec-gate` | consistency, then `audit` `after: [consistency]`, `all`, 35m; a human sign-off is an Approval the project adds |
| ReviewLoop `spec-one` | `produce` `write-spec`, `review` `spec-gate` (35m), `maxRounds: 2`, 140m; the findings go back as `feedback` with the last `spec` as `previous`; `base` and `changes` passed to `write-spec`, both or neither, and `base` to `spec-gate` |
| Workflow `spec-all` | `repeat` over `capabilities` as `derive-all` repeats over contexts; one BoundedContext, DomainModel, Glossary and rules artifact, so one context per run; a capability the loop could not write ends the run `spec_inconsistent`, an iteration that died before its Gate ran `step_failed`; output `written` |

## `checkSpec`

`adapters/sdd/check.mjs`, pure, `checkSpec({spec, prd, domainModel, architecture, rules, context, ids})`, `ids` holding
the rules', the context's and the capability's ids from the inputs,
returning findings, every one `error`:

| Code | Finding |
|---|---|
| `not-a-spec` | content without `stories`, `requirements` or `capability`; the only finding then |
| `capability-mismatch` | `capability` is not the `capabilityId` the Spec was written for |
| `unknown-capability` | `capability` is no `CAP-n` of the Prd |
| `context-mismatch` | the capability is not one the bound BoundedContext lists, or `domainModel.context` is not that context (`34-subdomains.md`; the Prd names no context) |
| `unknown-role` | a story's `role` is no Prd user |
| `unknown-command`, `unknown-event`, `unknown-read-model` | a name the DomainModel lacks (commands: aggregates' and external systems' `handles` and `issues`; events: `events[]`, read models' `updatedBy`, external systems' `emits`, so another context's event counts once the model names it) |
| `unknown-requirement` | a story covers an `FR-n` the Spec lacks |
| `requirement-uncovered` | an `FR-n` no story covers |
| `unknown-scenario` | a `qualities[].scenario` the Architecture lacks |
| `unknown-rule`, `inactive-rule` | a requirement's `BR-n` missing or not `active` |
| `rule-unenforced` | a `BR-n` the Prd capability lists that no requirement enforces |
| `pattern-mismatch` | a requirement not opening with its pattern's keyword (the first word, punctuation ignored); `complex` opens with `While`, `When` or `If` and holds two of those words before `shall` |
| `id-sequence` | `FR-n`, `US-n`, `AC-n`, `Q-n` not unique and increasing in document order (a gap is a removed item) |

A story with no scenario, a scenario with an empty `given`, `when` or `then`, a story covering
nothing: the schema refuses those (`minItems: 1`).

## Rules

| Rule | Enforcer |
|---|---|
| a Spec cites and never restates: a name the DomainModel lacks is a finding, fixed upstream, never invented in the Spec | `spec-consistency` |
| a scenario's values ("25 EUR") are example data of the revision the Spec read, never the rule's authority; provenance pins the BusinessRules revision, and `persimmon get Spec --behind` lists the Specs whose pinned revision is behind (`08-store.md`), a query, not a field | convention; `get --behind` |
| the Spec's `prd`, `architecture`, `domainModel` artifact ids are not checked against the inputs: the evaluator payload carries content and provenance, no RevisionRef (`19-adapter-roles.md`); provenance pins what was read | convention; Validator later |
| the capability lives in the bound BoundedContext and the DomainModel is that context's (`context-mismatch`, `34-subdomains.md`) | `spec-consistency` |
| `spec-all` runs over one context: its `context`, `domainModel`, `glossary` and `rules` are one artifact each, and its capability ids are ones the `context` lists; a product over several contexts runs it once per context | convention; `context-mismatch` per Spec |
| a revision with `base` bound starts from it, keeps every id and changes only what `changes` asks; a new scenario takes the next id | `spec-rules`; `checkSpec` `id-reused` |
| `spec-gate` has no human, only the auditor: a project that wants sign-off wraps `spec-one` in an Approval, as example06 does for its Prd ReviewLoop | convention |
| the Glossary bound is the context's: a convention, since `spec-gate` binds no Glossary; a wrong one shows as field findings in the Designs | convention |

## Decisions

- The consistency check is a shipped Adapter `sdd/v1`, not a mode of `eventstorming/v1`: the rules
  are over the pack's kinds, not the storming grammar, and later kinds (Design, Plan) add checks to
  the same Adapter. Found in design review.
- Rules live in the Adapter, not in `src/`: the engine knows no pack kind (`20-pack.md`); a pack
  that ships a Validator ships its evaluator beside it. Found in design review.
- `spec-all` takes the capability ids as an input instead of reading the Prd: a Workflow input is a
  value or an artifact, never a field of one; the caller lists the capabilities it wants, which is
  also how one context of a multi-context Prd is chosen. Found in design review.

- Proven live on `claude-sonnet-5`: `spec-all` over `CAP-1` and `CAP-4` of the worked example, two
  minutes, both Specs passed `spec-consistency` in round one. Model quality: one story per command,
  every rule the capability lists cited, qualities thin (`QS-1` only for CAP-1, none for CAP-4), and
  the CAP-4 Spec asked a real question: `Export Status View` is updated by `Claim Paid`, an event
  `events[]` never lists. It is the Accounting context's event, reaching this model through an
  `updates` edge; the kind now says `updatedBy` may name another context's event and `checkSpec`
  accepts it as a story event. The question was the process working as designed. Found in UAT.
- `goal` is written in the infinitive ("submit the claim"), not the third person: the Prompt says so
  after the live run wrote "views the export status". Found in UAT.

- The three forms (Connextra, EARS, Given/When/Then) replaced one: the first live run wrote EARS
  criteria under stories, and the user's review showed the standard split: a requirement is the
  system's behaviour in general form, a scenario is one concrete case of it, a story is why someone
  needs it. `23-pack-sdlc.md` records the shape. Repeated live under it on `claude-sonnet-5`,
  `CAP-1` and `CAP-4`, 3m21s, both passed round one: scenarios carry values and boundaries (a 24.99
  EUR line under BR-2's 25 EUR, a justified over-limit line with a director), requirements are one
  EARS sentence each with the rule id in the sentence, and the open questions are real gaps (no
  command adds a line to a drafted claim; the per-category policy limits are a fact type with no
  values published). Two Prompt lines followed: `benefit` without a leading "so that", and a read
  model's `updatedBy` may name another context's event, so the agent stops asking about `Claim
  Paid`. A `delta` that restates a scenario's scope instead of tightening it is not decidable by the
  Validator; it stays with the author. Found in UAT.
- `spec-rules` says a refusal is its own outcome, naming the `BR-n`, never a domain event and never
  the empty answer of a search; `storming-design` says a refused command produces no event. The
  live Spec of a booking capability answered five rule violations with the model's one unhappy
  event, "no available room found", because nothing had said the two differ and the model had no
  other shape to reach for. Found in UAT.

- The auditor live (`claude-sonnet-5`, 2m03s a call): over the worked example's Spec with `AC-1` made vague it
  refused `ac-undecidable` `AC-1` and found two gaps the example always had, `requirement-unproven`
  `FR-1` (no scenario records a line) and `boundary-untested` `BR-2` (no scenario at 25 EUR); the
  same Spec with an `FR-1` scenario passed, two warnings riding. Round two could not add that scenario
  to `US-1`: ids increase in document order and a revision never renumbers, so a new scenario goes
  under the last story only, and `id-sequence` refused it. So `AC-n` increases within its story and is
  unique across the Spec: a revision's new scenario takes the next number under the story it
  belongs to. Only `AC-n` nests across a list another id orders; `T-n` keeps document order as
  build order. With `AC-8` and `AC-9` added the auditor refused `FR-5` (no scenario puts a receipt in
  play during a refusal), which an earlier run over the same `FR-5` had passed: its recall varies
  run to run, so a passing audit is not a proof of no gap. With `AC-5` holding a receipt it passed,
  two warnings riding. Found in UAT.

## Examples

- `docs/design/examples/sdlc-domain.yaml`: the `Spec` of `CAP-1`: three stories, six
  requirements, nine scenarios; passes `checkSpec` against the Prd, DomainModel, Architecture and
  BusinessRules beside it (`test/adapters/sdd.test.ts`).
- A downstream answer that adds to a Spec reaches it through `spec-one` with `base` and `changes`,
  not by a rewrite downstream: the revision is the Spec's own, under its own Gate. Before, a run
  wrote the Spec from scratch, and nothing carried the answer it was run for: in the live
  Autopilot run the TestDesign found BR-4's accepted side with no scenario, and only a fresh Spec
  that happened to add one could close it. `base` keeps the ids the Plan and the TestDesign cite.
  A loop input named `feedback` was compared: the loop reserves it for its rounds. Found in UAT.
- `base` is checked, not only asked for: `checkSpec` refuses `id-reused`, a `US-n`, `FR-n` or
  `AC-n` not in `base` whose number is at or below `base`'s highest of its kind, and a `base`
  `AC-n` now under another story. The Plan cites stories and the TestDesign scenarios by id, so a
  reused id moves their citations onto other behaviour unseen. By id position, not by text: a
  revision may rightly reword a scenario, and comparing words would refuse it. An error, not a
  warning as `task-renumbered` is: a Spec has no build order that a renumbering could serve.
  Found in UAT.
- A Spec's gaps are refused at its own Gate, not found by the TestDesign. In the full-Plan UAT the
  TestDesign raised the Spec's gaps over eight revisions, each one a round and a Spec revision: a
  threshold with no scenario beside it, a policy limit no scenario or rule gave, a per diem line
  only a command of no story creates. `boundary-untested` becomes an error, and two codes join it:
  `value-missing`, an outcome turning on a value neither the scenario, the Spec nor the rules give;
  `scenario-unreachable`, a Given no command of the Spec's own stories produces and no test can
  set directly. Its own stories, not the whole DomainModel: another capability may be built later,
  and a test of this one cannot wait for it; measured against the UAT's Spec, the auditor judged a
  per diem line only another capability's Add Trip creates reachable, a warning, until the rule
  said so. A Design operation for every command is the coverage Gate's, so no later Gate needs
  the Spec beside the Designs.
  `spec-rules` asks for the same three, so the writer meets them before the auditor does. Found in
  UAT.
