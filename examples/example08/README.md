# example08: a product over two bounded contexts, brief to Plan

A company car pool: employees reserve and pick up cars, a fleet coordinator keeps the cars serviced.
The Prd names two subdomains from the brief, `reservations` (core) and `fleet-care` (supporting), and
no bounded context; the storming cuts the contexts that realise them (`34-subdomains.md`). One set of
business rules tagged by subdomain, one deployable with a module per context, one web application
showing both. The same steps as [example07](../example07/README.md), with what changes when a product
has more than one context. You sit at the Gates; nothing is yours to write but the brief.

```text
brief ─▶ author-prd ─▶ domain-discovery ─▶ architect ────┬─▶ spec-all ×2 ───────────────────────────┐
         Prd, rules    EventStorming ×3    Architecture, │   Spec ×7                                │
         you confirm   you confirm each    Adrs ×4;      ├─▶ design-all ×6 ───┬─────────────────────┤
                       BoundedContext ×2,  you confirm   │   Design ×6        ▼                     ├─▶ plan-all
                       Glossary ×2,                      └─▶ design-system ─▶ design-all (ui) ──────┘   Plan ×7
                       DomainModel ×2                        DesignSystem     Design ×1
                                                             you confirm
```

Specs, the module Designs and the design system each need only the Architecture and what came before
it; the steps below run them one after another. The `ui` Design waits for the module Designs and the
design system, the Plans for the Specs and every Design.

[`car-pool-domain.yaml`](car-pool-domain.yaml) is what one run of these steps produced on
`claude-sonnet-5`: thirty-six artifacts, every one at revision 1 (the rounds collapsed into the
revision that passed). Read it for the shapes, or load it without running anything (step 10).

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
  ([Installation](../../README.md#installation))
- `claude` CLI installed and logged in
- about 90 minutes of wall clock and your attention at six Gates (the Prd, three storming levels, the
  Architecture, the design system)

## Steps

Run every command inside this directory. `<ref>` below stands for
`{kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: <Kind>, namespace: default, id: <id>, revision: <n>}}`.

### 1. Create the project, install the pack, pick a cheap model

```sh
cd examples/example08
persimmon init                          # the SDLC pack comes with it
persimmon apply overrides.yaml          # the seven agent Executors on claude-sonnet-5
```

### 2. The Prd, two subdomains from the brief

```sh
persimmon run author-prd --input brief=@brief.txt --input productId=car-pool --follow
```

`Prd/car-pool-prd` with `subdomains: [reservations (core), fleet-care (supporting)]` and seven
capabilities, each naming one, and `BusinessRules/car-pool-rules` with eighteen rules, each tagged
with the subdomain whose policy it is. The Prd names no bounded context. Round one cited the fleet
rule "each car return must update the car's mileage" from the pickup and return capability, and
`prd-consistency` refused it (`subdomain-mismatch`); the human moved it to fleet record keeping,
typed `fleet-care` supporting instead of core, and answered the four open questions. Round two
passed.

### 3. Domain discovery: the storming cuts the contexts

```sh
persimmon run domain-discovery --input 'prd=<ref>' --input 'rules=<ref>' --follow
```

Three Gates, one per storming level, each passed at round two. The big picture cut two contexts,
`reservations` and `fleet-care`, and kept the garage an external system outside both; the human
merged a duplicated "Car taken out of service" and asked for the missing "Car mileage updated". The
process level gained a time-triggered "Service date reached", so a parked car still becomes
service-due. At the design level each context names its subdomain and carries its type, the map
holds one partnership, and `storming-gate` checks both against the Prd (`checkSubdomains`). The
derivation (a script Gate, no human) wrote `BoundedContext/reservations` (CAP-1 to CAP-4) and
`BoundedContext/fleet-care` (CAP-5 to CAP-7), each with its Glossary and DomainModel, all at round
one; `derived-gate` holds their subdomain, capabilities and relationships to the storming.

### 4. The Architecture, the lists bound by kind

```sh
persimmon run architect --input 'prd=<ref>' --input 'rules=<ref>' \
  --input contexts=kind:BoundedContext --input domainModels=kind:DomainModel --input glossaries=kind:Glossary --follow
```

`--input <port>=kind:<Kind>` lists every artifact of that kind at its latest revision (`08-store.md`).
Round one: one deployable with a module per context, `BB-1 Reservations module` and `BB-2 Fleet care
module`, `BB-3 Web client`, `BB-4 Data store`; the modules integrate by domain events, and car
search reads an event-fed projection. Four Adrs in strategy slots `S-1` to `S-4`
(`31-architecture-process.md`). `architecture-consistency` placed every capability in exactly one
BoundedContext.

### 5. Specs, one run per context

```sh
persimmon run spec-all --input 'prd=<ref>' --input 'capabilities=[CAP-1, CAP-2, CAP-3, CAP-4]' \
  --input 'architecture=<ref>' --input 'context=<reservations>' --input 'domainModel=<reservations-model>' --input 'glossary=<reservations-glossary>' --input 'rules=<ref>' --follow
persimmon run spec-all --input 'capabilities=[CAP-5, CAP-6, CAP-7]' --input 'context=<fleet-care>' --input 'domainModel=<fleet-care-model>' --input 'glossary=<fleet-care-glossary>' <the rest as above> --follow
```

A Spec binds one BoundedContext and its DomainModel, so each run takes the capabilities that context
lists. `written 4`, `written 3`; two Specs took a second round to put their acceptance ids in order.

### 6. Six Designs, three per module

```sh
persimmon run design-all --input 'blocks=[BB-1]' --input type=http-api --input 'interface=Reservation API' \
  --input 'domainModel=<reservations-model>' --input 'glossary=<reservations-glossary>' <architecture, rules> --follow
persimmon run design-all --input 'blocks=[BB-1]' --input type=async-api --input 'interface=Reservation events' <the same model and glossary> --follow
persimmon run design-all --input 'blocks=[BB-1]' --input type=data-schema <the same model and glossary> --follow
# and the same three for BB-2: 'Fleet care API', 'Fleet care status events', the fleet-care model and glossary
```

A Design id is `<architecture>-<block>-<type>`, `...-bb-1-http-api` and so on; a block with two
Designs of one type would add `--input qualifier=<label>` (`29-design-process.md`). The http-api and
data-schema Designs passed at round one, both async-api Designs at round two. The `ui` Design and
the Plans take every Design of the project with `--input designs=kind:Design`; no list file.

### 7. The design system, you at the Gate

```sh
persimmon run design-system --input 'prd=<ref>' --input 'architecture=<ref>' --follow
```

`DesignSystem/car-pool-prd-design-system`, a DESIGN.md in `document.content`; the linter and the
human both passed it at round one. Its two open questions are the brand colour and the typeface
the brief does not give.

### 8. The web application's screens, over both APIs

```sh
persimmon run design-all --input 'blocks=[BB-3]' --input type=ui --input 'designSystem=<ref>' --input designs=kind:Design <architecture, rules> --follow
```

No `domainModel`, no `glossary`: a `ui` Design realises operations of the API Designs bound, not
model labels (`32-ui-design-process.md`). `kind:Design` binds the schemas and the event Designs too;
the screens realise the APIs' operations and the Validator ignores the rest.
`Design/car-pool-prd-architecture-bb-3-ui.r1`, round one: nine screens, twenty elements. Its open
question is a real gap upstream: the Reservation API's available-cars response carries only `carId`,
so the search screen cannot show the car's seats or gearbox.

### 8b. What no Design realises yet

```sh
persimmon run design-coverage --input 'domainModel=<ref>' --follow   # <ref>: reservations-model, then once more for fleet-care-model; the Designs naming it are queried
persimmon tree WorkflowRun/design-coverage-<hex>     # one `unrealised` warning per stormed name without a Design element
```

The run Succeeds: an unrealised name is the product's gap, not a defect of the Designs that
exist. Here `reservations` has four and `fleet-care` nine, every command among them one a policy
invokes (release, lapse, cancel future reservations, update mileage), the events fleet care's own.
Run it again, once per DomainModel, after the next `design-all`.

### 8c. One Design again, later

```sh
persimmon get Design --behind                        # which Designs pin a Glossary, a DomainModel or rules that moved on
persimmon run design-check --input 'design=<ref>' --input 'architecture=<ref>' --input 'rules=<ref>' \
  --input 'domainModel=<ref>' --input 'glossary=<ref>' --follow     # a ui Design: designSystem=<ref> and designs=kind:Design instead of these two; no glossary, no field check
persimmon tree WorkflowRun/design-check-<hex>        # every finding; `passed false` when one is an error
```

### 9. One Plan per Spec

```sh
persimmon run plan-all --input 'prd=<ref>' --input 'capabilities=[CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-7]' \
  --input 'architecture=<ref>' --input designs=kind:Design --follow
```

`written 7`, every Plan round one, each with tasks on its context's module and `BB-3` realising
elements of the APIs, the schemas and the screens; the damage review's Plan touches both modules.
Their open questions name what no Design covers: the car attributes the available-cars response
lacks, the time trigger of the approval lapse and of the service date, and the consuming side of
each module's events.

### 10. Load the recorded output instead

```sh
persimmon init
persimmon validate car-pool-domain.yaml        # 36 lines `ok`
```

`persimmon create` takes one document per file; split the file to load it, or read it as it is.
