# example08: a product over two bounded contexts, brief to Plan

A company car pool: employees reserve and pick up cars, a fleet coordinator keeps the cars serviced.
Two subdomains in the Prd, `reservations` (core) and `fleet-care` (supporting), two bounded contexts
the storming cuts for them, `car-reservations` and `fleet-care`, one set of business rules tagged by
subdomain, one deployable realising both contexts and one web application showing both. The same
steps as [example07](../example07/README.md), with what changes when a product has more than one
context. You sit at the Gates; nothing is yours to write but the brief.

```text
brief ─▶ author-prd ─▶ domain-discovery ─▶ architect ────┬─▶ spec-all ×2 ───────────────────────────┐
         Prd, rules    EventStorming ×3    Architecture, │   Spec ×9                                │
         you confirm   you confirm each    Adrs ×4;      ├─▶ design-all ×4 ───┬─────────────────────┤
                       BoundedContext ×2,  you confirm   │   Design ×4        ▼                     ├─▶ plan-all
                       Glossary ×2,                      └─▶ design-system ─▶ design-all (ui) ──────┘   Plan ×9
                       DomainModel ×2                        DesignSystem     Design ×1
                                                             you confirm
```

Specs, the `BB-1` Designs and the design system each need only the Architecture and what came before
it; the steps below run them one after another. The `ui` Design waits for the `BB-1` Designs and the
design system, the Plans for the Specs and every Design.

[`car-pool-domain.yaml`](car-pool-domain.yaml) is what one run of these steps produced on
`claude-sonnet-5`: thirty-eight artifacts, every one at revision 1 (the rounds collapsed into the
revision that passed). Read it for the shapes, or load it without running anything (step 10).
Edited by hand after the recording, which named the contexts in the Prd: the Prd's subdomains, the
capabilities' and rules' tags, the storming contexts' `subdomain` and the BoundedContexts'
`subdomain` and `capabilities` (`34-subdomains.md`).

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

`Prd/car-pool-prd` with `subdomains: [reservations (core), fleet-care (supporting)]`, every capability
naming one, and `BusinessRules/car-pool-rules` with every `BR-n` tagged with the subdomain whose
policy it is (`34-subdomains.md`). The Prd names no bounded context: the storming cuts those. Round
one of the recording named a capability after a screen and put one rule in the wrong part; the
rejection named both, round two passed.

### 3. Domain discovery, both contexts from one storming

```sh
persimmon run domain-discovery --input 'prd=<ref>' --input 'rules=<ref>' --follow
```

Three Gates, one per storming level; each passed at round two after one rejection. The design
level carries both contexts, each naming its subdomain and typed by it; the derivation (a script Gate, no human) wrote `BoundedContext/car-reservations`,
`BoundedContext/fleet-care` and a Glossary and DomainModel for each, all at round one. Round one of
the process level re-raised Prd questions the big-picture Gate had already answered; the Prompt now
reads a settled question off the confirmed model and never raises it again (`26-domain-discovery-process.md`).

### 4. The Architecture, the lists bound by kind

```sh
persimmon run architect --input 'prd=<ref>' --input 'rules=<ref>' \
  --input contexts=kind:BoundedContext --input domainModels=kind:DomainModel --input glossaries=kind:Glossary --follow
```

`--input <port>=kind:<Kind>` lists every artifact of that kind at its latest revision (`08-store.md`).
Round one cut two services and a gateway; the rejection asked for one deployable realising both
contexts. Round two: `BB-1 Car Pool Service` (both contexts, two provided APIs), `BB-3 Pool Web
Application`, four Adrs in strategy slots `S-1` to `S-4` (`31-architecture-process.md`: the n-th Adr
backs `S-n` and says so in `strategy`), the first recording under that rule.

### 5. Specs, one run per context

```sh
persimmon run spec-all --input 'prd=<ref>' --input 'capabilities=[CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6]' \
  --input 'architecture=<ref>' --input 'context=<car-reservations>' --input 'domainModel=<car-reservations-model>' --input 'glossary=<car-reservations-glossary>' --input 'rules=<ref>' --follow
persimmon run spec-all --input 'capabilities=[CAP-7, CAP-8, CAP-9]' --input 'context=<fleet-care>' --input 'domainModel=<fleet-care-model>' --input 'glossary=<fleet-care-glossary>' <the rest as above> --follow
```

A Spec binds one BoundedContext and its DomainModel, so the capabilities each BoundedContext lists run
with that context and its model: `car-reservations` lists CAP-1 to CAP-6, `fleet-care` CAP-7 to CAP-9. `written 6`, `written 3`,
every Spec round one.

### 6. Four Designs of one block, told apart by `qualifier`

```sh
persimmon run design-all --input 'blocks=[BB-1]' --input type=http-api --input 'interface=Reservation API' --input qualifier=reservations \
  --input 'domainModel=<car-reservations-model>' --input 'glossary=<car-reservations-glossary>' <architecture, rules> --follow
persimmon run design-all --input 'blocks=[BB-1]' --input type=data-schema --input qualifier=car-reservations <the same model and glossary> --follow
persimmon run design-all --input 'blocks=[BB-1]' --input type=http-api --input 'interface=Fleet record API' --input qualifier=fleet \
  --input 'domainModel=<fleet-care-model>' --input 'glossary=<fleet-care-glossary>' <architecture, rules> --follow
persimmon run design-all --input 'blocks=[BB-1]' --input type=data-schema --input qualifier=fleet-care <the same model and glossary> --follow
```

`BB-1` provides two APIs and stores two contexts' aggregates; a Design id is
`<architecture>-<block>-<qualifier>-<type>`, so the four are `...-bb-1-reservations-http-api`,
`...-bb-1-car-reservations-data-schema`, `...-bb-1-fleet-http-api`, `...-bb-1-fleet-care-data-schema`
(`29-design-process.md`). Each round one. The `ui` Design and the Plans take every Design of the
project with `--input designs=kind:Design`; no list file.

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
model labels (`32-ui-design-process.md`). `kind:Design` binds the two data schemas and the last
`ui` Design too; the screens realise the APIs' operations and the Validator ignores the rest. `Design/car-pool-prd-architecture-bb-3-ui.r1`, round one:
eight screens, twenty elements, ten over each API. Its first open question is a real gap upstream:
the Reservation API's `Car` schema carries only `carId`, so the Available cars screen cannot show
which car was offered. An earlier run of this step with the `car-reservations` model bound failed
on the four fleet screens and, at round two, kept them in prose without elements; that is why the
index moved to operations.

### 8b. What no Design realises yet

```sh
persimmon run design-coverage --input 'domainModel=<ref>' --follow   # <ref>: car-reservations-model, then once more for fleet-care-model; the Designs naming it are queried
persimmon tree WorkflowRun/design-coverage-<hex>     # one `unrealised` warning per stormed name without a Design element: commands the APIs skipped, every event (no async-api Design), an aggregate no schema holds
```

The run Succeeds: an unrealised name is the product's gap, not a defect of the Designs that
exist. Run it again, once per DomainModel, after the next `design-all`.

### 8c. One Design again, later

```sh
persimmon get Design --behind                        # which Designs pin a Glossary, a DomainModel or rules that moved on
persimmon run design-check --input 'design=<ref>' --input 'architecture=<ref>' --input 'rules=<ref>' \
  --input 'domainModel=<ref>' --input 'glossary=<ref>' --follow     # a ui Design: designSystem=<ref> and designs=kind:Design instead of these two; no glossary, no field check
persimmon tree WorkflowRun/design-check-<hex>        # every finding; `passed false` when one is an error
```

### 9. One Plan per Spec

```sh
persimmon run plan-all --input 'prd=<ref>' --input 'capabilities=[CAP-1, CAP-2, CAP-3, CAP-4, CAP-5, CAP-6, CAP-7, CAP-8, CAP-9]' \
  --input 'architecture=<ref>' --input designs=kind:Design --follow
```

`written 9`, every Plan round one, each with tasks on `BB-1` and `BB-3` realising elements of the
APIs, the schemas and the screens. Their open questions name what no Design covers: the
time-triggered release of an unclaimed reservation, the lapse of an undecided approval, the mail
relay for notifications, a mileage update the Fleet record API has no operation for.

### 10. Load the recorded output instead

```sh
persimmon init
persimmon validate car-pool-domain.yaml        # 38 lines `ok`
```

`persimmon create` takes one document per file; split the file to load it, or read it as it is.
