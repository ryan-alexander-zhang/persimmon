# example08: a product over two bounded contexts, brief to Plan

A company car pool: employees reserve and pick up cars, a fleet coordinator keeps the cars serviced.
Two bounded contexts, `car-reservations` and `fleet-care`, one Prd, one set of business rules tagged by
context, one deployable realising both contexts and one web application showing both. The same
steps as [example07](../example07/README.md), with what changes when a product has more than one
context. You sit at the Gates; nothing is yours to write but the brief.

```text
brief ─▶ author-prd ─▶ domain-discovery ─▶ architect ─▶ spec-all ×2 ─▶ design-all ×4 ─▶ design-system ─▶ design-all (ui) ─▶ plan-all
          Prd, rules    EventStorming ×3       Architecture,  Spec ×9        Design ×4       DesignSystem      Design ×1          Plan ×9
          you confirm   you confirm each       Adrs ×4;                                     you confirm
                        BoundedContext ×2,     you confirm
                        Glossary ×2,
                        DomainModel ×2
```

[`car-pool-domain.yaml`](car-pool-domain.yaml) is what one run of these steps produced on
`claude-sonnet-5`: thirty-eight artifacts, every one at revision 1 (the rounds collapsed into the
revision that passed). Read it for the shapes, or load it without running anything (step 9).

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
  ([Installation](../../README.md#installation))
- `claude` CLI installed and logged in
- about 90 minutes of wall clock and your attention at seven Gates

## Steps

Run every command inside this directory. `<ref>` below stands for
`{kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: <Kind>, namespace: default, id: <id>, revision: <n>}}`.

### 1. Create the project, install the pack, pick a cheap model

```sh
cd examples/example08
persimmon init
persimmon apply ../../packs/ai-native/global/*.yaml --global
persimmon apply overrides.yaml          # the seven agent Executors on claude-sonnet-5
```

### 2. The Prd, two contexts named up front

```sh
persimmon run author-prd --input brief=@brief.txt --input productId=car-pool --input 'contextIds=[car-reservations, fleet-care]' --follow
```

`Prd/car-pool-prd` and `BusinessRules/car-pool-rules`, the rules with `contexts: [car-reservations, fleet-care]`
and every `BR-n` tagged with the context it belongs to (`33-multi-context-product.md`). Round one here
named a capability after a screen and put one rule in the wrong context; the rejection named both,
round two passed.

### 3. Domain discovery, both contexts from one storming

```sh
persimmon run domain-discovery --input 'prd=<ref>' --input 'rules=<ref>' --follow
```

Three Gates, one per storming level; each passed at round two after one rejection. The design
level carries both contexts; the derivation (no Gate) wrote `BoundedContext/car-reservations`,
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
persimmon run spec-all --input 'prd=<ref>' --input 'capabilities=[CAP-1, CAP-2, CAP-3, CAP-4, CAP-5]' \
  --input 'architecture=<ref>' --input 'domainModel=<car-reservations-model>' --input 'glossary=<car-reservations-glossary>' --input 'rules=<ref>' --follow
persimmon run spec-all --input 'capabilities=[CAP-6, CAP-7, CAP-8, CAP-9]' --input 'domainModel=<fleet-care-model>' --input 'glossary=<fleet-care-glossary>' <the rest as above> --follow
```

A Spec binds one DomainModel, so the capabilities of each context run with that context's model.
`written 5`, `written 4`, every Spec round one.

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
(`29-design-process.md`). Each round one. `api-designs.yaml` lists the two APIs for the `ui` Design,
`designs.yaml` every Design for the Plans.

### 7. The design system, you at the Gate

```sh
persimmon run design-system --input 'prd=<ref>' --input 'architecture=<ref>' --follow
```

`DesignSystem/car-pool-prd-design-system`, a DESIGN.md in `document.content`; the linter and the
human both passed it at round one. Its two open questions are the brand colour and the typeface
the brief does not give.

### 8. The web application's screens, over both APIs

```sh
persimmon run design-all --input 'blocks=[BB-3]' --input type=ui --input 'designSystem=<ref>' --input designs=@api-designs.yaml <architecture, rules> --follow
```

No `domainModel`, no `glossary`: a `ui` Design realises operations of the API Designs bound, not
model labels (`32-ui-design-process.md`). `Design/car-pool-prd-architecture-bb-3-ui.r1`, round one:
eight screens, twenty elements, ten over each API. Its first open question is a real gap upstream:
the Reservation API's `Car` schema carries only `carId`, so the Available cars screen cannot show
which car was offered. An earlier run of this step with the `car-reservations` model bound failed
on the four fleet screens and, at round two, kept them in prose without elements; that is why the
index moved to operations.

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
persimmon apply ../../packs/ai-native/global/10-artifact-kinds.yaml --global
persimmon validate car-pool-domain.yaml        # 38 lines `ok`
```

`persimmon create` takes one document per file; split the file to load it, or read it as it is.
