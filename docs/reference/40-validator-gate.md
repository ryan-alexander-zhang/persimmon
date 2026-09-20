# Validator and Gate (design doc §7)

## ValidationResult

```text
passed:   boolean
findings: Finding[]      severity: info | warning | error | blocker; code?; message
evidence: ArtifactRef[]
score:    optional, 0..1
```

## Evaluators

1. `cel`: `loadArtifacts` maps alias to an artifact input name; `passed` is an expression over
   the loaded exact revisions. `artifacts.<alias>` is the Artifact `spec`, so business content
   is at `artifacts.<alias>.content`. Loading checks access, type, revision and retention
   before evaluation. The expression does no I/O.
2. `task`: invokes a Task; `resultOutput` names a `value` output that must be a complete
   ValidationResult.

## Gate

Gate takes inputs, runs every declared Validator, aggregates with `all | any | quorum`.
No short-circuit in v1. `quorum.count` is in `1..len(validators)`.

No `Gate.score`. Per-validator scores stay at `result.results.<validatorId>.score`.

| Execution fact | Run.phase | Result |
|---|---|---|
| Completed, condition met | Succeeded | `passed: true` |
| Completed, condition not met | Succeeded | `passed: false` |
| Load failure, timeout, expression error, adapter error | Failed | `error`; no result |

Any Validator execution error fails the GateRun, even under `any` or `quorum`. "Cannot verify"
never becomes "enough remaining votes".

Example: `Gate/engineering-quality` has two validators: `quality` (CEL; report results, commit
and refs align) and `traceability` (Task `check-traceability`; independently recomputes
requirement and acceptance-criterion coverage). A single `coverageComplete: true` field is not
sufficient to pass.
