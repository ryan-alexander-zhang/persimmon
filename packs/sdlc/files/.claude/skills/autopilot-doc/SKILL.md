---
name: autopilot-doc
description: Take one idea to approved persimmon Plans with no human - Prd, domain discovery, Architecture and Adrs, Specs, Designs, DesignSystem, Plans - an owner agent in the human's place at every question and Gate. Use when the developer asks to autopilot the documents, the design, or everything up to the Plans.
---

# Autopilot: idea to Plans

Read `.claude/skills/autopilot/driving.md` first: it says how to start, answer and end each run
below, and when to stop. Every run takes the passed revisions the runs before it produced.

## 0. Before

- `persimmon.yaml` in the project directory; if absent, `persimmon init`.
- The Executor overrides: `persimmon apply .claude/skills/autopilot/autopilot.yaml -n default`
  (`driving.md`, Before the first run).
- A `productId`: lowercase kebab from the idea, at most 20 characters (every artifact id below is
  built on it and a Design's must fit 63), no Prd with that stem in
  `persimmon get Prd`.

## 1. Brief

Write `.persimmon/autopilot/brief.md` from the idea: the problem, who has it, what they need done,
and every constraint the developer stated. Add nothing the idea does not say; what it leaves open
is a question in the brief, for the Prd's `Q-n`.

## 2. The runs, in order

1. `author-prd`: `brief=@.persimmon/autopilot/brief.md`, `productId`. Gives the Prd and the
   BusinessRules.
2. `domain-discovery`: `prd`, `rules`. Three storming Gates, then the derivation: one
   BoundedContext, Glossary and DomainModel per context.
3. `architect`: `prd`, `rules`, `contexts`, `domainModels`, `glossaries` (lists of every context's).
   Gives the Architecture and its Adrs.
4. `spec-all`, one run for the product: `prd`, `capabilities` (one entry per capability of every
   BoundedContext, `{id: CAP-n, context: <context id>}`, read from each BoundedContext's own
   `capabilities` list (`persimmon get BoundedContext/<context id>`), never from the Prd's order or a
   guess: a wrong pairing is a `context-mismatch` no Spec round can clear; the run binds each
   capability's BoundedContext, DomainModel and Glossary itself), `architecture`, `rules`. The capabilities run
   side by side.
5. `design-all`, one run for every non-client building block: `blocks`, a list with one entry
   per Design, `{block: BB-n, type, interface?, qualifier?, context}`: one `http-api` entry per HTTP
   interface the block `provides` and one `async-api` per message interface (`interface` named
   whenever the block provides more than one interface, so the writer never picks, `qualifier` for its second of one type, short: the Design id
   `<architecture id>-<block>-<qualifier>-<type>` is at most 63 characters), one `data-schema`
   entry when it or a child block stores data; `context` the bounded context the block (or that
   interface) realises, from the Architecture's block `contexts`. A block with no context (an event
   bus, a scheduler, a database) gets no entry. Inputs: `blocks`, `architecture`, `rules`. The
   blocks run side by side.
6. When the Architecture has client blocks: `design-system` (`prd`, `architecture`), then
   `design-all` again with one `{block, type: ui}` entry per client block, `designSystem`, and
   `designs` the `http-api` Designs they call, `architecture`, `rules`.
7. `plan-all`, one run: `prd`, `capabilities` (the same entries as `spec-all`), `architecture`,
   `designs` (every Design). Each capability's DomainModel is bound from its context.

Read the Architecture with `persimmon get Architecture/<id>` to pick the blocks and types of steps
5 and 6.

## 3. End

Every Plan's Gate passed: hand the Plans, Specs, Designs, Architecture, Glossaries and rules to
`autopilot-code`, or, run alone, report as `driving.md` says.
