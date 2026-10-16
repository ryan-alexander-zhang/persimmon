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
  review:  Gate spec-gate = Validator spec-consistency (sdd/v1: spec, prd, domainModel, architecture, rules, context)
  previous and feedback fed back; maxRounds 2
```

## Process

| Member | Content |
|---|---|
| Prompt `spec-rules` | how a Spec is written: cite, never restate; Connextra stories covering EARS requirements enforcing rules; Given/When/Then scenarios with values; an unknown is a `Q-n` |
| Executor `spec-agent` | `claude-code/v1`, read-only, the same configuration as `storming-agent` under its own name, so a Namespace overrides the model per Task |
| Task `write-spec` | inputs `prd`, `capabilityId`, `architecture`, `domainModel`, `glossary`, `rules`, `previous`, `feedback`; output `spec` |
| Validator `spec-consistency` | `sdd/v1` over `spec`, `prd`, `domainModel`, `architecture`, `rules`; the rule row of `23-pack-sdlc.md` as findings, `rules-mismatch` when the Spec's `businessRules` is not the artifact bound |
| Gate `spec-gate` | consistency only; a human sign-off is an Approval the project adds |
| ReviewLoop `spec-one` | `produce` `write-spec`, `review` `spec-gate`, `maxRounds: 2`; the findings go back as `feedback` with the last `spec` as `previous` |
| Workflow `spec-all` | `repeat` over `capabilities` as `derive-all` repeats over contexts; one DomainModel, Glossary and rules artifact, so one context per run; a capability the loop could not write ends the run `spec_inconsistent`, an iteration that died before its Gate ran `step_failed`; output `written` |

## `checkSpec`

`adapters/sdd/check.mjs`, pure, `checkSpec({spec, prd, domainModel, architecture, rules})`
returning findings, every one `error`:

| Code | Finding |
|---|---|
| `not-a-spec` | content without `stories`, `requirements` or `capability`; the only finding then |
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
| `spec-gate` has no human: a project that wants sign-off wraps `spec-one` in an Approval, as example06 does | convention |

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

## Examples

- `docs/design/examples/sdlc-domain.yaml`: the `Spec` of `CAP-1`: three stories, six
  requirements, seven scenarios; passes `checkSpec` against the Prd, DomainModel, Architecture and
  BusinessRules beside it (`test/adapters/sdd.test.ts`).
