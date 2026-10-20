# Rewrite pack

status: draft · layer: 2 (`20-pack.md`, `23-pack-sdlc.md`, `26-domain-discovery.md`, `28-prd-process.md`, `39-test-process.md`) · schema: the `SourceInventory` and `ParityLedger` kinds in `packs/rewrite/global/10-artifact-kinds.yaml`

The developer names an existing system to rebuild. Their agent recovers what its code knows into
the SDLC pack's artifacts, a human decides what the rewrite keeps, and the SDLC pack's own processes
rebuild it. Two lines of evidence hold it: knowledge (the inventory, the rules, the storming), which a
human can read and decide on, and behaviour (Characterization tests whose expected values are the
Source system's own answers), which keeps the rules nobody recovered. The promise: every difference
between the Source system and the rewrite is intended or found before the developer ships, and what
no Oracle reached is listed in the ParityLedger, never silent.

```text
developer: source checkout at one commit, brief (text), productId, Oracle inputs (sourceApp, sourceUnits, records: any, or none)
  ─▶ ReviewLoop inventory
       produce: Task inventory-source (source-reader) ─▶ SourceInventory <productId>-inventory
                when an entry point's Oracle is static, also Task reread-source (second-reader), blind to the first
       review:  Gate inventory-gate = inventory-consistency (parity/v1), then inventory-audited
  ─▶ ReviewLoop characterize                              skipped when the Oracle is static throughout
       produce: Workflow characterize-work
                Task write-characterization (tester)  ─▶ the tests, the suite
                Task run-source (source-runner)       ─▶ TestOutcome on the source, its coverage report
                Task mutate-source (source-runner)    ─▶ mutants killed or survived, when asked
                Task compute-ledger (parity/v1)       ─▶ ParityLedger <productId>-parity r1
       review:  Gate characterize-gate = ledger-closure (parity/v1); the open guards are the next round's feedback
  ─▶ ReviewLoop recover-prd
       produce: Task recover-prd (prd-agent)          ─▶ Prd <productId>-prd, BusinessRules <productId>-rules
       review:  Gate recover-gate = prd-consistency, recovery-consistency (parity/v1), then prd-audited,
                then recovery-confirmed (human: is this what the source does; a Disposition per item)
       Task compute-ledger                            ─▶ ParityLedger r2: every guard accounted for
  ─▶ the SDLC run order from domain-discovery to build-all, the inventory bound to the storming
  ─▶ Workflow parity
       Task write-translation (tester), when the brief changes the interface
       Task run-rewrite (source-runner over the rewrite's app) ─▶ TestOutcome on the rewrite
       Task compute-ledger                            ─▶ ParityLedger r3: every difference with its cause
       Gate parity-gate = parity-explained (parity/v1)
```

## Oracle

Where the expected behaviour comes from, per entry point. The developer gives what exists; several
can hold at once (an API `running`, a monthly report `recorded`). The ledger reports each entry
point's strongest, and the verdict reads the weakest.

| Oracle | The developer gives | Characterization | A guard counts as tested when | What stays unproven |
|---|---|---|---|---|
| `running` | `sourceApp {start, ready, coverage?}` | black-box tests at the source's interface, expected values read off its answers | the coverage report shows its line ran in a passing test (both outcomes with branch data); without a report, a test names it and the ledger marks it `unmeasured` | inputs no test sent |
| `partial` | `sourceUnits {run, junit, coverage?}`: a harness in the source's own toolchain | unit tests calling the source's code where the app cannot start | as `running` | entry points no unit reaches; the wiring between units |
| `recorded` | `records {path, format}`: input and output pairs the source produced (exports, reports, logs) | one test per record, run against the rewrite only, the recorded output expected | never on the source; a record's guards are claimed by `recover-prd` and marked `unmeasured` | behaviour no record shows |
| `static` | nothing more | none | never; a second reader, blind to the first, must find the same guards | every rule guard stays `unverified`; the verdict is at best `concerns` |

## Inputs

| Input | Shape | Why |
|---|---|---|
| `source` | `externalResource`: `locator.path` a checkout of the Source system, `version` its commit | the readers' workspace; provenance pins the commit every `where` is read at |
| `brief` | text | why the rewrite, the target stack and constraints, the default Disposition, whether the interface is kept, what is out of scope; text, as `28-prd-process.md` decided |
| `productId` | string | stems every artifact id |
| `sourceApp`, `sourceUnits`, `records` | values, optional, as the Oracle table says | the Oracles the developer can give |
| `mutate` | boolean, default `false` | run `mutate-source` |

## `SourceInventory`

Facts read off the Source system at one commit, before any interpretation. A `where` is
`<path>:<line>` or `<path>:<from>-<to>`, relative to the repository root.

| Field | Content |
|---|---|
| `source` | `{repository, commit}` |
| `entryPoints[]` | `{id EP-n, kind: http\|message\|job\|cli\|ui\|report, name, where[]}`: where the outside starts work; candidate commands |
| `stateChanges[]` | `{id ST-n, entity EN-n, change: create\|update\|delete\|status, name, where[], from[] EP-n}`: a write that persists; candidate domain events, a `status` change a candidate pivotal one |
| `guards[]` | `{id GD-n, condition, outcome, role: rule\|plumbing\|unknown, where[], in[] EP-n, time?}`: every branch that refuses, computes or decides; `time` when the condition reads a date or a clock |
| `entities[]` | `{id EN-n, name, store?, where[]}`: what is persisted, in the source's names |
| `externalSystems[]` | `{id EX-n, name, direction: in\|out\|both, where[]}` |
| `tests[]` | `{name, where, covers[] EP-n\|GD-n}`: the source's own tests, the behaviour its team checked |
| `unread[]` | `{path, reason}`: what the agent did not read, so a gap is visible instead of silent |
| `openQuestions[]` | `{id Q-n, question, resolution?}` |

## `ParityLedger`

Computed by `parity/v1`, never written by an agent: the TestReport's rule (`39-test-process.md`).

| Field | Content |
|---|---|
| `source`, `inventory`, `rules?` | the commit, the SourceInventory id, the BusinessRules id once recovered |
| `suite` | `{tool, run, one, junit, testDir, conventions}`: the Characterization tests' harness, from `write-characterization` |
| `entryPoints[]` | `{id EP-n, oracle: running\|partial\|recorded\|static}` |
| `guards[]` | `{id GD-n, role, tests[], measured, mutant?: killed\|survived, rules[] BR-n, disposition?, dead?, account: complete\|unverified\|open, reason?}` |
| `differences[]` | `{test, source, rewrite, cause?: {rule BR-n} \| {issue}}`: a test whose answer on the rewrite is not the source's |
| `unreached[]` | `{ref EP-n\|GD-n, why}`: what no Oracle reached |
| `verdict` | `{result: pass\|concerns\|fail, rule}` |

A rule guard's `account` is `complete` when it is ruled (a `BR-n` cites it) and tested (where its
Oracle can test), or `dropped` by a Disposition, or `dead` as a human confirmed; `unverified` when
ruled but no Oracle can test it; `open` otherwise. A plumbing guard is `complete` once a human
accepted its role. `pass`: no `open` guard, no `unverified` rule guard, no difference without a
cause. `concerns`: `unverified` rule guards only. `fail`: anything else.

## Method

What the agents are taught, as Prompts the pack ships, one per Task, overridable in a Namespace.

| Prompt | Teaches |
|---|---|
| `source-reading` | where rules hide, per common stack: validators and framework annotations, ORM mappings and constraints, SQL in strings, stored procedures and triggers, configuration and feature flags, reflection and dependency wiring, scheduled jobs, message handlers, report queries; COBOL `EVALUATE` and `PERFORM`, copybooks, JCL steps; what is plumbing (null checks, retries, logging) and what only looks like it |
| `inventory-rules` | facts only, in the source's names: a guard says what the code tests and what follows, not what it is for; every item has a `where`; generated, vendored and fixture code is `unread` with its reason; the agent may run any analyzer the workspace has and records only what it read |
| `characterize-rules` | record, never judge: the expected value is what the source answered, a bug included; per guard, an input on each side of its boundary, and generated inputs where the toolchain has a property-based tool; a `time` guard is tested on each side of its date with the clock controlled (an injected clock, faketime), or left `open` with `clock-uncontrolled`; each test is named with the `EP-n` and `GD-n` it targets; data set up and reset per test |
| `recover-rules` | evidence ranks observed (a Characterization test) over read (the code) over said (docs, comments, names); a rule states one guard or several in RuleSpeak with `source: "inventory: GD-n, ..."` and names its tests in `examples`; plumbing is no rule; behaviour the tests show and no guard explains is a `Q-n`; the brief's default Disposition holds until the human says otherwise |
| `recovery-review` | for the human's form and the Reviewer subagent: accuracy first (is this what the source does), then Disposition; a `drop` names its reason; a `dead` guard needs the evidence the ledger shows |
| skill `rewrite` | `files/.claude/skills/rewrite/SKILL.md` and its `driving.md`: the run order above, each run's inputs, then `autopilot-doc`'s and `autopilot-code`'s order from `domain-discovery`; with `--autopilot` a Reviewer subagent answers each Gate as `38-autopilot.md` says, and every Disposition is the brief's default |

## Process

| Member | Content |
|---|---|
| Executors | `source-reader`, `second-reader` (`claude-code/v1`, read-only, separate names so a Namespace puts a different model on each); `source-runner` (`junit/v1`, runs a suite and reads its JUnit XML and coverage); `tester`, `prd-agent`, `auditor` the SDLC pack's |
| Task `inventory-source`, `reread-source` | inputs `source`, `brief`, `previous`, `feedback`; output `inventory`; `workspace: {input: source}`; `reread-source` sees no inventory |
| Task `audit-inventory` | Executor `auditor`; a sample of guards and state changes against the code at their `where`; a directory with code that is neither read nor `unread` |
| Task `write-characterization` | Executor `tester`; inputs `inventory`, the Oracle values, `ledger` (the last), `feedback`; output `written` (`files[]`, `suite`); writes into the project's repository, never the source |
| Task `run-source` | runs the suite against `sourceApp` or `sourceUnits`; output a TestOutcome whose `head` is the source commit, and the coverage report |
| Task `mutate-source` | per rule guard a test covers: its condition flipped in a scratch copy of the checkout, the covering tests run; never the checkout itself |
| Task `recover-prd` | inputs `inventory`, `ledger`, `brief`, `productId`, `previous`, `previousRules`, `feedback`; outputs `prd`, `rules`: the ports and ids of `draft-prd`, so every later run reads them as an authored pair |
| Task `confirm-recovery` | human on `cli-human/v1`: reads the Prd, the rules, the inventory and the ledger; one finding per wrong item, per Disposition that is not the default, per guard to mark `dead` or `plumbing` |
| Task `write-translation` | Executor `tester`, when the brief changes the interface: per test level, the mapping from the source's requests and answers to the rewrite's, each mapping citing a `Design` element; confirmed by a human |
| Task `run-rewrite` | the suite, through the translation if any, against the rewrite's app as the TestHarness starts it |
| Task `compute-ledger` | Adapter `parity/v1`; inputs `inventory`, `written`, the TestOutcomes, the coverage report, mutants, `rules?`, the confirm findings; output the ParityLedger's next revision |
| Gates | `inventory-gate`; `characterize-gate`; `recover-gate` (`confirmed` after the three checks); `parity-gate` |
| ReviewLoops | `inventory` (`maxRounds: 2`), `characterize` (`maxRounds: 3`), `recover-prd` (`maxRounds: 3`, `carry: {rules: previousRules}` as `author-prd`) |

One SDLC pack change, its own unit: an optional `inventory` input on Task `event-storm` and
Pipeline `domain-discovery`, handed to every phase, as `rules` was (`26-domain-discovery.md`).

## Checks

`adapters/parity/`, an Adapter of its own beside `sdd/v1` and `testdesign/v1`, pure but for reading
the source checkout. Every finding `error` unless marked.

| Code | Finding |
|---|---|
| `inventory-location` | a `where` naming a file the checkout lacks, or a line past its end |
| `inventory-reference` | an `entity`, `from[]`, `in[]` or `covers[]` id the inventory lacks |
| `id-sequence` | `EP-n`, `ST-n`, `GD-n`, `EN-n`, `EX-n`, `Q-n` not unique and increasing in document order |
| `reader-disagreement` | with two readers: a guard one recorded and the other did not, at the same `where` |
| `branch-undercount` (warning) | a file whose branch keywords (`if`, `case`, `when`, `catch`, `EVALUATE`, the ternary, per language) outnumber its recorded guards: a lower bound no agent can talk past |
| `guard-open` | in `ledger-closure`: a rule or unknown guard its Oracle can reach and no test covers, or whose mutant survived; the feedback names each |
| `unknown-inventory-item` | a rule's `source` or a capability's description naming an inventory id that is not there |
| `rule-unsourced` | an `active` rule whose `source` starts with neither `inventory:` nor `decision:` |
| `guard-unaccounted` | after recovery: a guard whose `account` is `open` |
| `entry-point-uncited` (warning) | an entry point no capability description and no `nonGoals` entry names |
| `parity-unexplained` | a difference whose test covers no `change` or `drop` rule and no Issue cites |
| `parity-unreached` (warning) | an entry point the rewrite's run could not reach: listed in `unreached` |

A kept rule is an `active` rule whose `source` starts with `inventory:`; a rule sourced from
`decision:` is a change the Source system is not held to, and its Characterization tests get the
new expected value from the Tester, citing the rule.

## Rules

| Rule | Enforcer |
|---|---|
| the Source system is read, never changed: read-only readers, a scratch copy for mutants, tests written into the project's repository | Executors; `mutate-source`; convention |
| Characterization tests are written before any rule is recovered, from the inventory, so a guard no rule names still has a test | run order; `write-characterization` inputs |
| a Characterization test is changed only by the Tester, for a `change` rule it cites; the Builder never edits one | `characterize-rules`; `AGENTS.md` section 6 |
| every guard is accounted for before the SDLC run order starts | `recover-gate` (`guard-unaccounted`) |
| a Disposition is recorded in the Prd and the rules, never in a kind of its own: `keep` leaves the item; `change` deprecates the rule and adds one with `source: "decision: ..."`; `drop` moves the capability to `nonGoals` with its reason | `recover-rules`; `confirm-recovery` |
| `domain-discovery` takes the inventory: a domain event is a state change in the source's words, a pivotal event a `status` change, a context is cut by language and events, never by package; a part of the source with no model boundary is `bigBallOfMud` | `storming-dsl` (inventory part) |
| with the interface kept, the rewrite's TestHarness takes the suite's tool for its `api` level, since `harness-rules` takes the tool the repository already has | `harness-rules` |
| a `parity-unexplained` difference is an `Issue`: the rule was recovered wrong, the test reads the source wrong, or the rewrite is wrong; never fixed by changing the Source system | `parity-gate`; `AGENTS.md` section 6 |
| `persimmon init --pack rewrite` applies the SDLC pack, then the Rewrite pack, and places both packs' files; the Rewrite pack ships no `AGENTS.md` | `persimmon init` |

## Decisions

- A pack of its own, not a second entry into the SDLC pack: the run order differs before the Prd
  and after the build, and the Source system, the inventory, the Disposition and the parity check
  mean nothing to a product built from an idea. Packs have no dependencies (`20-pack.md`), so the
  Rewrite pack uses the SDLC pack's kinds and processes by name and `init --pack rewrite` installs
  both; copying them was refused, since two copies of the same kind drift. Found in design review.
- Two new kinds. `Prd`, `BusinessRules`, `EventStorming`, `Glossary`, `BoundedContext`,
  `DomainModel` and the test kinds take a recovered system as they take an authored one; the facts
  read off the code and the accounting of every guard have no home. A rule's evidence goes in
  `source`, a string already there. Found in design review.
- The brief stays text, as `28-prd-process.md` decided; what a check needs is a typed input of its
  own (`source`, the Oracle values). Found in design review.
- The agent extracts and a check decides, as in `26-domain-discovery.md`. AWS Transform, Thoughtworks'
  CodeConcise and Cognizant's seven-agent framework all put static analysis first and the model on
  translation; a pack ships YAML and a parser per language is not portable, so the agent runs
  whatever analyzer the workspace has, `inventory-consistency` checks every location, and
  `branch-undercount` gives a lower bound the agent cannot argue with. Found in research.
- Behaviour, not knowledge, is what holds a rewrite to its source. The first cut ran tests derived
  from the recovered rules against the Source system after the build: a rule nobody recovered had
  no test, so parity passed while the rule was lost. Characterization tests now come first, from
  the inventory, their expected values the source's answers (Feathers' characterization tests,
  the golden master); coverage of the source's own code shows the guards no test reached, and those
  are the next round's feedback. Supersedes "parity after `build-all`, not before". Found in design
  review.
- Four Oracles, because a Source system may run, run in part, have left records, or only be read,
  and each proves less than the one before. The ledger says which held per entry point, and a
  `static` one can at best reach `concerns`: no design turns reading into proof, so the verdict
  says so rather than pass. Two blind readers are the static Oracle's substitute for a run, after
  N-version practice. Found in design review.
- The ledger is computed, never written by an agent, as the TestReport is (`39-test-process.md`):
  whether a guard ran is a coverage fact, not a judgment. Found in design review.
- Mutation of the source is optional: it doubles the run time, and coverage already shows a guard
  ran; what it adds is that a test would notice the guard changing. Asked for with `mutate`.
  Found in design review.
- The method is Prompts, not a `Skill`, as `26-domain-discovery.md` decided: pack YAML only, frozen
  in the snapshot, overridable per Namespace. A team with its own bundle (a vendor's COBOL reader)
  overrides the Task in its Namespace with a `skill` context entry; context is no port, so the
  override is allowed. Found in design review.
- The inventory before the Prd, and the Prd before the storming: `checkSubdomains` needs the Prd's
  subdomains to judge the storming's contexts (`34-subdomains.md`), and the inventory is the
  evidence both cite. Found in design review.
- One storming, not an as-is and a to-be. The storming runs after the Dispositions, over the
  inventory, and cuts contexts by language and events, so the messy code's structure never becomes
  the model's. A board of the source as it is would cost three human gates for a model nobody
  builds; the inventory, the ledger and the Prd's first revision are the record of what the source
  does. Found in design review.
- The storming reads the inventory through an optional input, not a Rewrite pack copy of
  `event-storm`: an override must keep the ports (`20-pack.md`), and a Prd alone carries no
  command, event or entity of the source. Optional, so a product from an idea storms as before.
  Found in design review.
- A Disposition is not a kind: `keep`, `change` and `drop` each map onto a field the Prd or the
  rules already have, and the revision history shows what changed. Found in design review.
- A changed interface gets a translation the Tester writes once and a human confirms, not a second
  suite: the Characterization tests stay the source's record, and every mapping cites the Design
  element it lands on. Found in design review.
