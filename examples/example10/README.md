# example10: an existing system analyzed, three repositories, no rewrite

The expense claims checker of [example09](../example09/README.md) exists three times, in JavaScript,
Java and Go. Here those three are the Source system: three git checkouts under one directory, read
by the Rewrite pack as one product (`40-pack-rewrite.md`, a directory of checkouts), and analyzed
only (`--analyze`, the run order stopped at the domain model). No rewrite is decided, nothing runs,
nothing is built. You sit at the human forms: the cut, the recovery decisions, the three storming
gates. The agents run on `claude-sonnet-5`.

```text
source.sh ─▶ js/ java/ go/ (three checkouts) ─▶ survey ─▶ inventory SL-1 ─▶ recover-prd ─▶ domain-discovery ─▶ stop
                                                 you cut      two readers,     Prd, rules,      EventStorming ×3,
                                                 one Slice    an auditor       your Dispositions BoundedContext, Glossary, DomainModel
```

What this example teaches: a product spread over several repositories is one domain, cut by its
language and events and never by repository; the facts of each repository are its own, and where the
three differ the difference is a finding a human decides (here, Java's request parsing). It also
shows what analysis leaves open: every item of the Slice stays `unverified`, since nothing ran.

[`claims-domain.yaml`](claims-domain.yaml) is what one run of these steps produced on
`claude-sonnet-5`. Read it for the shapes, or load it without running anything (step 7).

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
- `claude` CLI installed and logged in
- about 90 minutes of wall clock and your attention at five forms

## Steps

Run every command inside this directory. [`answers/`](answers/) holds every form as the human
answered it, [`disagreements.yaml`](disagreements.yaml) the inventory gate's warnings as `recover-prd` takes them. `<ref>` stands for
`{kind: artifact, ref: {apiVersion: <group>/v1, kind: <Kind>, namespace: default, id: <id>, revision: <n>}}`,
the group `rewrite.persimmon.ai` for SourceInventory and ParityLedger, `sdd.persimmon.ai` for the rest.

### 1. The Source system: three checkouts under one directory

```sh
sh source.sh /tmp/claims-source      # copies example09's js, java and go, one git commit each; outside the project
persimmon init --pack rewrite
persimmon apply overrides.yaml       # the two readers, the Prd agent and the storming agent on claude-sonnet-5
```

The directory is no repository itself; each subdirectory is. Nothing under it is changed.

### 2. The Survey, once: six entry points, your cut

```sh
persimmon run survey --input source=/tmp/claims-source --input brief=@brief.txt --input productId=claims --follow
```

The reader wrote `source.repositories[]`, one per checkout with its commit, and six entry points
(`GET /` and `POST /claims`, three times), every `where` prefixed by its checkout (`js/src/server.js:8`).
It proposed three Slices, one per repository. The form `cut-slices` parks on you; the recorded answer
cut one Slice over all six entry points: three files per checkout is one agent's read, and the
storming needs all three to find where they differ. `survey-consistency` passed at round one.

### 3. The Slice's inventory: two readers, an auditor

```sh
persimmon run inventory --input source=/tmp/claims-source --input brief=@brief.txt --input productId=claims \
  --input slice=SL-1 --input 'base=<claims-inventory r1>' --input 'ledger=<claims-parity r1>' --follow
```

Seventeen guards over the three checkouts (method routing, the per-diem/threshold/receipt line
rule, the claim's completeness, receipt attachment, Java's regex parsing), six declarations (the
threshold of 25 and the claim id `c-<employee>`, three times each), six absences (an uncaught
malformed body in js and go; a receipt accepted as supplied; Java reading one line and never a
receipt), the tests of each checkout, seven open questions. Passed at round two.

The first live runs found the pack short: the reader read the first checkout's three files and
answered, twice over, and the auditor refused a Go method-routing guard whose `where` stopped at
its early return. The reading Task now lists every reached file in every checkout first, and the
rules say a branch in a second repository is a guard of its own, and an early return's other arm is
the code after it (`40-pack-rewrite.md`, decisions). The second reader still read js only; its
disagreements are warnings you settle at the next form.

### 4. The Prd and rules recovered, your Dispositions

```sh
persimmon run recover-prd --input brief=@brief.txt --input productId=claims --input slice=SL-1 \
  --input 'inventory=<claims-inventory r9>' --input 'ledger=<claims-parity r1>' --input disagreements=@disagreements.yaml --follow
```

`disagreements.yaml` is the inventory gate's `reader-disagreement` warnings as a YAML list. The
Prd agent wrote `Prd/claims-prd` (one subdomain, `expense-claims-completeness`, core; two capabilities;
five open questions) and `BusinessRules/claims-rules`. The form `decide-recovery` parks on you each
round. The recorded answers:

- round one: rejected. The auditor and the human both found BR-3 (receipt ownership) claimed at the
  HTTP entry points while every checkout reaches it from a unit test only. Dispositions `change` on
  AB-5 and AB-6: Java reads one line and never a receipt, and the brief says a difference is a
  finding. Twelve reader disagreements settled: the second reader read js only.
- round two: the auditor passed; `recovery-consistency` held seven plumbing guards open, "its
  plumbing pattern is not accepted", with no decision able to close them. The ledger now completes a
  plumbing guard the human accepts with a reason (`40-pack-rewrite.md`, decisions); the loop ran out
  of rounds first. A second `recover-prd` run took the last Prd and rules as `prd` and `rules`.
- second run, round one: BR-5 still stated Java's divergence as an active rule; rejected. Round two:
  BR-5 deprecated, BR-6 the decided rule with `source: decision`, first typed `fact`, then `decision`
  after one more finding. Every absence `keep` but AB-5 and AB-6, every plumbing guard accepted.
  `Prd/claims-prd.r5`, `BusinessRules/claims-rules.r5`, `ParityLedger/claims-parity.r6`.

### 5. Domain discovery: the storming over the inventory

```sh
persimmon get SourceInventory/claims-inventory.r9    # its spec.content to .persimmon/rewrite/inventory.yaml
persimmon run domain-discovery --input 'prd=<claims-prd r5>' --input 'rules=<claims-rules r5>' \
  --input inventory=@.persimmon/rewrite/inventory.yaml --follow
```

Three gates, you at each, `answers/storming-*.yaml` the recorded forms. The big picture cut one
context, `expense-claims-completeness`, core, realising the Prd's one subdomain, with no external
system: the three checkouts are one business, so the storming never saw three of anything. Round one
carried a "Submission rejected as malformed" event no implementation raises (AB-1 and AB-3 are
kept); rejected with that one finding, round two passed. The process level passed at round one:
five commands, two automatic policies, one read model. The design level raised one hotspot on the
`Claim` aggregate's size (five commands, six events, the grammar's smell); the human answered that
one aggregate stands, round two carried the resolution and passed. `derive-all` wrote
`BoundedContext/expense-claims-completeness`, its Glossary and DomainModel at round one, and
`domain-consistency` passed first time.

Wall clock on `claude-sonnet-5`: survey 5 min; the four inventory runs 16, 25, 17 and 22 min; the
two recovery runs 21 and 10 min; domain discovery 17 min, of it the derivation 3.

### 6. Stop

Analysis ends here: no Architecture, no Specs, no build, no parity. The ledger says what it would
owe a rewrite: every item of SL-1 `unverified`, its Oracle `static`, since nothing ran. A rewrite
later starts at `characterize` with the same project and artifacts.

### 7. Load the recorded output instead

```sh
persimmon init --pack rewrite
persimmon validate claims-domain.yaml        # 8 lines `ok`
```

`persimmon create` takes one document per file; split the file to load it, or read it as it is.
The recorded inventory is the Slice's (the Survey's is its first revision, not kept), the recorded
storming the design level.

## Reset

```sh
rm -rf .persimmon persimmon.yaml .claude AGENTS.md CLAUDE.md .gitignore /tmp/claims-source
```
