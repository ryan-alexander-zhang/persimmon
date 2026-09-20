# Task and Executor (design doc §6)

Task defines what to do. Executor defines what capability runs it. `Executor.type` must equal
`Task.action.kind`.

| action.kind | Work fields | Executor role |
|---|---|---|
| agent | `instructions` | Registered agent adapter plus provider-specific config |
| script | `program`, `script`, `resultFile`, `environment` | Isolated process or container |
| tool | `operation` | Set of allowed operations |
| human | `instructions`, `approvalGroup` | Authenticated human work plus callback |

Tool arguments are the typed Task inputs; there is no separate `action.arguments`
interpolation syntax. Agents cannot add undeclared outputs. `modelAlias` and similar are
adapter configuration, not a cross-provider model API.

`Executor.configuration` is an adapter-specific object. Core structural validation cannot
prove a model or parameter is supported; the adapter validates at admission or startup.
`allowedOperations` and `security` are not credentials. `credentialBindings` name bindings
registered in the deployment; no token material.

`ExecutorSpec.security` requires `networkAccess` (`deny | allowlist`), `allowedHosts`,
`credentialBindings`.

## TaskResult protocol

```json
{
  "protocol": "persimmon.result/v1",
  "outputs": {
    "ok": {"kind": "value", "value": true}
  }
}
```

Scripts write this to the file named by `PERSIMMON_RESULT`. Stdout is not the protocol.

Artifact outputs are first published through the server publish interface, which yields an
exact immutable ArtifactRef; only then does the ref enter the TaskResult. Publication,
attempt success and output selection need a recoverable transaction. Staged content from a
failed attempt never becomes a workflow output.

Exit code 0 is insufficient. Missing outputs, wrong types, unregistered ArtifactSchema,
unauthorized reads or invalid refs fail the attempt. A test harness that crashes fails; a test
run that executes and reports failures may succeed with `VerificationReport.passed: false`.

## Side effects

- `none`: no persistent business change (compute cost still exists).
- `idempotent`: adapter deduplicates on a stable business operation key.
- `nonIdempotent`: no automatic re-execution.

All attempts of one logical step invocation share one `logicalExecutionId` / idempotency key.
A new repeat iteration has a new iteration address, hence a new business execution and a new key.

No claim of exactly-once across network systems. `unknown_result` after timeout is not
retried unless the adapter offers a safe query or idempotent recovery protocol.
