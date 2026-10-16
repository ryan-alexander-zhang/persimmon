# Subdomains

status: draft · layer: 2 (`24-eventstorming.md`, `26-domain-discovery.md`, `27-spec-process.md`, `28-prd-process.md`, `31-architecture-process.md`, `33-multi-context-product.md`) · schema: the `Prd`, `BusinessRules`, `EventStorming` and `BoundedContext` kinds in `packs/sdlc/global/10-artifact-kinds.yaml`; the grammar at DSL 4.1

The Prd names the parts of the business; the storming cuts the bounded contexts. Today the Prd
fixes the contexts: `author-prd` takes `contextIds` "chosen by the author before domain discovery
derives them" (`28-prd-process.md`), every capability and every rule is tagged with one, and the
storming Prompt reuses those ids and may only add a context. DDD puts the two on opposite sides: a
subdomain is problem space, found in the business (Evans 2003, Part IV; Vernon 2013, ch. 2;
Khononov 2021, ch. 1); a bounded context is solution space, a model boundary designed by modelling
(Brandolini's big-picture storming, then the context map). This moves the cut to the storming and
leaves the Prd the problem space.

```text
brief ─▶ author-prd ─▶ Prd: subdomains[] (core | supporting | generic), capabilities[].subdomain
                       BusinessRules: rules[].subdomain
      ─▶ domain-discovery: the storming cuts the contexts; at design level each names the subdomain it realises
         derive-all per context ─▶ BoundedContext: subdomain, capabilities[]; Glossary; DomainModel
      ─▶ architect                     unchanged inputs; every capability in exactly one context
      ─▶ spec-all per context          + context: a Spec's capability is one its BoundedContext lists
      ─▶ design-all, design-system, plan-all                                              unchanged
```

## Prd

| Field | Change |
|---|---|
| `subdomains[]` | new, at least one: `{id, name, description, type}`; `id` a DNS label, `type` `core`, `supporting` or `generic`; the parts of the business the brief describes, never a model or a team |
| `capabilities[].context` | replaced by `subdomain`: one of `subdomains[].id` |

## BusinessRules

| Field | Change |
|---|---|
| `contexts[]` | removed: the Prd's `subdomains` are the list, and a rules artifact is read beside its Prd |
| `rules[].context` | replaced by `subdomain`: one of the Prd's subdomains; required by the Validator when the Prd has more than one. The context that enforces a rule is the one whose storming constraint cites it |

## EventStorming (DSL 4.1)

| Field | Change |
|---|---|
| `contexts[].subdomain` | new: the Prd subdomain id this context realises. Optional at big-picture and process; required at design (`context-no-subdomain`). One subdomain per context; a subdomain may have several contexts |
| `contexts[].classification` | unchanged in the DSL (the context map draws it); at design it is the subdomain's `type`, held by the derivation |
| `version` | `4.1`; a 4.0 model loads with no subdomains and fails only the design-level rule |

## BoundedContext

| Field | Change |
|---|---|
| `subdomain` | new, required: the storming context's `subdomain` |
| `capabilities[]` | new, at least one: the `CAP-n` of its subdomain whose commands it handles; every capability of the subdomain when the subdomain has one context |
| `classification` | unchanged; the subdomain's `type` |

## Process

| Member | Change |
|---|---|
| Task `draft-prd`, ReviewLoop `author-prd` | input `contextIds` removed; the agent names the subdomains from the brief and the human confirms them at `prd-gate`; `previous` keeps the ids across rounds |
| Prompt `prd-rules` | a subdomain per part of the business the brief names, typed by the test "would a competitor copying it hurt"; a capability names the subdomain whose users it serves; a rule names the subdomain whose policy it is |
| Validator `prd-consistency` (`checkPrd`) | `subdomain-mismatch` replaces `context-mismatch`: a capability's or a rule's `subdomain` not in the Prd's; a cited rule of another subdomain; an untagged rule when the Prd has more than one; duplicate subdomain ids |
| Prompt `storming-big-picture` | contexts are cut where the language or the owner changes; the Prd's subdomains are where to look, not the cut: one subdomain may need two contexts, and a context's id is the storming's own |
| Prompt `storming-design` | each context names its `subdomain`; `classification` is that subdomain's `type` |
| grammar `check` | DSL 4.1; `context-no-subdomain` at design level |
| Task `derive-domain`, Prompt `derive-domain-rules` | the BoundedContext takes `subdomain`, `classification` and `capabilities`; invariants take the rules of its subdomain, or untagged ones, that its constraints cite |
| Gate `derived-gate`, `checkDerived` | binds the derived `context` and the `prd`; `derived-subdomain-mismatch` (not the storming context's, or not the Prd's), `derived-classification-mismatch` (not the subdomain's type), `derived-capability-unknown` (not a capability of the subdomain), `derived-relationship-mismatch` (`relationships` differ from the storming's `contextRelationships` under the role and pattern map) |
| Validator `architecture-consistency` (`checkArchitecture`) | `prd-context-unread` replaced by `capability-unplaced` (no BoundedContext lists a capability) and `capability-twice` (two do); reads the contexts' content |
| ReviewLoop `spec-one`, Workflow `spec-all`, Gate `spec-gate` | input `context` (the BoundedContext); `checkSpec`'s `context-mismatch` becomes: the capability is in `context.capabilities`, and `domainModel.context` is the context's id |
| Prompt `write-spec` | the capability's context is the bound BoundedContext |

## Rules

| Rule | Enforcer |
|---|---|
| a Prd names its subdomains and nothing in it names a context | schema, `prd-consistency` |
| every capability and, with more than one subdomain, every rule names one of the Prd's subdomains | `prd-consistency` |
| at design level every storming context names a subdomain | grammar |
| a BoundedContext realises the subdomain its storming context names, has that subdomain's type, lists only that subdomain's capabilities, and its relationships are the storming's | `domain-consistency` |
| every capability is listed by exactly one BoundedContext | `architecture-consistency` |
| a Spec's capability is one its BoundedContext lists | `spec-consistency` |

## Decisions

- Subdomains in the Prd, bounded contexts in the storming: the Prd is the what and the why, a
  context boundary is a design decision the storming confirms at its Gate; the old order let the
  storming add a context but never split, merge or rename one the Prd named. Found in design review.
- One subdomain per context, several contexts per subdomain: the split the storming needs most
  (one business part, two languages), without a list on every context; a context over two
  subdomains is a hotspot for the human. Found in design review.
- A capability's context lives on the BoundedContext (`capabilities[]`), not on a storming command:
  the DSL grows by one field, and the derivation already reads which commands each context handles.
  Found in design review.
- No `subdomainIds` input: the Prd agent names them from the brief and the human confirms them at
  `prd-gate`, as with every other Prd id. Found in design review.
- `classification` stays on the storming context because the context map draws it, and is held to
  the subdomain's `type` instead of being dropped. Found in design review.
- DSL 4.1, not an unversioned extra field: the `EventStorming` kind's schema is closed. The editor
  copies contexts whole, so the field round-trips without a UI change. The upstream event-storming
  repository takes the same field on its own schedule. Found in design review.
- The relationships check rides along: `derived-gate` never received the derived BoundedContext,
  so a wrong `role` or `pattern` passed unseen. Found in a walkthrough of example08.

## Migration

The four kinds are revisioned and their schemas change incompatibly, so a project made before this
starts fresh (`91-roadmap.md`). The recorded examples are migrated by hand: example07 and
example08 move their Prd's contexts to subdomains and tag their storming contexts and
BoundedContexts, said in their README.

## Units

1. Grammar DSL 4.1 and the `EventStorming` schema: `contexts[].subdomain`, `context-no-subdomain`.
2. `Prd` and `BusinessRules` schemas, `checkPrd`, `draft-prd`, `author-prd`, Prompt `prd-rules`.
3. Storming Prompts.
4. `BoundedContext` schema, `derive-domain`, `derived-gate`, `checkDerived` (with relationships).
5. `checkArchitecture`.
6. `spec-one`, `spec-all`, `spec-gate`, `checkSpec`, Prompt `write-spec`.
7. Examples 07 and 08 migrated; docs 23, 26, 27, 28, 31 and 33 point here.
8. Live run of example08 on `claude-sonnet-5`.
