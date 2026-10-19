# example07: brief to code with the SDLC pack, a human at every Gate

You give a one-page brief. The pack writes the Prd and its business rules, storms the domain in
three levels, derives the bounded context, its glossary and domain model, writes one Spec per
capability, one Design per building block and type, and one Plan per Spec, then builds one Plan into
the starter app in [`app/`](app/). You sit at the Gates: approve, or reject with findings the next
round must fix. Nothing is yours to write but the brief.

```text
brief ─▶ author-prd ─▶ domain-discovery ─▶ architect ─▶ spec-all ─▶ design-all ─▶ design-system ─▶ design-all (ui) ─▶ plan-all ─▶ build-all
          Prd, rules    EventStorming ×3       Architecture,  Spec ×6     Design ×2     DesignSystem      Design ×3          Plan ×6     code, AcceptanceRecord ×3
          you confirm   you confirm each       Adrs; you confirm                       you confirm                                     a defect reported, an Issue
                        BoundedContext,
                        Glossary, DomainModel
```

[`room-booking-domain.yaml`](room-booking-domain.yaml) is what one run of these steps produced on
`claude-sonnet-5`: thirty artifacts, the Architecture and its five Adrs, the DesignSystem and the three `ui` Designs included. Read it to see the shapes, or
load it into a project without running anything (step 8) and build from there (step 9).

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
  ([Installation](../../README.md#installation))
- `claude` CLI installed and logged in
- Node.js 22.13 or later for step 9: the starter app stores on `node:sqlite`
- about 65 minutes of wall clock and your attention at nine Gates, plus about 6 minutes for step 9 unattended

## Steps

Run every command inside this directory.

### 1. Create the project, install the pack, pick a cheap model

```sh
cd examples/example07
persimmon init                          # the SDLC pack comes with it
persimmon apply overrides.yaml          # the seven agent Executors on claude-sonnet-5
```

`overrides.yaml` overrides the pack's Executors by name in the default Namespace; delete it from
the project (`persimmon apply` is idempotent, the Global ones stay) to run on the pack's model.

### 2. The Prd

```sh
persimmon run author-prd --input brief=@brief.txt --input productId=room-booking --follow
```

The run parks on you:

```text
parked on you: persimmon complete author-prd-<hex>-rounds-1-review-confirmed-task
```

`persimmon complete <that name>` shows the Prd and the rules at the terminal and asks: approve,
or findings one per line. Name the id each finding is about (`Q-1: decided. A booking cannot be
modified; the owner cancels and books again. Remove Q-1 and add the decision to nonGoals.`).
A rejection starts round two with your findings; three rounds at most. The outputs name
`Prd/room-booking-prd.r<n>` and `BusinessRules/room-booking-rules.r<n>`; note `n`.

### 3. Domain discovery

```sh
persimmon run domain-discovery --input 'prd={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Prd, namespace: default, id: room-booking-prd, revision: <n>}}' \\
  --input 'rules={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: BusinessRules, namespace: default, id: room-booking-rules, revision: <n>}}' --follow
```

Three Gates in a row, one per storming level: big picture, process, design. Each parks on you
with `persimmon complete ...`; `persimmon ui` shows the model as a board. A finding names a node,
an edge or a context id. The derivation that follows has no human Gate. The run ends with
`BoundedContext/room-booking.r1`, `Glossary/room-booking-glossary.r1`,
`DomainModel/room-booking-model.r1`.

### 4. The Architecture and its Adrs

```sh
persimmon run architect --input 'prd={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Prd, namespace: default, id: room-booking-prd, revision: <n>}}' \
  --input 'rules={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: BusinessRules, namespace: default, id: room-booking-rules, revision: <n>}}' \
  --input 'contexts=[{apiVersion: sdd.persimmon.ai/v1, kind: BoundedContext, id: room-booking, revision: 1}]' \
  --input 'domainModels=[{apiVersion: sdd.persimmon.ai/v1, kind: DomainModel, id: room-booking-model, revision: 1}]' \
  --input 'glossaries=[{apiVersion: sdd.persimmon.ai/v1, kind: Glossary, id: room-booking-glossary, revision: 1}]' --follow
```

One Gate: the Validator checks every citation, you judge the block cut, the strategy and its Adrs,
the quality goals. A finding names a `BB-n`, `S-n`, `QG-n`, `C-n`, `QS-n` or an Adr id. The run
ends with `Architecture/room-booking-prd-architecture.r1` and `Adr/room-booking-prd-adr-<k>.r1`,
one per strategy decision. This recording predates the slot rule (`31-architecture-process.md`: the n-th Adr backs
`S-n`, a dropped strategy's slot superseded in place) and the Adr `strategy` field: round two dropped `S-2` and
`S-5` and republished five Adrs under `adr-1` to `adr-5`, so the Adrs here name no strategy and
`architecture-consistency` does not hold them to a slot. `architecture.yaml` in this directory is the hand-written one an earlier
run of these steps used, kept for comparison; the one the loop wrote is in `room-booking-domain.yaml`.

### 5. One Spec per capability

```sh
persimmon run spec-all --input 'prd={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Prd, namespace: default, id: room-booking-prd, revision: <n>}}' \
  --input 'capabilities=[CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6]' \
  --input 'architecture={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Architecture, namespace: default, id: room-booking-prd-architecture, revision: 1}}' \
  --input 'context={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: BoundedContext, namespace: default, id: room-booking, revision: 1}}' \
  --input 'domainModel={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: DomainModel, namespace: default, id: room-booking-model, revision: 1}}' \
  --input 'glossary={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Glossary, namespace: default, id: room-booking-glossary, revision: 1}}' \
  --input 'rules={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: BusinessRules, namespace: default, id: room-booking-rules, revision: <n>}}' --follow
```

`written 6`. Each Spec is `Spec/room-booking-prd-cap-<k>.r1`.

### 6. Designs of the booking core

```sh
persimmon run design-all --input 'blocks=[BB-1]' --input type=http-api <architecture, domainModel, glossary, rules as above> --follow
persimmon run design-all --input 'blocks=[BB-1]' --input type=data-schema <the same> --follow
```

`Design/room-booking-prd-architecture-bb-1-http-api.r1` and `...-bb-1-data-schema.r1`; `api-designs.yaml`
lists the first for the `ui` Designs, `designs.yaml` lists every Design for the Plans.

### 6b. The design system, you at the Gate

```sh
persimmon run design-system --input 'prd=...' --input 'architecture=...' --follow
```

`DesignSystem/room-booking-prd-design-system`: a DESIGN.md (Google Labs' format) in `document.content`,
linted by `designmd/v1` and parked on you. Round one here wrote a `border` sub-token the linter refuses
and a report page no client block shows; the rejection named both, round two passed the linter and
the human. `persimmon get DesignSystem/room-booking-prd-design-system` and read `document.content` as
the file it is; `npx @google/design.md export --format css-tailwind` turns it into a theme.

### 6c. Screens of the three client blocks

```sh
persimmon run design-all --input 'blocks=[BB-5, BB-6, BB-7]' --input type=ui <architecture, rules as above; no domainModel, no glossary> \
  --input 'designSystem={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: DesignSystem, namespace: default, id: room-booking-prd-design-system, revision: <n>}}' \
  --input designs=@api-designs.yaml --follow
```

`written 3`, each round one: `Design/room-booking-prd-architecture-bb-5-ui.r1`, `-bb-6-ui.r1`, `-bb-7-ui.r1`, one
`## <screen>` section per screen, elements per screen and per action, each realising an operation of the
booking API (they were written against the DomainModel and re-realised by hand when the index moved to
operations, `32-ui-design-process.md`). Their open questions are real: the API has no operation to list rooms by fit, and the
DomainModel has no fact for a room's name, so a door screen cannot say which room it is.

### 7. One Plan per Spec

```sh
persimmon run plan-all --input 'prd=...' --input 'capabilities=[CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6]' \
  --input 'architecture=...' --input designs=@designs.yaml --follow
```

`written 6`. `persimmon tree WorkflowRun/plan-all-<hex>` shows every Plan under its capability.

### 8. Load the recorded output instead

```sh
persimmon init
persimmon validate room-booking-domain.yaml        # 30 lines `ok`
mkdir -p .persimmon/upstream
awk '/^---$/{n++; next} {print > (".persimmon/upstream/" sprintf("%02d", n) ".yaml")}' room-booking-domain.yaml
for f in .persimmon/upstream/*.yaml; do persimmon create "$f"; done   # 30 lines `created`
```

`persimmon create` takes one document per file, so the file is split first.
Edited by hand after this recording: the Prd names one subdomain, `room-booking` (supporting), its
capabilities and the storming context name it, and the BoundedContext lists the six capabilities
(`34-subdomains.md`); the recording named the context in the Prd instead.
Every artifact in it is at revision 1: the rounds of the Prd (two) and the storming (five)
collapsed into the revision that passed.

Each quality scenario's `method` and `provenAt` were added by hand after the run, when the kind made them required
(35-build-process.md); the Plans predate them.

### 9. Build Cancel a Booking into the starter app

[`app/`](app/) is the booking core of Book a Room (CAP-1), written by hand on `node:sqlite`: Book
Room against BR-1 to BR-7 and the Room Status View. It carries one defect on purpose: the BR-7
overlap check counts a booking that starts when another ends as overlapping, so
`Book Room > books a slot that starts when the last one ends (BR-7)` is red. That test is CAP-1's
`AC-13`, not Cancel a Booking's.

```sh
(cd app && npm install)
persimmon run build-all --input 'plan={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Plan, namespace: default, id: room-booking-prd-cap-2-plan, revision: 1}}' \
  --input 'tasks=[T-1, T-2, T-3]' \
  --input 'spec={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Spec, namespace: default, id: room-booking-prd-cap-2, revision: 1}}' \
  --input 'architecture={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Architecture, namespace: default, id: room-booking-prd-architecture, revision: 1}}' \
  --input 'designs={kind: artifacts, refs: [{apiVersion: sdd.persimmon.ai/v1, kind: Design, id: room-booking-prd-architecture-bb-1-data-schema, revision: 1}, {apiVersion: sdd.persimmon.ai/v1, kind: Design, id: room-booking-prd-architecture-bb-1-http-api, revision: 1}]}' \
  --input 'glossary={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Glossary, namespace: default, id: room-booking-glossary, revision: 1}}' \
  --input 'rules={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: BusinessRules, namespace: default, id: room-booking-rules, revision: 1}}' \
  --input repository=app --follow
```

The run first takes the baseline: the app's tests before any task, the BR-7 test red among them.
Then it parks on the builder once per task. By default the builder is you with your own coding
agent: point it at the form the run names in `.persimmon/inbox/` (`AGENTS.md` section 6 tells it
what to do). To run the build unattended instead, `persimmon apply build-overrides.yaml` first: the
builder becomes Claude Code on `claude-sonnet-5`.

What to watch for: the red BR-7 test is not this Plan's. The baseline tolerates it
(`suite-baseline`), and the builder reports it in the record as a defect, `D-1`, instead of fixing
it or asking about it. The Gate passes the round and shows it:

```text
WorkflowRun   build-all-<hex>                      Succeeded 5m58s
├─ baseline   TaskRun   junit/v1                   Succeeded    1s
│     TestOutcome/room-booking-prd-cap-2-plan-baseline.r1
├─ each-1   WorkflowRun                            Succeeded 3m33s
│  └─ rounds-1   WorkflowRun                       Succeeded 3m33s
│     ├─ produce   WorkflowRun                     Succeeded 3m33s
│     │  ├─ implement   TaskRun   claude-code/v1   Succeeded 3m15s
│     │  │     AcceptanceRecord/room-booking-prd-cap-2-plan-t-1.r1
│     │  ├─ tests   TaskRun   junit/v1             Succeeded    0s
│     │  └─ audit   TaskRun   claude-code/v1       Succeeded   16s
│     └─ review   GateRun                          passed       0s
│        └─ evidence   ValidationRun               passed       0s
│              info suite-baseline: 1 test case red in the baseline, red still: test/book-room.test.js > Book Room > books a slot that starts when the last one ends (BR-7)
│              warning defect-reported: D-1 at src/room-schedule.js:27 (overlapping query) — ...: bookRoom's BR-7 overlap check ... uses start_time <= ? AND end_time >= ? ...
├─ each-2 ...                                      Succeeded 1m20s   (the same D-1 warning)
└─ each-3 ...                                      Succeeded 1m04s   (the same D-1 warning)
```

That is the unattended run on `claude-sonnet-5`: every task passed in round one, the BR-7 query was
left as it was, and each of the three records reported the same defect. One defect, one Issue.

### 10. Investigate the defect as an Issue

The `D-n` is a report, not an investigation. Write the Issue: root cause, every site of it, the
test that reproduces it, whether the code or the Spec was wrong, what the fix revises. Here the
Spec is right (`AC-13` asks for the back-to-back booking), so the code was non-conformant and the
fix is a rebuild of the CAP-1 task that `AC-13` verifies, `T-2`, with no Spec revision.
[`issue.yaml`](issue.yaml) is that Issue:

```sh
persimmon create issue.yaml
persimmon get Issue/back-to-back-booking-refused
```

When the fix's AcceptanceRecord passes its Gate, write the next revision (`.r2`, `revision: 2`)
with `status: resolved`, `fixedBy` naming that record, `detectionGap` and `residual`; the kind
refuses a `resolved` Issue without them.

### Reset

```sh
rm -rf .persimmon persimmon.yaml AGENTS.md CLAUDE.md .gitignore     # the project init wrote
git checkout -- app && git clean -fd app                            # the starter app as committed
```
