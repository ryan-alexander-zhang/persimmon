---
name: rewrite
description: Rewrite an existing system into a new repository with persimmon, Slice by Slice, without losing a business rule or an edge case - survey the source, inventory and characterize each Slice against the running source, recover the Prd and rules, rebuild with the SDLC run order, then hold the rewrite to the source's recorded answers. Use when the developer asks to rewrite, migrate, port or rebuild an existing codebase. With --autopilot, a fresh subagent answers each human form.
---

# Rewrite

The developer names an existing system to rebuild. The project directory is the rewrite's own
repository; the Source system is a checkout outside it, read and never changed. Changing the source
in its own repository is a refactor, not this skill's: say so and stop.

Read `.claude/skills/rewrite/driving.md` first: how to start each run, answer its forms and end it.

## 0. Before

- `persimmon.yaml` in the project directory; if absent, `persimmon init --pack rewrite`. The
  project is a git repository; you never run git in it.
- The source: a checkout path outside the project, at the commit to rewrite. A URL: ask the
  developer to clone it outside the project. A path inside the project, or the project inside it:
  stop, it is a refactor. Never edit, build or commit in the checkout.
- A `productId`: lowercase kebab, at most 40 characters, no Prd with that stem in `persimmon get Prd`.
- `.persimmon/rewrite/brief.md`, from what the developer said, asking for what is missing: why the
  rewrite; the target stack and constraints; how the source runs (its start command, its database
  and how to reset it), or that it does not; where input and output records are, if any; the default
  Disposition (`keep` unless the developer says otherwise); whether the interface is kept.

## 1. The Survey, once

`survey`: `source`, `brief`, `productId`. Gives the SourceInventory's first revision and the
ParityLedger `<productId>-parity` with the human's cut: the Slices, in order.

## 2. Each Slice, in the cut's order

Every run takes the latest passed revisions (`driving.md`, End). `base` and `ledger` below are the
last approved SourceInventory and ParityLedger; `prd` and `rules` the product's last approved, absent
on the first Slice.

1. `inventory`: `source`, `brief`, `productId`, `slice`, `base`, `ledger`. Two readers and an
   auditor; the Gate holds every `where` to the source and every branch line to a guard.
2. `characterize`: `source`, `repository` (the project), `brief`, `productId`, `slice`,
   `inventory` (step 1's), `ledger`. The Tester writes the Characterization tests and the mutants;
   the Gate passes when every item its Oracle can pin is pinned. Out of rounds: go on to step 3 with
   its last ledger; its open items reach the human there. Keep the Tester's `written.unreachable`
   for that human's form.
3. `recover-prd`: `brief`, `productId`, `slice`, `inventory`, `ledger` (step 2's), `prd`, `rules`.
   The human decides each Disposition, dead item, plumbing pattern and accepted open item.
4. The SDLC run order for the Slice's capabilities, as `autopilot-doc` and `autopilot-code` say, from
   the recovered Prd and rules, with these inputs added:
   - `domain-discovery`: `inventory=@.persimmon/rewrite/inventory.yaml` (`driving.md`), and from
     the second Slice on `base`, the product's last approved big-picture EventStorming.
   - `architect`: from the second Slice on `base` and `baseAdrs`, the last approved Architecture and
     its Adrs.
   - `spec-all` over the Slice's `CAP-n` only; `setup-tests` on the first Slice only.
5. `parity`: `repository`, `productId`, `slice`, `inventory`, `ledger` (step 3's), `prd`, `rules`,
   `designs` (the Slice's Designs), `harness`. The rewrite driver, the suite against the rewrite, the
   human's review. Each difference without a cause is an `Issue` (`autopilot-code`, Defects): the
   rule was recovered wrong, the test reads the source wrong, or the rewrite is wrong. Fix the
   rewrite or report; never the source. Then `parity` again.

A Slice is done when its `parity` Gate passed. Cutting it over is the developer's.

## 3. Stop

As `driving.md` says, and also when: a loop other than `characterize` runs out of rounds; the source
checkout moved (`source-moved`); a check finds the source inside the project
(`source-inside-project`).

## 4. Report

Per Slice: the revisions each run produced, the ledger's verdict, every `unverified` item and
`unreached` entry point, every Disposition other than `keep`, every Issue, and every decision a
subagent made. The developer reads it before cutting the Slice over.
