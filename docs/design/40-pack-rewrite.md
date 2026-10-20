# Rewrite pack

status: draft · layer: 2 (`14-gate.md`, `20-pack.md`, `21-composition.md`, `23-pack-sdlc.md`, `26-domain-discovery.md`, `28-prd-process.md`, `31-architecture-process.md`, `39-test-process.md`) · schema: the `SourceInventory` and `ParityLedger` kinds in `packs/rewrite/global/10-artifact-kinds.yaml`, group `rewrite.persimmon.ai`

The developer names an existing system to rebuild in a new repository: the persimmon project is the
rewrite's, and the Source system is a checkout outside it, read and never changed. Changing the
Source system in its own repository is a refactor, not this pack's. Their agent surveys the whole
source once, then works Slice by Slice: it recovers what the code knows into the SDLC pack's
artifacts, a human decides what the rewrite keeps, and the SDLC pack's own processes rebuild it.

Two lines of evidence hold each Slice. Knowledge (the inventory, the rules, the storming) is what a
human reads and decides on. Behaviour (Characterization tests whose expected values are the Source
system's own answers) keeps the rules nobody recovered. A rule counts as pinned only when a test
that names it fails once the rule is mutated in a copy of the source; a line that merely ran proves
nothing. The promise: every difference between the Source system and the rewrite is intended or
found before the developer ships, and what no Oracle reached is listed in the ParityLedger, never
silent.

Every agent and every human step runs in a loop's `produce`; every Gate is a pure check over
artifacts and values (`14-gate.md`: a Gate takes no `externalResource`). What a check needs from
the checkout, a Task on `parity-run/v1` reads first into a value, the source index.

```text
developer: the project (the rewrite's repository), a source checkout outside it at one commit, brief (text), productId
  ─▶ ReviewLoop survey (once)
       produce: Workflow survey-work
                Task survey-source (source-reader)   ─▶ SourceInventory <productId>-inventory r1: entry points, what each reaches
                Task index-source (parity-run/v1)    ─▶ value sourceIndex
                Task cut-slices (human)              ─▶ value decisions: the Slices, their order, approved
                Task compute-ledger (parity-run/v1)  ─▶ ParityLedger <productId>-parity r1: the Slices
       review:  Gate survey-gate = survey-consistency (parity/v1), decided (cel: decisions.approved)
  per Slice SL-n, in the order the human set:
  ─▶ ReviewLoop inventory
       produce: Workflow inventory-work
                Task inventory-source (source-reader), Task reread-source (second-reader), blind to the first, another order
                Task index-source                    ─▶ value sourceIndex
                Task audit-inventory (auditor)       ─▶ value audit
       review:  Gate inventory-gate = inventory-consistency (parity/v1), audited (cel: audit.passed)
  ─▶ ReviewLoop characterize
       produce: Workflow characterize-work
                Task write-characterization (tester) ─▶ the suite: tests, the source's Protocol driver, its levels (none when nothing runs)
                Task run-source (parity-run/v1)      ─▶ value runs: each level's tests and observations on the source; value coverage
                Task write-mutants (tester)          ─▶ one patch per reached item
                Task run-mutants (parity-run/v1)     ─▶ each mutant killed, survived or invalid, in a scratch copy
                Task audit-mutants (auditor)         ─▶ value audit: a sample of patches against mutant-rules
                Task compute-ledger                  ─▶ ParityLedger next revision
       review:  Gate characterize-gate = ledger-closure (parity/v1), audited (cel)
  ─▶ ReviewLoop recover-prd
       produce: Workflow recover-work
                Task recover-prd (prd-agent)         ─▶ Prd <productId>-prd, BusinessRules <productId>-rules, next revisions
                Task audit-recovery (auditor)        ─▶ value audit
                Task decide-recovery (human)         ─▶ value decisions: Dispositions, dead, plumbing, accepted, approved
                Task compute-ledger                  ─▶ ParityLedger next revision: every item accounted for
       review:  Gate recover-gate = prd-consistency (sdd/v1), recovery-consistency (parity/v1), audited, decided (cel)
  ─▶ the SDLC run order for the Slice's capabilities, the inventory bound to the storming
       domain-discovery (base: the product's last model), architect (base: the product's last Architecture and Adrs),
       spec-all over the Slice's CAP-n, design-all, plan-all, setup-tests (first Slice), test-design-all, build-all
  ─▶ ReviewLoop parity
       produce: Workflow parity-work
                when the interface changes: Task write-rewrite-driver (tester), Task audit-driver (auditor)
                Task run-rewrite (parity-run/v1, the rewrite's app as the TestHarness's `app` starts it) ─▶ value runs on the rewrite
                Task compute-ledger                  ─▶ ParityLedger next revision: every difference with its cause, the verdict
                Task review-parity (human)           ─▶ value decisions: the rewrite driver confirmed, concerns accepted, approved
       review:  Gate parity-gate = parity-consistency (parity/v1), audited (cel), decided (cel)
  ─▶ cutover of the Slice: the developer's, outside the pack
```

## Survey and Slices

The Survey lists every entry point of the whole source and, for each, the files, entities and
external systems it reaches, without reading a guard. At `cut-slices` the human cuts Slices: sets
of entry points rewritten, checked and cut over together, in order. A Slice is small enough for one
agent's context and one human's review (the pilots: one batch program with 32 guards; eight Java
files with 29). An entity two Slices both reach is a contract between them: the earlier Slice
records its layout as a declaration (`kind: contract`) and pins it with a test, so a rewritten Slice
cannot break an old one still running beside it.

Ids count up across Slices: a later Slice cites an earlier Slice's `EN-n` or `ST-n` and never
redefines it. Each Slice adds a revision to the SourceInventory, the ParityLedger, the Prd and the
BusinessRules. A later Slice's runs take the product's last approved Prd, rules, model, Architecture
and Adrs as inputs of their own, since a loop's `previous` is its own last round only
(`21-composition.md`); `recovery-consistency` refuses a `CAP-n` the last Prd had and the new one
drops without a `drop` Disposition.

## Oracle

Where a Slice's expected behaviour comes from, computed per entry point from the suite level that
ran a passing test of it; never declared, never branched on. Every step of `characterize-work` runs
on every Slice: with no level that runs on the source, `run-source` and `run-mutants` run nothing,
and the ledger computes `static`. The verdict reads the weakest.

| Oracle | Suite level that held it | Characterization | Pinned when | What stays unproven |
|---|---|---|---|---|
| `running` | `app`: the source app, started and reset by the level's own commands | black-box tests at the source's interface through the source's Protocol driver | its mutant fails a test that names it | inputs no test sent |
| `partial` | `units`: the source's own toolchain, the app not started; the source's own tests count | unit tests calling the source's code | as `running` | entry points no unit reaches; the wiring between units |
| `recorded` | `records`: input and output pairs the source produced, given by the developer; run against the rewrite only | one test per record, the recorded output expected | never; `recover-prd` claims the guards a record shows | behaviour no record shows; every guard `unverified` |
| `static` | none | none | never | every guard `unverified`; the verdict is at best `concerns` |

`running` and `partial` need a coverage report: without one, an item is `unverified`, never
`complete`.

## Inputs

| Input | Shape | Why |
|---|---|---|
| `source` | `externalResource`: `locator.path` a checkout of the Source system outside the project, `version` its commit | the readers' and `parity/v1`'s workspace; provenance pins the commit every `where` is read at |
| `brief` | text | why the rewrite, the target stack and constraints, how the source runs (or that it does not), where records are, the default Disposition, whether the interface is kept; text, as `28-prd-process.md` decided |
| `productId` | string | stems every artifact id |
| `slice` | `SL-n` | the Slice a per-Slice run works on |

## `SourceInventory`

Facts read off the Source system at one commit, before any interpretation. A `where` is
`<path>`, `<path>:<line>` or `<path>:<from>-<to>` relative to the repository root, no leading `/`
or `..`, lines from 1, cut as `inventory-rules` says; or `{in: db|config|external, locator}` for
what lives only in a deployed database, a configuration store or another system. Every list is
present, empty when nothing was found, so two readers' inventories compare field by field.

| Field | Content |
|---|---|
| `source`, `slice?` | `{repository, commit}`; the Slice this revision read, absent on the Survey's |
| `entryPoints[]` | `{id EP-n, kind: http\|message\|job\|cli\|ui\|report, name, where[], reaches {files[], entities[] EN-n, externalSystems[] EX-n}}` |
| `stateChanges[]` | `{id ST-n, entity EN-n, change: create\|update\|delete\|status\|send, name, where[], from[] EP-n}`: a write that outlives the request (a row, a session, a file, a message, an email); candidate domain events |
| `guards[]` | `{id GD-n, condition, outcome, role: rule\|plumbing\|unknown, where[], in[] EP-n, volatile?: [time\|random\|order\|concurrency], note?}`: every branch that refuses, computes or decides; `time` only when the condition reads the clock, not a date the input carries |
| `declarations[]` | `{id DC-n, kind: key\|uniqueness\|retention\|ordering\|schema\|data\|config\|contract, statement, where[]}`: a rule stated without a branch |
| `absences[]` | `{id AB-n, statement, where[]}`: a check the source could make and does not, so its keeping or adding is decided, not assumed |
| `plumbingPatterns[]` | `{id PP-n, pattern, examples[] GD-n, where[]}`: one shape of plumbing, accepted once; `where` lists every occurrence, so a branch line it covers needs no guard of its own |
| `entities[]` | `{id EN-n, name, store?, where[]}` |
| `externalSystems[]` | `{id EX-n, name, direction: in\|out\|both, where[]}` |
| `tests[]` | `{name, where, covers[] EP-n\|GD-n}`: the source's own tests |
| `unread[]` | `{path, reason}`: what the agent did not read |
| `openQuestions[]` | `{id Q-n, question, resolution?}` |

## The source index

`index-source` reads the checkout into a value every check of the loop binds, so no Gate needs the
checkout: `{commit, dirty[], root, gitCommonDir, project: {root, gitCommonDir}, files: {<path>:
{lines, branchLines[] | null}}}`. `dirty` names every tracked file that differs from the commit, since
the facts must be the commit's. `root` and `project.root` are real paths, symlinks resolved;
`gitCommonDir` tells a worktree of the same repository apart from a second clone. Every tracked
regular file is indexed; a symlink is not followed. `branchLines` are the lines the language's
branch keywords start a branch on, calibrated per language (COBOL fixed and free format, with
`INVALID KEY`, `AT END`, `WHEN`, without `END-IF`, `ELSE`, comments and data names that contain a
keyword; strings and comments spanning lines left out), and `null` when the index cannot read them:
a language with no keyword table, a file too large to scan. `parity-run/v1` runs in the project
directory, so it knows `project.root` without an input.

## Decisions

A human's decision is a typed value a human Task answers (`cli-human/v1` validates it against the
port's schema), never prose `parity/v1` would have to parse. Findings stay prose and go back to the
agent as feedback.

| Task | `decisions` value |
|---|---|
| `cut-slices` | `{approved, findings[], slices[] {id SL-n, name, entryPoints[] EP-n, order}}` |
| `decide-recovery` | `{approved, findings[], dispositions[] {ref CAP-n\|BR-n\|AB-n, disposition: keep\|change\|drop, reason?}, dead[] {ref, evidence}, plumbing[] PP-n, accepted[] {ref, reason}, readers[] {ref, resolution}}` |
| `review-parity` | `{approved, findings[], driver?: {confirmed}, concerns?: {accepted, reason}}` |

`compute-ledger` writes each into the ledger as given; `recovery-consistency` refuses a Prd or rules
that disagree with them (a `drop` whose capability is not in `nonGoals`, a `change` whose rule is
not deprecated).

## `ParityLedger`

Computed by `parity-run/v1`, never written by an agent: the TestReport's rule (`39-test-process.md`).
One per Source system, a revision per step per Slice.

| Field | Content |
|---|---|
| `source`, `inventory`, `rules?`, `slice?` | the commit; the SourceInventory and BusinessRules as `{id, revision}`, so a ledger is never checked against a revision it was not computed from; the Slice of this revision, absent on the Survey's |
| `slices[]` | the human's cut, from `cut-slices` |
| `suite?` | `{levels {app?, units?, records?: {tool, run, one, reset?, junit, observations, testDir, coverage?}}, drivers {source, rewrite?}, conventions}`; `observations` is the JSON file a run writes, `{<test>: <what it observed>}`, so the ledger records what the source answered without reading a test; `levels` empty when nothing runs; absent before characterization |
| `entryPoints[]` | `{id EP-n, oracle}` |
| `items[]` | `{ref GD-n\|DC-n\|ST-n\|EX-n\|AB-n, slice, reached, pinnable, pinned, mutant?: killed\|survived\|invalid\|none, tests[], rules[] BR-n, disposition?, dead?, accepted?, plumbing? PP-n, reader?, account: complete\|unverified\|open, reason?}`: every decision a typed field, as given; `pinnable` its Oracle can pin it (a `running` or `partial` entry point, its lines measured, not volatile), `pinned` a test citing it and green on the source failed on its mutant, so a check reads the facts, never the reason's words |
| `answers[]` | `{test, observed}`: what the source answered, recorded when the test passed on it, never edited |
| `differences[]` | `{test, source, rewrite, cause?: {rule BR-n} \| {issue}}` |
| `unreached[]` | `{ref, slice, why}` |
| `decisions?` | `{dispositions[], dead[], plumbing[], accepted[], readers[]}`: every typed decision so far, as the human Tasks answered them, a later one for the same `ref` replacing an earlier; each revision recomputes every account with all of them, since a stage's human Task answers that stage's decisions only |
| `driver?`, `concerns?` | `{confirmed}`, `{accepted, reason}`: `review-parity`'s decisions, as given |
| `rewrite?` | `{tests, head?}`: how many recorded tests the rewrite run compared, and the rewrite's commit; absent until `parity`, so the parity gate never passes a ledger no rewrite was compared against |
| `verdict?` | `{result: pass\|concerns\|fail, rule}`: the Slice's, over its items, unreached entries and differences; absent on the Survey's |

`items[].tests` are the tests whose names cite the item or its entry point, an id cited by naming it
as a whole word (`test_EP2_GD2_add_in_stock` cites `EP-2` and `GD-2`); coverage says whether an item
was reached, never which test reached it. An item belongs to the Slice whose inventory revision first
lists it; a later Slice that reaches it again does not take it over.

| Item | `complete` when | `unverified` when |
|---|---|---|
| rule or unknown guard, declaration | ruled (a `BR-n` cites it) and pinned (its mutant killed), or dropped by a Disposition, or `dead` as a human decided | ruled, and its Oracle cannot pin it (`recorded`, `static`, `volatile` uncontrolled, no coverage), or a human accepted it open with a reason |
| plumbing guard | it matches a `PP-n` the human accepted and the inventory's audit found no rule among the sampled | never |
| state change, outbound external system | pinned: a test asserts it through the Protocol driver (the row, the message, the email) and its mutant (the write removed) is killed; or dropped | its Oracle cannot pin it |
| absence | a Disposition: `keep` (the rewrite does not check either) or `change` (a new rule) | never |

Anything else is `open`. `pass`: nothing `open`, nothing `unverified`, nothing `unreached`, no
difference without a cause. `concerns`: `unverified` or `unreached` only. `fail`: anything else.

A mutant is `killed` only when a test that cites the item itself passed on the source and `failed`
(an assertion, not an error) on the mutant: a test citing only the entry point asserts something
else there, so `run-mutants` names the tests that failed and the ledger counts only those citing the
item. `invalid` when the mutant does not build or start, or the patch breaks `mutant-rules`; an
`invalid` or `survived` mutant leaves the item `open`. Reached and pinned stay apart: in the
JPetStore pilot a stock guard's line ran in 20 passing tests and none read its outcome.

The difference check never rests on observations alone. Every test that passed on the source is
recorded in `answers[]`, its observation `null` when the run wrote none; on the rewrite, a test of
those that failed, did not run, or observed otherwise than recorded is a difference. A test that
failed on the source is no witness: its entry point is `unreached`, the Slice's first when it cites
none. A recorded test that observed nothing (its observation `null`) rests on its status alone: its
entry point is `unreached` too, so the verdict is at best `concerns`. `run-rewrite` runs every
recorded test, every Slice's, so an earlier Slice's regression shows; a test it leaves out is a
difference. It runs every level: a `units` test runs through the rewrite's driver to the rewrite's
code, and one the rewrite cannot run is a difference a human decides. A record runs on the rewrite
only: a `records` test that ran there holds its entry point's Oracle, and one not green there is a
difference, `source` `recorded`. A difference an Issue explains keeps that cause while it persists. An item a later
inventory revision no longer lists stays in the ledger, `open`, until a human decides it.

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
of five test fixes in the pilot) lives in one place. The suite keeps its own tool for the rewrite
too: the rewrite's own tests are the TestHarness's business, and the parity run starts the rewrite's
app with the TestHarness's `app` command. With the interface kept, the source's driver serves both.
A rewrite driver that computes would move a rule into test code, so it renames, reshapes, selects
and converts formats only; one call may become several, never a value.

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
| `mutant-rules` | one patch per reached item, inside its `where` only: a guard's condition negated or its boundary moved, a handler removed, a write deleted, a declaration dropped; never a new `throw`, `raise`, `exit`, `panic`, `abort` or `STOP RUN`, never a change a test cannot observe through the driver |
| `recover-rules` | evidence ranks observed (a Characterization test) over read (the code) over said (docs, comments, names); a rule states one item or several in RuleSpeak with `source: "inventory: GD-n, DC-n, ST-n, ..."` and names its tests in `examples`; plumbing is no rule; behaviour the tests show and no item explains is a `Q-n`; every absence gets a proposed Disposition; the product's last Prd and rules carried forward whole; the brief's default Disposition holds until the human decides otherwise |
| `recovery-review` | for the human's form and the Reviewer subagent: accuracy first, then each Disposition; a `drop` names its reason; a `dead` needs the evidence the ledger shows; an accepted open item names why no test can reach it |
| `driver-rules` | the rewrite driver renames, reshapes, selects and converts; never arithmetic, never a branch on a value, never a call the operation does not need; each method cites its `EP-n` and the Design element it lands on |
| skill `rewrite` | `files/.claude/skills/rewrite/SKILL.md` and its `driving.md`: the run order above per Slice, each run's inputs including the product's last approved artifacts; then `autopilot-doc`'s and `autopilot-code`'s order for the Slice's capabilities; with `--autopilot` a Reviewer subagent answers each human Task as `38-autopilot.md` says, and every Disposition is the brief's default |

## Process

| Member | Content |
|---|---|
| Executors | `source-reader`, `second-reader` (`claude-code/v1`, read-only, separate names so a Namespace puts a different model on each); `source-runner` (`parity-run/v1`); `tester`, `prd-agent`, `auditor` the SDLC pack's; `local-reviewer` (`cli-human/v1`) for the human Tasks |
| Tasks `survey-source`, `inventory-source`, `reread-source` | inputs `source`, `brief`, `slice` (not on the survey), the last `inventory`, `previous`, `feedback`; output `inventory`; `workspace: {input: source}`; `reread-source` sees no inventory of this Slice and answers a second `inventory` value the check compares |
| Task `index-source` | `parity-run/v1`, `workspace: {input: source}`; output value `sourceIndex` |
| Task `audit-inventory` | Executor `auditor`; a sample of guards against the code at their `where`, plumbing labels sampled first; a directory neither read nor `unread`; output value `audit` (a ValidationResult) |
| Task `write-characterization` | Executor `tester`, workspace the project; inputs `inventory`, `slice`, `brief`, the last `ledger`, `feedback`; output value `written` (`files[]`, `suite`); the source reached through the `source` input's `locator.path`, which the level commands take as an argument |
| Task `run-source` | `parity-run/v1`, workspace the project; per suite level that runs on the source (`app`, `units`; `records` runs on the rewrite only): its `reset`, then its `run` with the checkout's path in `PERSIMMON_SOURCE`; outputs value `runs`, `[{level, command, exitCode, head, tests[] {name, status}, observations, reason?, outputTail?}]`, the reason and the output's tail when no test was read or a failed `reset` kept the level from running (it measures nothing on data it could not restore), the checkout refused unless still the indexed commit, unchanged, and every secret the run had redacted from what it answers, `head` the checkout's commit, `[]` when none ran, and value `coverage` (`{<path>: {<line>: {hits, branches?}}}`, mapped onto the index by unique suffix, `unmapped[]` beside), `{files: {}, unmapped: []}` when none ran: every declared output is answered (`12-task.md`). A value, not a `TestOutcome`: that kind's `level` is a test level of the SDLC pack's, and `app`, `units` and `records` are none; resetting between tests is the suite's own fixture, its `conventions` say how |
| Tasks `write-mutants`, `run-mutants`, `audit-mutants` | the Tester writes one patch per reached item (value `mutants`, `[{ref, patch}]`); the runner clones the checkout to `.persimmon/scratch/<taskRun>/`, applies each patch alone to a clean clone (`git clean -x`, so no build output of the last mutant stays), and holds what the clone then differs in, read from git, not from the patch text, to the item's `where`: every changed or inserted line inside one of its spans, no file created, renamed or binary, no crash added (`mutant-rules`' list); anything else is `invalid`. It reruns alone, after the level's `reset`, each test green on the source that cites the item, the test's name in `PERSIMMON_TEST` (a `one` command writes `{test}`, which becomes `"$PERSIMMON_TEST"`), and records killed (naming the tests that failed), survived or invalid in input order (value `mutantResults`); a failed reset makes the mutant `invalid`. The auditor samples patches for crashes no list names (a division by zero, a null dereference, an endless loop) and for changes no test can observe |
| Task `recover-prd` | inputs `inventory`, `ledger`, `slice`, `brief`, `productId`, `prd?` and `rules?` (the product's last approved), `previous`, `previousRules`, `feedback`; outputs `prd`, `rules`: `draft-prd`'s output ports and ids, so every later run reads them as an authored pair |
| Tasks `audit-recovery`, `audit-driver` | Executor `auditor`; value `audit`: the Prd against the inventory and the tests (a rule the tests contradict, a capability with no entry point); the rewrite driver against `driver-rules` |
| Human Tasks `cut-slices`, `decide-recovery`, `review-parity` | `cli-human/v1`; each answers the `decisions` value its row of Decisions says, its schema written inline (a port schema takes no `$ref` beyond the well-known ones, `10-ports.md`); the form shows the audit beside the artifacts; `produce` runs each round, so the human answers once per round |
| The Tester's Tasks | the SDLC pack's Executor `tester` is a human one by default (`cli-human/v1`, the developer's agent in a fresh subagent), so its Tasks answer values, never `artifacts`; a Namespace that puts it on `claude-code/v1` read-only may find reads outside the workspace refused, and the source is read through the `source` input's `locator.path` |
| Task `write-rewrite-driver` | Executor `tester`; inputs `suite`, the Slice's Designs, `feedback`; output value `written` (the driver's files); `written.driver` is `{methods[] {name, entryPoint EP-n, element EL-n}}`, one method per operation of the source's driver, each citing the entry point it serves and the Design element it lands on |
| Task `run-rewrite` | `parity-run/v1`: every level's tests through the rewrite's driver (or the source's, the interface kept) against the rewrite, its app started by the TestHarness's `app.start` and awaited at `app.ready` (refused without them), with `PERSIMMON_TARGET=rewrite`; value `runs` as `run-source`'s, `head` the project's commit only when no tracked file differs from it |
| Task `compute-ledger` | `parity-run/v1`; inputs `inventory`, `sourceIndex`, `written`, `slice?`, `runs` (the source's), `rewriteRuns?` (the rewrite's, in `parity`), `coverage`, `mutantResults`, `rules?`, `decisions`, the last `ledger`; output its next revision under `outputIds.ledger`, `<productId>-parity` (refused without it) |
| Gates | `survey-gate`, `inventory-gate`, `characterize-gate`, `recover-gate`, `parity-gate`: pure, over the loop's artifacts and values |
| ReviewLoops | `survey` (`maxRounds: 2`), `inventory` (2), `characterize` (3), `recover-prd` (3, `carry: {rules: previousRules}` as `author-prd`), `parity` (2) |

A loop out of rounds still publishes its last revision (`23-pack-sdlc.md`). For `characterize`
only, the skill goes on to `recover-prd` with it: its open items reach `decide-recovery`, where the
human decides each dead, dropped or accepted. Any other loop out of rounds stops the Slice with a
report.

## Checks

`adapters/parity/` holds two Adapters, as `sdd/v1` and `testdesign/v1` split the SDLC pack's: `parity/v1`,
the evaluator Role, pure over artifacts and values; and `parity-run/v1`, the executor Role (type
`script`) for `index-source`, `run-source`, `run-mutants`, `run-rewrite` and `compute-ledger`, one
Adapter process answering one Role (`adapters/lib/agent.mjs` serves `executor` only). Every finding `error` unless marked.

| Code | Finding | In |
|---|---|---|
| `source-inside-project` | `sourceIndex.root` inside `project.root` or the reverse, or the two share a `gitCommonDir`: a rewrite in place is a refactor | every gate with a `sourceIndex` |
| `source-moved` | `sourceIndex.commit` is not the inventory's, or `dirty` names a changed file | same |
| `inventory-location` | a file `where` or a `reaches.files` path naming a file the index lacks, a line past its end, a range that runs backwards; a Slice the cut lacks | `survey-consistency`, `inventory-consistency` |
| `branch-unread` (warning) | a file the Slice reaches whose branch lines the index could not read; its guards rest on the readers alone | `inventory-consistency` |
| `inventory-reference` | an id the inventory lacks, in any field that cites one | `survey-consistency`, `inventory-consistency` |
| `id-sequence` | `SL-n`, `EP-n`, `ST-n`, `GD-n`, `DC-n`, `AB-n`, `PP-n`, `EN-n`, `EX-n`, `Q-n` not unique and increasing in document order | same |
| `slice-cut` | an entry point in no Slice or in two | `survey-consistency` |
| `branch-uncovered` | a branch line of a file the Slice reaches, inside no guard's or `PP-n`'s line `where` (a whole-file `where` covers no line); with `coverage`, also a line it gives branches on | `inventory-consistency`; `ledger-closure` with coverage |
| `reader-disagreement` (warning) | a guard of one reader whose `where` overlaps nothing the other recorded; the human settles each in `decisions.readers` | `inventory-consistency` |
| `coverage-unmapped` | a coverage path that matches no indexed file by a unique path suffix | `ledger-closure` |
| `item-open` | an item of the Slice its Oracle can pin that is not pinned; the feedback names each with why (not reached, survived, invalid) | `ledger-closure` |
| `test-reference` | a test name citing an id the inventory lacks | `ledger-closure` |
| `unknown-inventory-item` | a rule's `source` or a capability's description naming an id the inventory lacks | `recovery-consistency` |
| `rule-unsourced` | an `active` rule whose `source` starts with neither `inventory:` nor `decision:` | same |
| `capability-dropped` | a `CAP-n` of the product's last Prd absent from the new one and from its `nonGoals` | same |
| `disposition-mismatch` | the Prd or the rules disagree with `decisions` | same |
| `item-unaccounted` | an `open` item of any Slice after the decisions: an earlier Slice's item the inventory dropped stays open until decided, and each recovery gate sees it | same |
| `entry-point-uncited` (warning) | an entry point of the Slice no capability description and no `nonGoals` entry names | same |
| `expected-moved` | a test's expected value no longer the source's recorded answer, and no `change` rule cites an item the test targets | `ledger-closure` (on the rewrite, a moved answer is a difference) |
| `driver-uncited` | a rewrite driver method citing no `EP-n` or no Design element; an entry point of the Slice with no method and no `drop` | `parity-consistency` |
| `parity-unexplained` | a difference whose test targets no `change` or `drop` rule's item and no Issue cites | same |
| `parity-verdict` | the ledger's verdict `fail`, or `concerns` that `decisions.concerns` did not accept | same |

A kept rule is an `active` rule whose `source` starts with `inventory:`; a rule sourced from
`decision:` is a change the Source system is not held to, and the Tester gives the tests that target
its items the new expected value, citing the rule.

## Rules

| Rule | Enforcer |
|---|---|
| the rewrite lives in the project, a repository of its own; the Source system is a checkout outside it, read-only, mutated only in scratch copies | `source-inside-project`; Executors; `run-mutants` |
| no Gate reads the checkout: what a check needs is the `sourceIndex` value a Task read before it | Gates take `artifact` and `value` only (`14-gate.md`) |
| a human decides through a typed `decisions` value, in `produce`, never through a Gate finding the ledger would parse | Tasks `cut-slices`, `decide-recovery`, `review-parity` |
| Characterization tests are written before any rule of their Slice is recovered, from the inventory, so an item no rule names still has a test | run order; `write-characterization` inputs |
| a Characterization test's expected value is the source's answer, kept in `answers[]`; it moves only for a `change` rule, by the Tester; the Builder never edits one | `expected-moved`; `characterize-rules`; `AGENTS.md` section 6 |
| every item is accounted for before the SDLC run order starts for the Slice | `recover-gate` (`item-unaccounted`) |
| a Disposition is recorded in the Prd and the rules as well as the ledger: `keep` leaves the item; `change` deprecates the rule and adds one with `source: "decision: ..."`; `drop` moves the capability to `nonGoals` with its reason | `recover-rules`; `disposition-mismatch` |
| `domain-discovery` takes the inventory: a domain event is a state change in the source's words, a pivotal event a `status` change, a context is cut by language and events, never by package; a part of the source with no model boundary is `bigBallOfMud` | `storming-dsl` (inventory part) |
| an entity two Slices reach is a `contract` declaration of the Slice that writes it, pinned there | `survey-rules`; `item-open` |
| a `parity-unexplained` difference is an `Issue`: the rule was recovered wrong, the test reads the source wrong, or the rewrite is wrong; never fixed by changing the Source system | `parity-gate`; `AGENTS.md` section 6 |
| `persimmon init --pack rewrite` installs the SDLC pack, then the Rewrite pack; the Rewrite pack ships no `AGENTS.md` and redefines nothing of the SDLC pack's | `persimmon init` (`20-pack.md`) |

## Changes outside the pack

Each its own unit, before the pack content that needs it:

| Change | Design file | State |
|---|---|---|
| `persimmon init --pack <name>`: the SDLC pack, then the named pack | `20-pack.md` | landed |
| an optional `inventory` value input (the inventory's content: a value, so the SDLC pack names no Rewrite pack kind) on Task `event-storm`, the storming ReviewLoops and Pipeline `domain-discovery`, handed to every phase, as `rules` was; an optional `base` on the Pipeline, bound to `storm-big-picture`'s `base`, the product's last model | `26-domain-discovery.md` | to do |
| optional `base` and `baseAdrs` on Task `write-architecture` and ReviewLoop `architect`, the product's last Architecture and Adrs: previous, else base, as `event-storm` reads them | `31-architecture-process.md` | to do |
| Adapters `parity/v1` (evaluator) and `parity-run/v1` (executor); coverage read whole-repo with branch lines (JaCoCo, Cobertura, lcov), not over a Change set as `junit/v1` reads it | `40-pack-rewrite.md`, `19-adapter-roles.md` | to do |

## Decisions

- A pack of its own, not a second entry into the SDLC pack: the run order differs before the Prd
  and after the build, and the Source system, the inventory, the Disposition and the parity check
  mean nothing to a product built from an idea. Packs have no dependencies (`20-pack.md`), so the
  Rewrite pack uses the SDLC pack's kinds and processes by name and `init --pack rewrite` installs
  both; copying them was refused, since two copies of the same kind drift. Found in design review.
- A rewrite is built in a new repository; an in-place change is a refactor and not this pack's. The
  Source system at its commit is the Oracle, so it must stay as it was for the whole rewrite, and a
  Slice cut over runs beside the Slices not yet rewritten. Found in design review.
- Slices cut from a Survey, not the whole system at once. A whole system of thirty programs holds
  over a thousand guards, beyond one agent's context and one human's review, and one big-bang
  parity check finds a rule recovered wrong months late. The risk a Slice brings, a rule crossing
  Slices through shared data, is a `contract` declaration pinned in the Slice that writes the data.
  Found in design review.
- Two new kinds. `Prd`, `BusinessRules`, `EventStorming`, `Glossary`, `BoundedContext`,
  `DomainModel` and the test kinds take a recovered system as they take an authored one; the facts
  read off the code and the accounting of every item have no home. The Survey is the inventory's
  first revision, not a kind. A rule's evidence goes in `source`, a string already there. Found in
  design review.
- The brief stays text, as `28-prd-process.md` decided; what a check needs is typed: `source`, `slice`,
  the `decisions` values. How the source runs is the suite's level commands, written by the Tester
  from the brief; the engine starts nothing (`harness-rules`). Found in design review.
- Behaviour, not knowledge, holds a rewrite to its source. Tests derived from the recovered rules
  let a rule nobody recovered pass unnoticed; Characterization tests come first, from the inventory,
  their expected values the source's answers. Found in design review.
- Pinned is a killed mutant, and mutation is required. A line that ran in 20 passing tests none of
  which read its outcome (the JPetStore pilot) is reached, not pinned. A mutant counts as killed only
  when a test citing the item fails on an assertion, so a patch that breaks the build or crashes the
  app pins nothing; the token list and the audited sample keep a Tester from writing mutants that
  are easy to kill and prove nothing. Found in the JPetStore pilot and in review.
- Two Adapters, not one with two Roles: the shared runner serves the executor Role only, and the SDLC
  pack already splits a pack's checks (`sdd/v1`) from its computing Tasks (`testdesign/v1`). Found in
  implementation.
- No Gate reads the checkout: `14-gate.md` takes `artifact` and `value` inputs only, and a `task`
  Validator's inputs must equal the Validator's. A Task on `parity-run/v1` reads the checkout into the
  source index first, and every check is pure over it. Found in review.
- Every agent and human step in `produce`, every Gate pure. With a human Validator `after` a
  consistency check, the first round's open items failed the check, the human was skipped
  (`14-gate.md`), and no round could ever reach the human who alone closes them. Found in review.
- A human decides through a typed value, not a finding: the ledger is computed, and computing it
  from prose would be the guess a computed ledger exists to avoid. Found in review.
- A later Slice takes the product's last Prd, rules, model, Architecture and Adrs as inputs of their
  own: a loop's `previous` is its own last round (`21-composition.md`), so Slice 2 would start from
  nothing and drop Slice 1's capabilities silently. `capability-dropped` refuses that. Found in review.
- The Oracle is computed from what ran, per entry point, never declared and never branched on: every
  step runs on every Slice and does nothing where nothing runs. A `static` Slice reaches at best
  `concerns`; no design turns reading into proof. Found in review.
- Every item, not only branches: CardDemo's retention limits, alternate-key uniqueness, job order and
  unconditional balance update are rules with no branch, and its closed-account status is a check
  the source never makes; an audit row, a message or an email is behaviour no response shows. Each
  is an inventory item with an account. Found in the CardDemo pilot and in review.
- Plumbing by pattern: CardDemo's 21 identical file status checks would be 21 human decisions; one
  accepted `PP-n` covers them, and the inventory's audit samples plumbing labels first, since a
  mislabelled rule is the cheapest way to lose one. Found in the CardDemo pilot and in review.
- `branch-uncovered`, scoped to the files the Slice reaches, not a keyword count: a count fired on
  correct inventories in both pilots and stayed silent on a keyword-less `Optional` guard. A branch
  line inside no guard's span gave CardDemo zero false findings and its one real miss. Found in both
  pilots and in review.
- A second reader on every Slice, reading in another order, compared by overlapping spans: on
  CardDemo exact matching gave 15 findings, 14 false; overlap gave 5, all real, one a guard without
  which a rule could not be stated. It is the same model, so it is a coverage aid, not independence;
  its findings are warnings the human settles. Running it on every Slice avoids branching on an
  Oracle not yet computed. The reviews' cut was refused on this evidence. Found in the CardDemo pilot.
- The ledger keeps the source's recorded answer per test, so a `change` rule cannot quietly rewrite
  the record. Found in review.
- Protocol drivers, not tests edited for the rewrite: an edited test can no longer run against the
  source, so its expected value loses its witness. The rewrite's driver is pure, audited and
  confirmed, because a driver that computes moves a rule into test code. The suite keeps its own
  tool; the rewrite's TestHarness needs none of it. Found in design review and in review.
- The verdict gates: `parity-verdict` refuses `fail`, and `concerns` passes only when the human
  accepted them with a reason. Found in review.
- Kept against the reviews' cuts: absences (CardDemo's closed account is a decision a `Q-n` would
  not force), `role: unknown` (CardDemo needed it once), plumbing patterns (21 decisions become one),
  the `records` Oracle (a batch report often has no other witness). Found in review.
- The agent extracts and a check decides, as in `26-domain-discovery.md`. AWS Transform, Thoughtworks'
  CodeConcise and Cognizant's seven-agent framework all put static analysis first and the model on
  translation; a pack ships YAML and a parser per language is not portable, so the agent runs
  whatever analyzer the workspace has, and the index, the coverage and the mutants check what it
  gives. Found in research.
- The method is Prompts, not a `Skill`, as `26-domain-discovery.md` decided. A team with its own
  bundle overrides the Task in its Namespace with a `skill` context entry; context is no port, so
  the override is allowed. Found in design review.
- The inventory before the Prd, and the Prd before the storming: `checkSubdomains` needs the Prd's
  subdomains to judge the storming's contexts (`34-subdomains.md`). One storming, not an as-is and a
  to-be: it runs after the Dispositions, over the inventory, cut by language and events, so the
  messy code's structure never becomes the model's. Found in design review.
