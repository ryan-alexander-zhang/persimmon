# example09: test levels by language, JavaScript, Java and Go

One small claims app three times, each in its own language, each with all four test levels and the
unit level's two minimums (`36-test-levels.md`). You build the worked example's `T-1` into it: the
run takes every level's baseline, then a round runs only what the change touches, measures coverage
and mutation over the changed lines, and after the task runs every level in full once more.

```text
build-all ─▶ baseline: unit, integration, api, e2e in full
          ─▶ round:    unit (affected) + coverage + mutation, then integration, api, e2e as the Change set selects
          ─▶ plan tier: every level in full again, regression-gate
```

| Level | JavaScript (`js/`) | Java (`java/`) | Go (`go/`) |
|---|---|---|---|
| unit | vitest 3, JUnit reporter; `vitest related` narrows a round | JUnit 5 on Surefire | `go test` through `gotestsum --junitfile` |
| coverage | v8 as Cobertura XML | JaCoCo XML, read as it is | `-coverprofile` through `gocover-cobertura` |
| mutation | Stryker 10, `--mutate={files}` | PIT 1.19 with the mutation-testing-elements plugin, `report.js`; `scripts/pit.sh` turns files into classes | Gremlins, its own JSON |
| integration | Testcontainers for Node | Testcontainers 2.0 on Failsafe | testcontainers-go, build tag `integration` |
| api | Bruno against the app, `scripts/api.*` starts it | the same | the same |
| e2e | Playwright 1.64, its `webServer` starts the app | the same | the same |

Each directory holds the app, `overrides.yaml` (the `test-runner` and `level-runner` Executors, and
you as the auditor), `change.patch` (what the builder changes for `T-1`) and `record.yaml` (the
AcceptanceRecord naming the tests, one of them the Bruno test as `{name, level: api}`).
[`audit.yaml`](audit.yaml) is the auditor's answer. No agent runs: you are the builder and the auditor.

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root
- Docker running (Testcontainers), `bru` (`npm install -g @usebruno/cli`), Node.js 22
- Java: JDK 21 and Maven 3.9
- Go: Go 1.24, and `go install gotest.tools/gotestsum@latest github.com/boumenot/gocover-cobertura@latest github.com/go-gremlins/gremlins/cmd/gremlins@latest`, `~/go/bin` on your PATH

## Steps

From the repository root, set `LANG_DIR` to `js`, `java` or `go`. The Change set is measured from a
commit and persimmon never commits, so the app runs in a git repository of its own:

```sh
C=$PWD X=$(mktemp -d) && cp -r examples/example09/$LANG_DIR/. $X && cd $X
git init -q && git add -A && git commit -qm baseline
npm install && npx playwright install chromium --only-shell
persimmon init && git add -A && git commit -qm "persimmon init"
awk '/^---$/{n++; next} {print > (".persimmon/up-" sprintf("%02d", n) ".yaml")}' $C/docs/design/examples/sdlc-domain.yaml
for f in $(grep -lE '^kind: (Plan|Spec|Architecture|Design|Glossary|BusinessRules)$' .persimmon/up-*.yaml); do persimmon create $f; done
persimmon apply overrides.yaml -n default
ref() { echo "{kind: artifact, ref: {apiVersion: sdd.persimmon.ai/v1, kind: $1, id: $2, revision: 1}}"; }
persimmon run build-all --input "plan=$(ref Plan submit-a-claim-plan)" --input 'tasks=[T-1]' --input "spec=$(ref Spec submit-a-claim)" \
  --input "architecture=$(ref Architecture expense-claims-architecture)" --input 'designs={kind: artifacts, refs: [{apiVersion: sdd.persimmon.ai/v1, kind: Design, id: claims-api, revision: 1}]}' \
  --input "glossary=$(ref Glossary expenses-glossary)" --input "rules=$(ref BusinessRules expenses-rules)" --input "repository=$PWD" --follow
```

The run takes the four baselines and parks on you, the builder. Make the change and answer:

```sh
git apply change.patch
persimmon complete <the implement form the run names> --file record.yaml
persimmon complete <the audit form it names next> --file $C/examples/example09/audit.yaml
persimmon get TestOutcome/submit-a-claim-plan-t-1-tests          # selection, coverage, mutation
persimmon get TestOutcome/submit-a-claim-plan-t-1-levels-2       # the api level
```

## What each run did

Recorded live, with these versions, on the change to BR-2 in one source file:

| | JavaScript | Java | Go |
|---|---|---|---|
| unit selection | `affected`: `vitest related src/claim.js` | `full`: Maven narrows nothing | `full` |
| coverage | 6 of 6 changed lines | 3 of 3 | 6 of 6 |
| mutation, round one | Stryker, 14 mutants on the changed lines, 92.86% | PIT, 87.5%: `mutation-low`, a survivor at `Claim.java:26` | Gremlins, 3 killed and 1 timed out, 100% |
| integration, e2e | `none`, untouched | `none`, untouched | `none`, untouched |
| api | `full`, the record names its test | the same | the same |
| plan tier | every level in full, passed | the same | the same |
| run | Succeeded, one round | Succeeded, two rounds | Succeeded, one round |

Java's first round is refused on purpose: no test shows that a line below the threshold needs no
receipt, so PIT's `return true` at `Claim.java:26` survives. `git apply round-2.patch` adds that test;
answer the second round with the same `record.yaml` and the audit, and the score reads 100.

## What the trial taught

- Testcontainers for Java needs 2.0 on Docker 29: 1.x asks the old API, which Docker answers with an
  empty `/info`, and fails with "Could not find a valid Docker environment".
- Gremlins' `--diff` compares commits, so on persimmon's uncommitted change it skips every mutant;
  run it over the package and let persimmon count the changed lines. With Go's cached test results
  its timeout is too tight and every mutant times out; `--timeout-coefficient=30` lets them be killed.
  Both read as `mutation-exit`, never as a pass.
- A Go toolchain without the `covdata` tool fails `-coverprofile` on a package with no tests;
  `scripts/unit.sh` covers `./claims/...` only.
- Bruno names a case by its `test()`, with the request URL as `classname`: the record names it by `name`.
- PIT targets classes, not files: `scripts/pit.sh` maps the changed `src/main/java/**.java` to class names.

## Reset

The app ran in `$X`, a temporary directory: `rm -rf "$X"`. Nothing in the checkout changes.
