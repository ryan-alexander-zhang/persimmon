# Gate and Validator

status: active · layer: 1 · schema: [`schemas/gate.yaml`](schemas/gate.yaml)

A Gate decides; a Validator asks a question; the Executor behind a Validator's Task answers.
A human, an agent and a script Executor are one shape behind a Validator.

```text
Gate {inputs, validators[], policy} ──▶ GateRun ──▶ ValidationRun per validator ──▶ outputs.result: GateResult
                                                          │
             Validator.evaluator ─────────────────────────┤
               cel     {expression}               ───────▶ engine evaluates
               task    {taskRef, resultOutput}    ───────▶ TaskRun; the Executor answers with a ValidationResult
               adapter {adapter, configuration}   ───────▶ callAdapter(evaluate), Role evaluator (19-adapter-roles.md)
```

## Gate

| Field | Rule |
|---|---|
| `inputs` | Ports (`10-ports.md`); `artifact` and `value` only |
| `outputs` | fixed: `result: {kind: value, schema: {$ref: persimmon.ai/v1#/GateResult}}` |
| `validators[]` | `{name, ref, inputs}`; `ref` is a LocalDefinitionRef to a Validator (`x-persimmon-ref`); `inputs` are `literal`, `fromInput` or `expression` Bindings over the Gate's inputs |
| `policy` | `{strategy: all \| any \| quorum, count?}`; default `all`; `count` with `quorum` only |
| `timeout` | Duration for the whole GateRun |

Step contract: `inputsPath: spec.inputs`, `outputsPath: spec.outputs`, `runKind: GateRun`,
`phasePath: status.phase`, `outputsValuePath: status.outputs`, `errorPath: status.error`.

| Case | Behaviour |
|---|---|
| GateRun starts | one ValidationRun per validator, all at once; deadline `min(step deadline, gate timeout, validator timeout)` |
| every ValidationRun Succeeded | `result.passed` per `policy` over all `len(validators)` results; no short-circuit; GateRun Succeeded |
| a ValidationRun Failed | GateRun Failed with that error |
| a ValidationRun Cancelled | GateRun Failed with `validator_cancelled` |
| GateRun past `timeout` | remaining ValidationRuns Cancelled; GateRun Failed with `timeout` |
| GateRun Succeeded with `passed: false` | a verdict, not a failure; the Workflow branches on `steps.<gate>.outputs.result.passed` |

## Validator

| Field | Rule |
|---|---|
| `inputs` | Ports; `artifact` and `value` only |
| `evaluator` | `cel` \| `task` \| `adapter`, shapes below |
| `timeout` | Duration for the ValidationRun |

| `evaluator.type` | Fields | Contract |
|---|---|---|
| `cel` | `expression` | CEL over `inputs.<port>` and `artifacts.<port>` = `{content, provenance}` typed by the frozen kind schema; returns boolean or a ValidationResult map |
| `task` | `taskRef` (`x-persimmon-ref`), `resultOutput` | the Task's `value` output `resultOutput` returns the ValidationResult; the Validator's inputs equal the Task's inputs name for name, type and `required` equal |
| `adapter` | `adapter` (`x-persimmon-adapter: {roles: [evaluator]}`), `configuration` | `callAdapter(evaluate)` returns a ValidationResult; `configuration` validates against `describe.configurationSchema` |

A `cel` boolean becomes `{passed, findings: [], evidence: []}`. Who approved is read from
`artifacts.<port>.provenance.actor`, never from a value input.

A `task` Validator's TaskRun has invocation address
`<workflowRunName>/<iterationPath>/<gateStepId>/<validatorName>`.

## Rules

| Rule | Enforcer |
|---|---|
| `quorum.count ≤ len(validators)`; validator `name`s unique | static checker |
| every required Validator input bound from a Gate input of equal type; an optional Gate input feeds a required Validator input only with a `default` | static checker |
| `cel` parses and type-checks against `inputs` and the frozen artifact schemas | static checker |
| `task`: `resultOutput` is a `value` output; Validator inputs equal the Task's | static checker |
| `adapter`: Adapter Ready with Role `evaluator`; `configuration` validates | as `13-executor.md` |
| every evaluator result validates against ValidationResult, else `schema_violation` | `validator` handler |
| GateRun and ValidationRun semantics above | `gate`, `validator` handlers (`17-runs.md`) |

## Decisions

- GateRun exposes its verdict at `status.outputs.result`, like every step kind. Reference
  had `status.result`.
- `any` and `quorum` count after every ValidationRun finishes; eager termination is roadmap.
  No Gate-level score aggregation; `ValidationResult.score` is informational.
- `evaluator.type` is closed: `cel`, `task`, `adapter`; the Adapter Role is always `evaluator`.
  Reference let `type` name the Role.
- Evaluator Adapters get no `credentials` or `security`; they run on Adapter-level bindings.
- Validator inputs are bound per Gate, so one Validator serves many Gates.
- `cel` sees `{content, provenance}` per artifact and may return a full ValidationResult.
- Gate and Validator inputs exclude `externalResource`: a Validator judges produced facts; a
  repository check is a `task` Validator whose Task reads the repository.
- A ValidationRun exists only under a GateRun in v1.
- `resultOutput` needs a `value` port; the ValidationResult `$ref` is recommended, the
  runtime check is what binds (reference rule 14; kept).
- Gate and Validator are `scope: Any`. `validateConfig` dropped for the evaluator Role too.
- Demo instance names are free text; `CONTEXT.md` governs design prose, not example names.

## Examples

- [`examples/gate-prd-approval.yaml`](examples/gate-prd-approval.yaml): three Validators,
  `quorum` 2; validates against `#/$defs/Gate`
- [`examples/kind-definition-gate.yaml`](examples/kind-definition-gate.yaml): Gate
  KindDefinition with fixed output and `stepContract`
- [`examples/validator-cel.yaml`](examples/validator-cel.yaml),
  [`examples/validator-task.yaml`](examples/validator-task.yaml),
  [`examples/validator-evaluator.yaml`](examples/validator-evaluator.yaml): one per
  evaluator type; validate against `#/$defs/Validator`
- [`examples/adapter-threat-model.yaml`](examples/adapter-threat-model.yaml): the Adapter
  behind the `adapter` Validator
