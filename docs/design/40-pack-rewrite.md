# Rewrite pack

status: draft · layer: 2 (`20-pack.md`, `23-pack-sdlc.md`, `26-domain-discovery.md`, `28-prd-process.md`, `39-test-process.md`) · schema: the `SourceInventory` kind in `packs/rewrite/global/10-artifact-kinds.yaml`

The developer names an existing system to rebuild. Their agent recovers what its code knows into
the SDLC pack's artifacts, a human decides what the rewrite keeps, and the SDLC pack's own processes
rebuild it. At the end, the rewrite's tests run against the Source system too, so a rule recovered
wrong shows as a test the Source system fails. The pack adds one artifact kind, the processes
before and after the SDLC run order, and an agent skill; every other kind and process is the SDLC
pack's, used by name.

```text
developer: source checkout at one commit, brief (text), productId
  ─▶ ReviewLoop inventory
       produce: Task inventory-source (Executor source-reader, workspace = the source) ─▶ SourceInventory <productId>-inventory
       review:  Gate inventory-gate = inventory-consistency (sdd/v1), then inventory-audited (audit-inventory)
  ─▶ ReviewLoop recover-prd
       produce: Task recover-prd (prd-agent) ─▶ Prd <productId>-prd, BusinessRules <productId>-rules
       review:  Gate recover-gate = prd-consistency, recovery-consistency (sdd/v1), then prd-audited,
                then recovery-confirmed (human: is this what the source does; a Disposition per CAP-n and BR-n)
  ─▶ the SDLC run order from domain-discovery, unchanged, the inventory bound to the storming
       domain-discovery, architect, spec-all, design-all, design-system, plan-all, setup-tests, test-design-all, build-all
  ─▶ Workflow parity (after build-all, when the rewrite keeps the interface)
       Task run-source-levels (level-runner, the Source system's app) ─▶ TestOutcome per level
       Gate parity-gate = parity-consistency (sdd/v1)
```

## Inputs

| Input | Shape | Why |
|---|---|---|
| `source` | `externalResource`: `locator.path` a checkout of the Source system, `version` its commit | the Task's workspace; provenance pins the commit every `where` is read at |
| `brief` | text | why the rewrite, the target stack and constraints, the default Disposition, whether the interface is kept, what is out of scope; text, as `28-prd-process.md` decided for the Prd's brief |
| `productId` | string | stems every artifact id, as in `28-prd-process.md` |
| `sourceApp` | value `{start, ready}`, `parity` only | how to start the Source system and the URL that answers once it is up |

## `SourceInventory`

Facts read off the Source system at one commit, before any interpretation. A `where` is
`<path>:<line>` or `<path>:<from>-<to>`, relative to the repository root.

| Field | Content |
|---|---|
| `source` | `{repository, commit}` |
| `entryPoints[]` | `{id EP-n, kind: http\|message\|job\|cli\|ui, name, where[]}`: where the outside starts work; candidate commands |
| `stateChanges[]` | `{id ST-n, entity EN-n, change: create\|update\|delete\|status, name, where[], from[] EP-n}`: a write that persists; candidate domain events, a `status` change a candidate pivotal one |
| `guards[]` | `{id GD-n, condition, outcome, where[], in[] EP-n}`: a branch that refuses, computes or decides; candidate rules |
| `entities[]` | `{id EN-n, name, store?, where[]}`: what is persisted, in the source's names |
| `externalSystems[]` | `{id EX-n, name, direction: in\|out\|both, where[]}` |
| `tests[]` | `{name, where, covers[] EP-n\|GD-n}`: the source's own tests, the behaviour its team checked |
| `unread[]` | `{path, reason}`: what the agent did not read, so a gap is visible instead of silent |
| `openQuestions[]` | `{id Q-n, question, resolution?}` |

## Process

| Member | Content |
|---|---|
| Prompt `inventory-rules` | facts only, in the source's names: a guard says what the code tests and what follows, not what it is for; every item has a `where`; generated, vendored and test-fixture code is `unread` with its reason; the agent may run any analyzer it finds in the workspace and records only what it read |
| Executor `source-reader` | `claude-code/v1`, read-only, its own name so a Namespace picks the model |
| Task `inventory-source` | inputs `source`, `brief`, `previous`, `feedback`; output `inventory`; `workspace: {input: source}` |
| Task `audit-inventory` | Executor `auditor`; a sample of guards and state changes against the code at their `where`; a directory with code that is neither read nor `unread` |
| Prompt `recover-rules` | record, never invent: a capability groups entry points a user sees as one thing; a rule states one guard or several in RuleSpeak, with `source: "inventory: GD-n, ..."`; a guard that is plumbing (a null check, a retry) is no rule; a behaviour the source shows and no guard explains is a `Q-n`; the brief's default Disposition applies until the human says otherwise |
| Task `recover-prd` | inputs `inventory`, `brief`, `productId`, `previous`, `previousRules`, `feedback`; outputs `prd`, `rules` (the same ports and ids as `draft-prd`, so the SDLC run order reads them unchanged) |
| Task `confirm-recovery` | human on `cli-human/v1`: reads the Prd, the rules and the inventory; one finding per wrong item, and one per item whose Disposition is not the default |
| Validators | `inventory-consistency`: `sdd/v1` `checkInventory`; `inventory-audited` over `audit-inventory`; `recovery-consistency`: `sdd/v1` `checkRecovery` over `prd`, `rules`, `inventory`; `prd-consistency`, `prd-audited` the SDLC pack's; `recovery-confirmed` over `confirm-recovery` |
| Gates | `inventory-gate` (`audited` `after: [consistency]`); `recover-gate` (`confirmed` after the three checks) |
| ReviewLoops | `inventory` (`maxRounds: 2`), `recover-prd` (`maxRounds: 3`, `carry: {rules: previousRules}` as `author-prd`) |
| Task `run-source-levels` | the SDLC `run-levels` with `sourceApp` in place of the harness's `app`; the `api` and `e2e` levels only; the TestOutcome's `head` is the source commit |
| Workflow `parity` | inputs `testDesigns`, `harness`, `specs`, `rules`, `sourceApp`; `run-source-levels`, then `parity-gate` |
| skill `rewrite` | `files/.claude/skills/rewrite/SKILL.md`: the run order above, each run's inputs, then `autopilot-doc`'s and `autopilot-code`'s order from `domain-discovery`; with `--autopilot` a Reviewer subagent answers each Gate as `38-autopilot.md` says |

One SDLC pack change, its own unit: an optional `inventory` input on Task `event-storm` and
Pipeline `domain-discovery`, handed to every phase, as `rules` was (`26-domain-discovery.md`).

## Checks

`adapters/sdd/check.mjs`, pure but for reading the source checkout, every finding `error` unless marked.

| Code | Finding |
|---|---|
| `inventory-location` | a `where` naming a file the checkout lacks, or a line past its end |
| `inventory-reference` | an `entity`, `from[]`, `in[]` or `covers[]` id the inventory lacks |
| `id-sequence` | `EP-n`, `ST-n`, `GD-n`, `EN-n`, `EX-n`, `Q-n` not unique and increasing in document order |
| `unknown-inventory-item` | a rule's `source` or a capability's description naming an inventory id that is not there |
| `rule-unsourced` | an `active` rule whose `source` starts with neither `inventory:` nor `decision:` |
| `guard-uncited` (warning) | a guard no rule cites; plumbing is expected here, a business guard is a missed rule |
| `entry-point-uncited` (warning) | an entry point no capability description and no `nonGoals` entry names |
| `parity-broken` | a case verifying a kept rule, directly or through an `FR-n` that enforces it, `nok` on the Source system |
| `parity-unpinned` (warning) | a kept rule with no case run against the Source system |

A kept rule is an `active` rule whose `source` starts with `inventory:`; a rule sourced from
`decision:` is a change the Source system is not held to.

## Rules

| Rule | Enforcer |
|---|---|
| the Source system is read, never changed: the Executor is read-only and the workspace is the checkout | `source-reader`; convention |
| every inventory item has a `where` that exists at the commit | `inventory-consistency` |
| the recovered Prd and rules are `<productId>-prd` and `<productId>-rules`, so `domain-discovery` and every later run take them as they take an authored pair | `recover-prd` outputs |
| a Disposition is recorded in the Prd and the rules, never in a kind of its own: `keep` leaves the item; `change` deprecates the rule and adds one with `source: "decision: ..."`; `drop` moves the capability to `nonGoals` with its reason | `recover-rules`; `confirm-recovery` |
| the Prd's first revision is what the Source system does; later revisions carry the Dispositions; `persimmon get --behind` and the revisions keep both | revisions (`05-revisioned-kind.md`) |
| `domain-discovery` takes the inventory: a domain event is a state change in the source's words, a pivotal event a `status` change, a context is cut by language and events, never by package; a part of the source with no model boundary is `bigBallOfMud` | `storming-dsl` (inventory part) |
| `parity` runs only when the brief keeps the interface: an `api` or `e2e` test written against a changed interface cannot run against the Source system; without it the TestReport stands alone and the report says parity was not checked | skill `rewrite` |
| a `parity-broken` case is an `Issue`: the rule was recovered wrong (`spec-wrong`, a rules revision) or the test reads the case wrong; never fixed by changing the Source system | `parity-gate`; `AGENTS.md` section 6 |
| `persimmon init --pack rewrite` applies the SDLC pack, then the Rewrite pack, and places both packs' files; the Rewrite pack ships no `AGENTS.md` | `persimmon init` |

## Decisions

- A pack of its own, not a second entry into the SDLC pack: the run order differs before the Prd
  and after the build, and the Source system, the inventory, the Disposition and the parity check
  mean nothing to a product built from an idea. Packs have no dependencies (`20-pack.md`), so the
  Rewrite pack uses the SDLC pack's kinds and processes by name and `init --pack rewrite` installs
  both; copying them was refused, since two copies of the same kind drift. Found in design review.
- One new kind. `Prd`, `BusinessRules`, `EventStorming`, `Glossary`, `BoundedContext`,
  `DomainModel` and the test kinds take a recovered system as they take an authored one; only the
  facts read off the code have no home. A rule's evidence goes in `source`, a string already there;
  a typed `evidence[]` on `BusinessRules` waits for a check that needs more than ids. Found in design
  review.
- The brief stays text, as `28-prd-process.md` decided; what a check needs is a typed input of its
  own (`source`, `sourceApp`). Found in design review.
- The agent extracts and a check decides, as in `26-domain-discovery.md`. AWS Transform, Thoughtworks'
  CodeConcise and Cognizant's seven-agent framework all put static analysis first and the model on
  translation; a pack ships YAML and a parser per language is not portable, so the agent runs
  whatever analyzer the workspace has and `inventory-consistency` checks every location it gives.
  Found in research.
- The inventory before the Prd, and the Prd before the storming: `checkSubdomains` needs the Prd's
  subdomains to judge the storming's contexts (`34-subdomains.md`), and the inventory is the
  evidence both cite. Found in design review.
- One storming, not an as-is and a to-be. The storming runs after the Dispositions, over the
  inventory, and cuts contexts by language and events, so the messy code's structure never becomes
  the model's. A board of the source as it is would cost three human gates for a model nobody
  builds; the inventory and the Prd's first revision are the record of what the source does.
  Found in design review.
- The storming reads the inventory through an optional input, not a Rewrite pack copy of
  `event-storm`: an override must keep the ports (`20-pack.md`), and a Prd alone carries no
  command, event or entity of the source. Optional, so a product from an idea storms as before.
  Found in design review.
- A Disposition is not a kind: `keep`, `change` and `drop` each map onto a field the Prd or the
  rules already have, and the revision history shows what changed. Found in design review.
- Parity after `build-all`, not before. The Tester writes the `api` tests inside `build-one`
  (`39-test-process.md`), so no test exists to pin the source with before then; the tests are
  written from cases derived from the recovered rules, and running them against the Source system
  shows where the recovery and the source disagree. Pinning the source before the build waits for
  a Tester task outside `build-one`. Found in design review.
