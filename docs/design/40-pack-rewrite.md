# Rewrite pack

status: draft · layer: 2 (`20-pack.md`, `23-pack-sdlc.md`, `26-domain-discovery.md`, `28-prd-process.md`, `31-architecture-process.md`, `39-test-process.md`) · schema: the `SourceInventory` and `ParityLedger` kinds in `packs/rewrite/global/10-artifact-kinds.yaml`

The developer names an existing system to rebuild in a new repository: the persimmon project is the
rewrite's, and the Source system is a checkout outside it, read and never changed. Changing the
Source system in its own repository is a refactor, not this pack's. Their agent surveys the whole
source once, then works Slice by Slice: it recovers what the code knows into the SDLC pack's
artifacts, a human decides what the rewrite keeps, and the SDLC pack's own processes rebuild it.

Two lines of evidence hold each Slice. Knowledge (the inventory, the rules, the storming) is what a
human reads and decides on. Behaviour (Characterization tests whose expected values are the Source
system's own answers) keeps the rules nobody recovered. A rule counts as pinned only when a test
fails once the rule is mutated in a copy of the source; a line that merely ran proves nothing. The
promise: every difference between the Source system and the rewrite is intended or found before
the developer ships, and what no Oracle reached is listed in the ParityLedger, never silent.

```text
developer: the project (the rewrite's repository), a source checkout outside it at one commit, brief (text), productId
  ─▶ ReviewLoop survey (once)
       produce: Task survey-source (source-reader) ─▶ SourceInventory <productId>-inventory r1: entry points, what each reaches, no guards
       review:  Gate survey-gate = survey-consistency (parity/v1), then survey-confirmed (human: cut the Slices)
  per Slice SL-n, in the order the human set:
  ─▶ ReviewLoop inventory
       produce: Task inventory-source (source-reader) ─▶ SourceInventory next revision: the Slice's facts
                on a static Slice, also Task reread-source (second-reader), in a prescribed other order
       review:  Gate inventory-gate = inventory-consistency (parity/v1), then inventory-audited
  ─▶ ReviewLoop characterize                    skipped on a static Slice; its ledger is computed from the inventory
       produce: Workflow characterize-work
                Task write-characterization (tester) ─▶ the suite: tests, the source's Protocol driver, reset
                Task run-source (source-runner)      ─▶ TestOutcome per suite level on the source, coverage
                Task write-mutants (tester)          ─▶ one mutant per reached item
                Task run-mutants (source-runner)     ─▶ each mutant killed or survived, in a scratch copy
                Task compute-ledger (parity/v1)      ─▶ ParityLedger <productId>-parity, next revision
       review:  Gate characterize-gate = ledger-closure (parity/v1); open items are the next round's feedback
  ─▶ ReviewLoop recover-prd
       produce: Workflow recover-work
                Task recover-prd (prd-agent)         ─▶ Prd <productId>-prd, BusinessRules <productId>-rules, next revisions
                Task compute-ledger                  ─▶ ParityLedger next revision: every item accounted for
       review:  Gate recover-gate = prd-consistency, recovery-consistency (parity/v1), then prd-audited,
                then recovery-confirmed (human: is this what the source does; a Disposition per item; dead, plumbing, accepted)
  ─▶ the SDLC run order for the Slice's capabilities, the inventory bound to the storming
       domain-discovery (base: the last model), architect (first Slice; a revision when a Slice needs a block), spec-all over the
       Slice's CAP-n, design-all, plan-all, setup-tests (first Slice), test-design-all, build-all
  ─▶ Workflow parity
       when the interface changes: ReviewLoop rewrite-driver
         produce: Task write-rewrite-driver (tester) ─▶ the rewrite's Protocol driver
         review:  Gate driver-gate = driver-cited (parity/v1), then driver-audited, then driver-confirmed (human)
       Task run-rewrite (source-runner, the rewrite's app) ─▶ TestOutcome on the rewrite
       Task compute-ledger                             ─▶ ParityLedger next revision: every difference with its cause
       Gate parity-gate = parity-explained (parity/v1)
  ─▶ cutover of the Slice: the developer's, outside the pack
```

## Survey and Slices

The Survey lists every entry point of the whole source and, for each, the files, entities and
external systems it reaches, without reading a guard. At `survey-gate` the human cuts Slices: sets
of entry points rewritten, checked and cut over together, in order. A Slice is small enough for one
agent's context and one human's review (the pilots: one batch program with 32 guards; eight Java
files with 29). An entity two Slices both reach is a contract between them: the earlier Slice
records its layout as a declaration (`kind: contract`) and pins it with a test, so a rewritten Slice
cannot break an old one still running beside it.

Ids count up across Slices: a later Slice cites an earlier Slice's `EN-n` or `ST-n` and never
redefines it. Each Slice adds a revision to the SourceInventory, the ParityLedger, the Prd and the
BusinessRules; the storming takes the last model as its `base`.

## Oracle

Where a Slice's expected behaviour comes from, computed per entry point from what the suite ran;
never declared. The verdict reads the weakest.

| Oracle | Suite level that held it | Characterization | Pinned when | What stays unproven |
|---|---|---|---|---|
| `running` | `app`: the source app, started and reset by the level's own commands | black-box tests at the source's interface through the source's Protocol driver | its mutant fails a test | inputs no test sent |
| `partial` | `units`: the source's own toolchain, the app not started; the source's own tests count | unit tests calling the source's code | its mutant fails a test | entry points no unit reaches; the wiring between units |
| `recorded` | `records`: input and output pairs the source produced, given by the developer | one test per record, run against the rewrite only | never; `recover-prd` claims the guards a record shows | behaviour no record shows; every guard `unverified` |
| `static` | none | none | never | every guard `unverified`; the verdict is at best `concerns` |

`running` and `partial` need a coverage report: without one, an item is `unverified`, never
`complete`.

## Inputs

| Input | Shape | Why |
|---|---|---|
| `source` | `externalResource`: `locator.path` a checkout of the Source system outside the project, `version` its commit | the readers' workspace; provenance pins the commit every `where` is read at |
| `brief` | text | why the rewrite, the target stack and constraints, how the source runs (or that it does not), where records are, the default Disposition, whether the interface is kept; text, as `28-prd-process.md` decided |
| `productId` | string | stems every artifact id |
| `slice` | `SL-n` | the Slice a per-Slice run works on |

## `SourceInventory`

Facts read off the Source system at one commit, before any interpretation. A `where` is
`<path>:<line>` or `<path>:<from>-<to>` relative to the repository root, cut as `inventory-rules`
says; or `{in: db|config|external, locator}` for what lives only in a deployed database, a
configuration store or another system.

| Field | Content |
|---|---|
| `source` | `{repository, commit}` |
| `slices[]` | `{id SL-n, name, entryPoints[] EP-n, order}`: the human's cut at `survey-gate` |
| `entryPoints[]` | `{id EP-n, kind: http\|message\|job\|cli\|ui\|report, name, where[], reaches {files[], entities[] EN-n, externalSystems[] EX-n}}` |
| `stateChanges[]` | `{id ST-n, entity EN-n, change: create\|update\|delete\|status\|send, name, where[], from[] EP-n}`: a write that outlives the request (a row, a session, a file, a message, an email); candidate domain events |
| `guards[]` | `{id GD-n, condition, outcome, role: rule\|plumbing\|unknown, where[], in[] EP-n, volatile?: [time\|random\|order\|concurrency]}`: every branch that refuses, computes or decides; `volatile` when its outcome depends on more than its input |
| `declarations[]` | `{id DC-n, kind: key\|uniqueness\|retention\|ordering\|schema\|data\|config\|contract, statement, where[]}`: a rule stated without a branch |
| `absences[]` | `{id AB-n, statement, where[]}`: a check the source could make and does not (a status read nowhere), so its keeping or adding is decided, not assumed |
| `plumbingPatterns[]` | `{id PP-n, pattern, examples[] GD-n}`: one shape of plumbing (a file status check after every read), accepted once |
| `entities[]` | `{id EN-n, name, store?, where[]}` |
| `externalSystems[]` | `{id EX-n, name, direction: in\|out\|both, where[]}` |
| `tests[]` | `{name, where, covers[] EP-n\|GD-n}`: the source's own tests |
| `unread[]` | `{path, reason}`: what the agent did not read |
| `openQuestions[]` | `{id Q-n, question, resolution?}` |

## `ParityLedger`

Computed by `parity/v1`, never written by an agent: the TestReport's rule (`39-test-process.md`).
One per Source system, a revision per step per Slice.

| Field | Content |
|---|---|
| `source`, `inventory`, `rules?`, `slice` | the commit, the ids, the Slice of this revision |
| `suite` | `{levels {app?, units?, records?: {tool, run, one, reset?, junit, testDir, coverage?}}, drivers {source, rewrite?}, conventions}`; absent on a static Slice |
| `entryPoints[]` | `{id EP-n, oracle}` |
| `items[]` | `{ref GD-n\|DC-n\|ST-n\|EX-n\|AB-n, reached, mutant?: killed\|survived\|none, tests[], rules[] BR-n, disposition?, dead?, accepted?, account: complete\|unverified\|open, reason?}` |
| `answers[]` | `{test, observed}`: what the source answered, recorded when the test passed on it, never edited |
| `differences[]` | `{test, source, rewrite, cause?: {rule BR-n} \| {issue}}` |
| `unreached[]` | `{ref, why}` |
| `verdict` | `{result: pass\|concerns\|fail, rule}` |

An item's `account`:

| Item | `complete` when | `unverified` when |
|---|---|---|
| rule or unknown guard, declaration | ruled (a `BR-n` cites it) and pinned (its mutant killed), or dropped by a Disposition, or `dead` as a human confirmed | ruled, and its Oracle cannot pin it (`recorded`, `static`, `volatile` uncontrolled, no coverage), or a human accepted it open with a reason |
| plumbing guard | it matches an accepted `PP-n` and `audit-inventory` found no rule among the sampled | never |
| state change, outbound external system | pinned: a test asserts it through the Protocol driver (the row, the message, the email) and its mutant (the write removed) is killed; or dropped | its Oracle cannot pin it |
| absence | a Disposition: `keep` (the rewrite does not check either) or `change` (a new rule) | never |

Anything else is `open`. `pass`: nothing `open`, nothing `unverified`, nothing `unreached`, no
difference without a cause. `concerns`: `unverified` or `unreached` only. `fail`: anything else.

Reached and pinned stay apart. In the JPetStore pilot a stock guard's line ran in 20 passing tests
and none read its outcome; another guard had both branches covered while nothing asserted the line
numbering it produced. Coverage says control reached a line; only a killed mutant says a test
depends on which way it went.

## Protocol drivers

Characterization tests assert observations, not wire formats. The suite holds a driver per system
that turns its interface into those observations: Farley's four-layer acceptance tests.

```python
def test_EP3_GD11_add_in_stock(app):            # written once, never edited for the rewrite
    obs = app.add_item("EST-4")
    assert obs.lines["EST-4"].in_stock is True
    assert obs.subtotal == Money("18.50")

class SourceDriver:                              # fixed once the Slice is characterized
    def add_item(self, item_id):
        return CartObs.from_html(self.s.get(f"/cart/addItemToCart?workingItemId={item_id}").text)

class RewriteDriver:                             # EP-3 -> EL-7; renames and reshapes, never computes
    def add_item(self, item_id):
        j = self.s.post(f"/api/carts/{self.cid}/items", json={"itemId": item_id}).json()
        return CartObs(lines={l["itemId"]: Line(l["quantity"], l["inStock"], Money(l["total"])) for l in j["lines"]},
                       subtotal=Money(j["subtotal"]))
```

One test file runs against both systems, so the source's answers stay live, and HTML fragility (four
of five test fixes in the pilot) lives in one place. With the interface kept, the source's driver
serves both. A rewrite driver that computes would move a rule into test code: a subtotal summed in
the driver passes every test while the rewrite lacks the rule. So it renames, reshapes, selects and
converts formats only; one call may become several, never a value.

| Interface change | Rewrite driver |
|---|---|
| kept | none; the source's driver |
| renamed or reshaped | one method per operation |
| merged (two old operations, one new call) | each old operation selects its part of the one answer |
| split (one old operation, two new calls) | one method, two calls |
| removed | a `drop` Disposition; no method |

## Method

What the agents are taught, as Prompts the pack ships, one per Task, overridable in a Namespace.

| Prompt | Teaches |
|---|---|
| `source-reading` | where rules hide, per common stack: validators and annotations, ORM mappings and constraints, SQL in strings, stored procedures and triggers, configuration and feature flags, reflection and dependency wiring, scheduled jobs and their order, message handlers, report queries, `Optional` chains and other branches with no keyword; COBOL `EVALUATE`, `INVALID KEY`, `AT END`, 88-level condition names, `OPEN OUTPUT` on an indexed file as a truncate, `RETURN-CODE`, reference modification, signed overpunch in data, IDCAMS `KEYS` and `UNIQUEKEY`, GDG `LIMIT`, scheduler files; statement order as a rule; a field read nowhere as an absence; a README's stated stack checked against the code |
| `survey-rules` | entry points of every kind across the whole source, what each reaches, no guard; propose Slices along shared data, smallest first |
| `inventory-rules` | facts only, in the source's names; one guard per decision, its `where` from the deciding statement to the end of its last arm, a condition name's declaration as a second `where`; identical plumbing as one `PP-n`; generated, vendored and fixture code `unread` with its reason |
| `reread-source` | the same facts read in another order: data, schema and job definitions first, then the code; written blind to the first reader |
| `characterize-rules` | record, never judge: the expected value is what the source answered, a bug included; tests assert observations through the source's driver; per guard an input on each side of its boundary, generated inputs where the toolchain has a property-based tool; a `time` guard on each side of its date with the clock controlled; a `random` one with the seed fixed; data reset before each test by the level's `reset`; each test named with the `EP-n` and the items it targets; propose `dead` with the evidence when no input can reach an outcome |
| `mutant-rules` | one mutant per reached item: a guard's condition negated, a handler removed, a write deleted, a declaration dropped; touching only the item's `where` |
| `recover-rules` | evidence ranks observed (a Characterization test) over read (the code) over said (docs, comments, names); a rule states one item or several in RuleSpeak with `source: "inventory: GD-n, DC-n, ST-n, ..."` and names its tests in `examples`; plumbing is no rule; behaviour the tests show and no item explains is a `Q-n`; every absence gets a proposed Disposition; the brief's default Disposition holds until the human says otherwise |
| `recovery-review` | for the human's form and the Reviewer subagent: accuracy first, then Disposition; a `drop` names its reason; a `dead` needs the evidence the ledger shows; an accepted open item names why no test can reach it |
| `driver-rules` | the rewrite driver renames, reshapes, selects and converts; never arithmetic, never a branch on a value, never a call the operation does not need; each method cites its `EP-n` and the Design element it lands on |
| skill `rewrite` | `files/.claude/skills/rewrite/SKILL.md` and its `driving.md`: the run order above per Slice; before the first `architect`, an Adr taken first naming the suite's `app` tool for the `api` level when the interface is kept, so `harness-rules` picks it; then `autopilot-doc`'s and `autopilot-code`'s order for the Slice's capabilities; with `--autopilot` a Reviewer subagent answers each Gate as `38-autopilot.md` says, and every Disposition is the brief's default |

## Process

| Member | Content |
|---|---|
| Executors | `source-reader`, `second-reader` (`claude-code/v1`, read-only, separate names so a Namespace puts a different model on each); `source-runner` (`parity/v1`: runs a suite level, reads its JUnit XML and coverage, applies mutants in a scratch copy); `tester`, `prd-agent`, `auditor` the SDLC pack's |
| Tasks `survey-source`, `inventory-source`, `reread-source` | inputs `source`, `brief`, `slice` (not on the survey), the last `inventory`, `previous`, `feedback`; output `inventory`; `workspace: {input: source}`; `reread-source` sees no inventory of this Slice |
| Task `confirm-survey` | human on `cli-human/v1`: the entry points and what they reach; cuts the Slices and their order |
| Task `audit-inventory` | Executor `auditor`; a sample of guards against the code at their `where`, plumbing labels sampled above all; a directory neither read nor `unread` |
| Task `write-characterization` | Executor `tester`, workspace the project; inputs `inventory`, `slice`, `brief`, the last `ledger`, `feedback`; output `written` (`files[]`, `suite`); the source reached through the `source` input's `locator.path`, which the level commands take as an argument |
| Task `run-source` | per suite level: its `run` with coverage, `reset` before each test; output a TestOutcome per level whose `head` is the checkout's commit, read from it, and the coverage report |
| Tasks `write-mutants`, `run-mutants` | the Tester writes one patch per reached item; the runner copies the checkout to `.persimmon/scratch/<taskRun>/`, applies each patch alone, runs the tests that reached the item, records killed or survived; a patch outside its item's `where` is refused |
| Task `recover-prd` | inputs `inventory`, `ledger`, `slice`, `brief`, `productId`, `rules?` (the last), `previous`, `previousRules`, `feedback`; outputs `prd`, `rules`: `draft-prd`'s output ports and ids, so every later run reads them as an authored pair |
| Task `confirm-recovery` | human on `cli-human/v1`: the Prd, the rules, the inventory and the ledger; one finding per wrong item, per Disposition that is not the default, per item to mark `dead`, per `PP-n` accepted, per open item accepted with its reason |
| Task `write-rewrite-driver` | Executor `tester`; inputs `suite`, the Slice's Designs, `feedback`; output the driver's files |
| Tasks `audit-driver`, `confirm-driver` | the auditor reads each method for anything that computes; the human confirms the mapping beside the Design |
| Task `run-rewrite` | the suite's tests through the rewrite's driver (or the source's, the interface kept) against the rewrite's app, started and reset by the TestHarness's `api` level commands |
| Task `compute-ledger` | Adapter `parity/v1`; inputs `inventory`, `written`, the TestOutcomes, the coverage report, the mutant results, `rules?`, the confirm findings, the last `ledger`; output its next revision |
| Gates | `survey-gate`, `inventory-gate`, `characterize-gate`, `recover-gate` (`confirmed` after the checks), `driver-gate`, `parity-gate` |
| ReviewLoops | `survey` (`maxRounds: 2`), `inventory` (2), `characterize` (3), `recover-prd` (3, `carry: {rules: previousRules}` as `author-prd`), `rewrite-driver` (2) |

A loop out of rounds hands on what passed: `characterize`'s open items go to `recover-prd` as open,
where the human marks each dead, dropped or accepted with its reason; any other loop out of rounds
stops the Slice with a report.

## Checks

`adapters/parity/`, an Adapter of its own beside `sdd/v1` and `testdesign/v1`, pure but for reading
the source checkout and the suite's reports. Every finding `error` unless marked.

| Code | Finding |
|---|---|
| `source-inside-project` | the checkout inside the project, the project inside the checkout, or both in one git repository: a rewrite in place is a refactor |
| `source-moved` | the checkout's commit is not the inventory's |
| `inventory-location` | a file `where` naming a file the checkout lacks, or a line past its end |
| `inventory-reference` | an id the inventory lacks, in any field that cites one |
| `id-sequence` | `SL-n`, `EP-n`, `ST-n`, `GD-n`, `DC-n`, `AB-n`, `PP-n`, `EN-n`, `EX-n`, `Q-n` not unique and increasing in document order |
| `branch-uncovered` | a branch line (the language's branch keywords, calibrated: COBOL with `INVALID KEY`, `AT END`, without `END-IF`, `ELSE` and comments) inside no guard's `where` and matching no `PP-n`; with a coverage report, any line the report gives branch counters inside no guard's `where` |
| `reader-disagreement` (warning) | on a static Slice: a guard whose `where` overlaps nothing the other reader recorded; the human resolves it at `recover-gate` |
| `coverage-unmapped` | a coverage report path that matches no checkout file by a unique path suffix |
| `item-open` | in `ledger-closure`: an item its Oracle can pin that is not pinned; the feedback names each with why (not reached, reached but mutant survived) |
| `test-reference` | a test name citing an id the inventory lacks |
| `unknown-inventory-item` | a rule's `source` or a capability's description naming an id the inventory lacks |
| `rule-unsourced` | an `active` rule whose `source` starts with neither `inventory:` nor `decision:` |
| `item-unaccounted` | after recovery: an `open` item |
| `entry-point-uncited` (warning) | an entry point no capability description and no `nonGoals` entry names |
| `expected-moved` | a test's expected value no longer the source's recorded answer, and no `change` rule cites an item the test targets |
| `driver-moved` | the source's driver changed after its Slice's `characterize-gate` passed, without the Slice characterized again |
| `driver-uncited` | a rewrite driver method citing no `EP-n` or no Design element; an entry point of the Slice with no method and no `drop` |
| `parity-unexplained` | a difference whose test targets no `change` or `drop` rule's item and no Issue cites |

A kept rule is an `active` rule whose `source` starts with `inventory:`; a rule sourced from
`decision:` is a change the Source system is not held to, and the Tester gives the tests that target
its items the new expected value, citing the rule.

## Rules

| Rule | Enforcer |
|---|---|
| the rewrite lives in the project, a repository of its own; the Source system is a checkout outside it, read-only, mutated only in scratch copies | `source-inside-project`; Executors; `run-mutants` |
| Characterization tests are written before any rule of their Slice is recovered, from the inventory, so an item no rule names still has a test | run order; `write-characterization` inputs |
| a Characterization test's expected value is the source's answer, kept in `answers[]`; it moves only for a `change` rule, by the Tester; the Builder never edits one | `expected-moved`; `characterize-rules`; `AGENTS.md` section 6 |
| every item is accounted for before the SDLC run order starts for the Slice | `recover-gate` (`item-unaccounted`) |
| a Disposition is recorded in the Prd and the rules, never in a kind of its own: `keep` leaves the item; `change` deprecates the rule and adds one with `source: "decision: ..."`; `drop` moves the capability to `nonGoals` with its reason | `recover-rules`; `confirm-recovery` |
| `domain-discovery` takes the inventory: a domain event is a state change in the source's words, a pivotal event a `status` change, a context is cut by language and events, never by package; a part of the source with no model boundary is `bigBallOfMud` | `storming-dsl` (inventory part) |
| an entity two Slices reach is a `contract` declaration of the Slice that writes it, pinned there | `survey-rules`; `item-open` |
| with the interface kept, an Adr taken first names the suite's `app` tool for the `api` level, so the rewrite's TestHarness takes it (`harness-rules` reads the Adrs first) | skill `rewrite` |
| a `parity-unexplained` difference is an `Issue`: the rule was recovered wrong, the test reads the source wrong, or the rewrite is wrong; never fixed by changing the Source system | `parity-gate`; `AGENTS.md` section 6 |
| `persimmon init --pack rewrite` applies the SDLC pack, then the Rewrite pack, and places both packs' files; the Rewrite pack ships no `AGENTS.md` | `persimmon init` |

## Changes outside the pack

Each its own unit, before the pack content that needs it:

| Change | Design file |
|---|---|
| `persimmon init --pack <name>`: the SDLC pack, then the named pack from `packs/<name>/` | `20-pack.md` |
| an optional `inventory` input on Task `event-storm` and Pipeline `domain-discovery`, handed to every phase, as `rules` was | `26-domain-discovery.md` |
| Adapter `parity/v1`: evaluator Role for the checks, executor Role for `run-source`, `run-mutants`, `run-rewrite` and `compute-ledger`; coverage read whole-repo with branch counters (JaCoCo, Cobertura, lcov), not over a Change set as `junit/v1` reads it | `40-pack-rewrite.md`, `19-adapter-roles.md` |

## Decisions

- A pack of its own, not a second entry into the SDLC pack: the run order differs before the Prd
  and after the build, and the Source system, the inventory, the Disposition and the parity check
  mean nothing to a product built from an idea. Packs have no dependencies (`20-pack.md`), so the
  Rewrite pack uses the SDLC pack's kinds and processes by name and `init --pack rewrite` installs
  both; copying them was refused, since two copies of the same kind drift. Found in design review.
- A rewrite is built in a new repository; an in-place change is a refactor and not this pack's. The
  Source system at its commit is the Oracle, so it must stay as it was for the whole rewrite, and a
  Slice cut over runs beside the Slices not yet rewritten. A rewrite sharing a monorepo with
  untouched old code would also keep that; the strict form is the one a check can enforce. Found in
  design review.
- Slices cut from a Survey, not the whole system at once. One program of the CardDemo pilot held 32
  to 38 guards; a whole system of thirty programs holds over a thousand, beyond one agent's context
  and one human's review, and a rule recovered wrong would surface months later in one big-bang
  parity check. A Slice is recovered, rebuilt, checked and cut over before the next. The risk a
  Slice brings, a rule crossing Slices through shared data, is a `contract` declaration pinned in
  the Slice that writes the data. Found in design review.
- Two new kinds. `Prd`, `BusinessRules`, `EventStorming`, `Glossary`, `BoundedContext`,
  `DomainModel` and the test kinds take a recovered system as they take an authored one; the facts
  read off the code and the accounting of every item have no home. The Survey is the inventory's
  first revision, not a kind. A rule's evidence goes in `source`, a string already there. Found in
  design review.
- The brief stays text, as `28-prd-process.md` decided; what a check needs is typed: `source`, `slice`.
  How the source runs is the suite's level commands, written by the Tester from the brief, not an
  input; the engine starts nothing (`harness-rules`). Found in design review.
- Behaviour, not knowledge, holds a rewrite to its source. The first cut ran tests derived from the
  recovered rules against the Source system after the build: a rule nobody recovered had no test, so
  parity passed while the rule was lost. Characterization tests now come first, from the inventory,
  their expected values the source's answers. Found in design review.
- Pinned is a killed mutant, and mutation is required. The second cut counted a guard tested when
  its line ran in a passing test; the JPetStore pilot showed that line covered in 20 passing tests
  none of which read its outcome. A mutant per reached item, written by the Tester and applied by the
  runner in a scratch copy, is the agent-extracts, check-decides split of `26-domain-discovery.md`,
  and it ties each item to the test that catches it, so coverage per run suffices. Found in the
  JPetStore pilot and in review.
- The Oracle is computed from what ran, per entry point, never declared: the suite level a passing
  test ran on says it. A `static` one reaches at best `concerns`; no design turns reading into proof.
  Found in design review.
- Every item, not only branches: CardDemo's retention limits, alternate-key uniqueness, job order and
  unconditional balance update are rules with no branch, and its closed-account status is a check
  the source never makes; an audit row, a message or an email is behaviour no response shows. Each
  is an inventory item with an account. Found in the CardDemo pilot and in review.
- Plumbing by pattern: CardDemo's 21 identical file status checks would be 21 human clicks; one
  accepted `PP-n` covers them, and `audit-inventory` samples plumbing labels first, since a
  mislabelled rule is the cheapest way to lose one. Found in the CardDemo pilot and in review.
- `branch-uncovered`, not a keyword count: a count fired on correct inventories in both pilots
  (eleven identical null checks as one guard; 21 two-`IF` status checks) and stayed silent on a
  keyword-less `Optional` guard. A branch line inside no guard's span gave CardDemo zero false
  findings and its one real miss. With a coverage report the tool's branch counters replace the
  keywords. Found in both pilots.
- A second reader on static Slices only, reading in another order, compared by overlapping spans: on
  CardDemo exact `where` matching gave 15 findings, 14 false; overlap gave 5, all real, one a guard
  without which a rule could not be stated. It is the same model, so it is a coverage aid, not
  independence, and its findings are warnings the human resolves. The review's cut was refused on
  this evidence. Found in the CardDemo pilot.
- The ledger is computed, never written by an agent, as the TestReport is (`39-test-process.md`), and
  it keeps the source's recorded answer per test, so a `change` rule cannot quietly rewrite the
  record. Found in review.
- Protocol drivers, not tests edited for the rewrite: an edited test can no longer run against the
  source, so its expected value loses its witness, and each of hundreds of edits can drift. A driver
  per system keeps one test file for both; the rewrite's driver is pure, audited and confirmed,
  because a driver that computes moves a rule into test code. The review's fold into the Tester's
  edits was refused for that reason. Found in design review.
- The agent extracts and a check decides, as in `26-domain-discovery.md`. AWS Transform, Thoughtworks'
  CodeConcise and Cognizant's seven-agent framework all put static analysis first and the model on
  translation; a pack ships YAML and a parser per language is not portable, so the agent runs
  whatever analyzer the workspace has, and `inventory-location`, `branch-uncovered` and the coverage
  report check what it gives. Found in research.
- The storming reads the inventory through an optional input, not a Rewrite pack copy of
  `event-storm`: an override must keep the ports (`20-pack.md`), and a Prd alone carries no command,
  event or entity of the source. Optional, so a product from an idea storms as before. Found in
  design review.
- The method is Prompts, not a `Skill`, as `26-domain-discovery.md` decided: pack YAML only, frozen in
  the snapshot, overridable per Namespace. A team with its own bundle (a vendor's COBOL reader)
  overrides the Task in its Namespace with a `skill` context entry; context is no port, so the
  override is allowed. Found in design review.
- The inventory before the Prd, and the Prd before the storming: `checkSubdomains` needs the Prd's
  subdomains to judge the storming's contexts (`34-subdomains.md`), and the inventory is the
  evidence both cite. One storming, not an as-is and a to-be: it runs after the Dispositions, over
  the inventory, cut by language and events, so the messy code's structure never becomes the
  model's. Found in design review.
- The suite's tool reaches the rewrite's TestHarness through an Adr taken first: `harness-rules` reads
  the Architecture's testing concepts and Adrs before the repository, and the rewrite's Architecture
  is new, so naming the tool there is the one path that needs no SDLC change. Found in review.
