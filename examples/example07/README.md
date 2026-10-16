# example07: brief to Plan with the SDLC pack, a human at every Gate

You give a one-page brief. The pack writes the Prd and its business rules, storms the domain in
three levels, derives the bounded context, its glossary and domain model, writes one Spec per
capability, one Design per building block and type, and one Plan per Spec. You sit at the Gates:
approve, or reject with findings the next round must fix. Nothing is yours to write but the brief.

```text
brief ─▶ author-prd ─▶ domain-discovery ─▶ architect ─▶ spec-all ─▶ design-all ─▶ design-system ─▶ design-all (ui) ─▶ plan-all
          Prd, rules    EventStorming ×3       Architecture,  Spec ×6     Design ×2     DesignSystem      Design ×3          Plan ×6
          you confirm   you confirm each       Adrs; you confirm                       you confirm
                        BoundedContext,
                        Glossary, DomainModel
```

[`room-booking-domain.yaml`](room-booking-domain.yaml) is what one run of these steps produced on
`claude-sonnet-5`: thirty artifacts, the Architecture and its five Adrs, the DesignSystem and the three `ui` Designs included. Read it to see the shapes, or
load it into a project without running anything (step 8).

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
  ([Installation](../../README.md#installation))
- `claude` CLI installed and logged in
- about 65 minutes of wall clock and your attention at nine Gates

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
```

`persimmon create` takes one document per file; split the file to load it, or read it as it is.
Edited by hand after this recording: the Prd names one subdomain, `room-booking` (supporting), its
capabilities and the storming context name it, and the BoundedContext lists the six capabilities
(`34-subdomains.md`); the recording named the context in the Prd instead.
Every artifact in it is at revision 1: the rounds of the Prd (two) and the storming (five)
collapsed into the revision that passed.
