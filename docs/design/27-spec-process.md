# Spec process

status: draft · layer: 2 (`23-pack-ai-native.md`, `26-domain-discovery.md`) · schema: the `Spec` kind in `packs/ai-native/global/10-artifact-kinds.yaml`

From a Prd capability to its `Spec`: an agent writes stories with EARS acceptance criteria from
the Prd, the Architecture, the DomainModel, the Glossary and the rules of the capability's
context; a Validator checks that every name, rule and scenario the Spec uses exists upstream and
that every rule the capability lists is tested; the loop feeds findings back once. Pack content
plus one shipped evaluator Adapter.

```text
Workflow spec-all: repeat over `capabilities` ─▶ ReviewLoop spec-one per CAP-n
  produce: Task write-spec (spec-agent) ─▶ Spec
  review:  Gate spec-gate = Validator spec-consistency (sdd/v1: spec, prd, domainModel, architecture, rules)
  previous and feedback fed back; maxRounds 2
```

## Process

| Member | Content |
|---|---|
| Prompt `spec-rules` | how a Spec is written: cite, never restate; EARS patterns with their keywords; one test per criterion; an unknown is a `Q-n` |
| Executor `spec-agent` | `claude-code/v1`, read-only, the same configuration as `storming-agent` under its own name, so a Namespace overrides the model per Task |
| Task `write-spec` | inputs `prd`, `capabilityId`, `architecture`, `domainModel`, `glossary`, `rules`, `previous`, `feedback`; output `spec` |
| Validator `spec-consistency` | `sdd/v1` over `spec`, `prd`, `domainModel`, `architecture`, `rules`; the rule row of `23-pack-ai-native.md` as findings |
| Gate `spec-gate` | consistency only; a human sign-off is an Approval the project adds |
| ReviewLoop `spec-one` | `produce` `write-spec`, `review` `spec-gate`, `maxRounds: 2`; the findings go back as `feedback` with the last `spec` as `previous` |
| Workflow `spec-all` | `repeat` over `capabilities` as `derive-all` repeats over contexts; one DomainModel, Glossary and rules artifact, so one context per run; a capability the loop could not write ends the run `spec_inconsistent`; output `written` |

## `checkSpec`

`adapters/sdd/check.mjs`, pure, `checkSpec({spec, prd, domainModel, architecture, rules})`
returning findings, every one `error`:

| Code | Finding |
|---|---|
| `not-a-spec` | content without `stories` or `capability`; the only finding then |
| `unknown-capability` | `capability` is no `CAP-n` of the Prd |
| `unknown-actor` | a story's `actor` is no Prd user |
| `unknown-command`, `unknown-event`, `unknown-read-model` | a name the DomainModel lacks (commands: aggregates' and external systems' `handles` and `issues`; events: `events[]`, read models' `updatedBy`, external systems' `emits`, so another context's event counts once the model names it) |
| `unknown-scenario` | a `qualities[].scenario` the Architecture lacks |
| `unknown-rule`, `inactive-rule` | an acceptance criterion's `BR-n` missing or not `active` |
| `rule-untested` | a `BR-n` the Prd capability lists that no criterion cites |
| `pattern-mismatch` | a statement not opening with its pattern's keyword (the first word, punctuation ignored); `complex` opens with `While`, `When` or `If` and holds two of those words before `shall` |
| `id-sequence` | `US-n`, `AC-n`, `Q-n` not sequential from 1 in document order |

## Rules

| Rule | Enforcer |
|---|---|
| a Spec cites and never restates: a name the DomainModel lacks is a finding, fixed upstream, never invented in the Spec | `spec-consistency` |
| the Spec's `prd`, `architecture`, `domainModel` artifact ids are not checked against the inputs: the evaluator payload carries content and provenance, no RevisionRef (`19-adapter-roles.md`); provenance pins what was read | convention; Validator later |
| `domainModel.context` is not compared with the capability's `context`: a derived DomainModel names the storming context id, the Prd the BoundedContext artifact id, and the author cannot change an input; the check lands with producer-chosen artifact ids (`91-roadmap.md`) | deferred |
| `spec-all` runs over one context: its `domainModel`, `glossary` and `rules` are one artifact each; a Prd spanning contexts runs it once per context with that context's capability ids | convention |
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
- `want` is written in the infinitive ("submit the claim"), not the third person: the Prompt says so
  after the live run wrote "views the export status". Found in UAT.

## Examples

- `docs/design/examples/ai-native-domain.yaml`: the `Spec` of `CAP-1` passes `checkSpec` against
  the Prd, DomainModel, Architecture and BusinessRules beside it (`test/adapters/sdd.test.ts`).
