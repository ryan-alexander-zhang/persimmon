# example07: brief to Plan with the AI Native pack, a human at every Gate

You give a one-page brief. The pack writes the Prd and its business rules, storms the domain in
three levels, derives the bounded context, its glossary and domain model, writes one Spec per
capability, one Design per building block and type, and one Plan per Spec. You sit at the Gates:
approve, or reject with findings the next round must fix. Only one artifact is yours to write: the
Architecture, which no process produces yet.

```text
brief ─▶ author-prd ─▶ domain-discovery ─▶ [architecture.yaml] ─▶ spec-all ─▶ design-all ─▶ plan-all
          Prd, rules    EventStorming ×3       Architecture        Spec ×6     Design ×2     Plan ×6
          you confirm   you confirm each       you write
                        BoundedContext,
                        Glossary, DomainModel
```

[`room-booking-domain.yaml`](room-booking-domain.yaml) is what one run of these steps produced on
`claude-sonnet-5`: twenty-one artifacts, the Architecture included. Read it to see the shapes, or
load it into a project without running anything (step 8).

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
  ([Installation](../../README.md#installation))
- `claude` CLI installed and logged in
- about 45 minutes of wall clock and your attention at seven Gates

## Steps

Run every command inside this directory.

### 1. Create the project, install the pack, pick a cheap model

```sh
cd examples/example07
persimmon init
persimmon apply ../../packs/ai-native/global/*.yaml --global
persimmon apply overrides.yaml          # the five agent Executors on claude-sonnet-5
```

`overrides.yaml` overrides the pack's Executors by name in the default Namespace; delete it from
the project (`persimmon apply` is idempotent, the Global ones stay) to run on the pack's model.

### 2. The Prd

```sh
persimmon run author-prd --input brief=@brief.txt --input contextId=room-booking --follow
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
persimmon run domain-discovery --input 'prd={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Prd, namespace: default, id: room-booking-prd, revision: <n>}}' --follow
```

Three Gates in a row, one per storming level: big picture, process, design. Each parks on you
with `persimmon complete ...`; `persimmon ui` shows the model as a board. A finding names a node,
an edge or a context id. The derivation that follows has no human Gate. The run ends with
`BoundedContext/room-booking.r1`, `Glossary/room-booking-glossary.r1`,
`DomainModel/room-booking-model.r1`.

### 4. The Architecture, by hand

```sh
persimmon validate architecture.yaml
persimmon create architecture.yaml
```

The one in this directory is for this brief: three building blocks, the booking core (`BB-1`),
the web client, the status screens. Edit it before creating it if your discovery came out
differently; `introduction.prd`, `domainModels` and `glossaries` are the artifact ids above.

### 5. One Spec per capability

```sh
persimmon run spec-all --input 'prd={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Prd, namespace: default, id: room-booking-prd, revision: <n>}}' \
  --input 'capabilities=[CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6]' \
  --input 'architecture={kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: Architecture, namespace: default, id: room-booking-architecture, revision: 1}}' \
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

`Design/room-booking-architecture-bb-1-http-api.r1` and `...-bb-1-data-schema.r1`; `designs.yaml`
lists both for the next step.

### 7. One Plan per Spec

```sh
persimmon run plan-all --input 'prd=...' --input 'capabilities=[CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6]' \
  --input 'architecture=...' --input designs=@designs.yaml --follow
```

`written 6`. `persimmon tree WorkflowRun/plan-all-<hex>` shows every Plan under its capability.

### 8. Load the recorded output instead

```sh
persimmon init
persimmon apply ../../packs/ai-native/global/10-artifact-kinds.yaml --global
persimmon validate room-booking-domain.yaml        # 21 lines `ok`
```

`persimmon create` takes one document per file; split the file to load it, or read it as it is.
Every artifact in it is at revision 1: the rounds of the Prd (two) and the storming (five)
collapsed into the revision that passed.
