---
name: autopilot-doc
description: Take one idea to approved persimmon Plans with no human - Prd, domain discovery, Architecture and Adrs, Specs, Designs, DesignSystem, Plans - a fresh reviewer subagent at each human Gate. Use when the developer asks to autopilot the documents, the design, or everything up to the Plans.
---

# Autopilot: idea to Plans

Read `.claude/skills/autopilot/driving.md` first: it says how to start, answer and end each run
below, and when to stop. Every run takes the passed revisions the runs before it produced.

## 0. Before

- `persimmon.yaml` in the project directory; if absent, `persimmon init`.
- A `productId`: lowercase kebab from the idea, at most 40 characters, no Prd with that stem in
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
4. `spec-all`, once per BoundedContext: `prd`, `capabilities` (the context's `capabilities`),
   `architecture`, `context`, and that context's `domainModel` and `glossary`, `rules`.
5. `design-all`, for each non-client building block: one run per interface it `provides` (HTTP
   `http-api`, messages `async-api`) with `interface` bound, and `qualifier` too for its second of
   one type; one `data-schema` run when it or a child block stores data. Inputs: `blocks`, `type`,
   `architecture`, the block's context's `domainModel` and `glossary`, `rules`.
6. When the Architecture has client blocks: `design-system` (`prd`, `architecture`), then
   `design-all` with `type=ui` over the client blocks: `designSystem`, and `designs` the
   `http-api` Designs they call, `architecture`, `rules`.
7. `plan-all`: `prd`, every `capabilities` id, `architecture`, `designs` (every Design).

Read the Architecture with `persimmon get Architecture/<id>` to pick the blocks and types of steps
5 and 6.

## 3. End

Every Plan's Gate passed: hand the Plans, Specs, Designs, Architecture, Glossaries and rules to
`autopilot-code`, or, run alone, report as `driving.md` says.
