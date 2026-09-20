# Definition Layer

Everything a user declares. All kinds use `apiVersion: persimmon.ai/v1` and the standard
envelope (`metadata.name`, `metadata.namespace`, server-managed `uid`, `resourceVersion`,
`generation`). Specs of Workflow, Task, Executor, Gate, Validator, Prompt, Skill and Trigger
may be edited in place; running Runs keep using their snapshot. ArtifactSchema and
RelationType are immutable after publish.

Unchanged from the design doc (see `docs/reference/20`, `30`, `40`, `50`): PortType,
RuntimeValue, Binding, expression profile, Action kinds, TaskResult protocol, Validator,
Gate, Transition, join/dispatch/noMatch, repeat, retry, timeout, Duration. This document lists
only the model surface and what changed.

## Workflow

```yaml
apiVersion: persimmon.ai/v1
kind: Workflow
metadata: {name: prd-create, namespace: demo}
spec:
  inputs:  {<port>: InputSpec}
  outputs: {<port>: OutputSpec}
  outputBindings: {<port>: Binding}     # same key set as outputs
  entry: [<stepId>...]                  # all zero-in-degree steps
  steps: [WorkflowStep...]
  transitions: [Transition...]
  timeout: Duration
```

Step `uses.kind` is one of `Task`, `Workflow`, `Gate`. No other step kinds.

Decisions applied:
- Strict DAG per invocation; loops only through `repeat` on `Workflow` steps.
- No named entrypoints. Variants (create / revise / review-only) are separate Workflows that
  share Tasks and shared tails extracted into sub-Workflows:

  ```text
  prd-create:  research -> prd-finalize
  prd-revise:  impact   -> prd-finalize
  prd-review:  prd-finalize
  ```

## Embedded types used by Workflow

Unchanged from the design doc; listed here so this document is self-contained.

### WorkflowStep

```yaml
- id: planning                      # ^[a-z][a-z0-9_]*$, unique in the Workflow
  uses: {kind: Task | Workflow | Gate, name: <definition name>}
  inputs: {<port>: Binding}         # one Binding per input port of the used definition
  timeout: Duration                 # covers queueing, attempts, backoff; required
  retryPolicy?: RetryPolicy         # Task steps only; replaces Task.retryPolicy wholesale
  repeat?: RepeatPolicy             # Workflow steps only
```

Step outputs are the used definition's outputs (Gate: fixed `result`). Other steps read them
with `fromStep: {stepRef, output}`; expressions read `steps.<id>.phase` and
`steps.<id>.outputs.<port>`.

### Transition

```yaml
- id: pr_decision
  from:
    - {stepRef: pr_gate, outcomes: [Succeeded]}     # outcomes ⊆ {Succeeded, Failed}
  join: {strategy: all | any | quorum, count?: int}
  to:
    - {stepRef: merge, when: "steps.pr_gate.outputs.result.passed"}
    - {terminal: Failed, reason: MergeApprovalRejected, when: "!steps.pr_gate.outputs.result.passed"}
  dispatch: all | first
  noMatch: fail | skip
```

Semantics (waiting threshold barrier, skip propagation, no eager join, terminal exclusivity)
are in `docs/reference/50-workflow-control.md`.

### RepeatPolicy

```yaml
repeat:
  state: {<var>: InputSpec}         # typed loop state
  initial: {<var>: Binding}         # evaluated in the outer scope
  next: {<var>: Binding}            # fromIterationOutput allowed here only
  until: "iteration.outputs.accepted"
  maxIterations: 5                  # includes the first iteration
  timeout: 6h
```

Body inputs read state with `fromState: <var>` (plus `onMissing: omit` for optional state).
Each iteration is a new body WorkflowRun with its own invocation address.

### RetryPolicy

```yaml
retryPolicy:
  maxAttempts: 3                    # includes the first attempt
  backoff: {strategy: fixed | linear | exponential, initial: 2s, max: 30s, jitter: none | full}
  retryOn: [timeout, rate_limit, transient_network]
  abortOn: [permission_denied, invalid_input, schema_violation]
```

### InputSpec, OutputSpec, PortType, RuntimeValue, Binding, Duration

See `docs/reference/20-ports-bindings-expressions.md`. Binding sources: `literal`,
`fromInput`, `fromStep`, `fromState`, `fromIterationOutput`, `expression`, plus `fromEvent`
inside Trigger only.

## Task

```yaml
kind: Task
spec:
  inputs, outputs
  executorRef: {kind: Executor, name}
  action: Action            # agent | script | tool | human
  timeout: Duration
  retryPolicy?: RetryPolicy
  sideEffects: none | idempotent | nonIdempotent
  resultProtocol: persimmon.result/v1
```

Human-in-the-loop is `action.kind: human`. It is an ordinary Task with typed outputs; an
approval workflow is composed from a human Task plus a Gate. No Approval primitive.

### Execution context (new)

`Action` of kind `agent` gains an optional `context` list. Other action kinds may use it
where the adapter supports it (`script` may receive files; `human` may receive prompts).

```yaml
action:
  kind: agent
  instructions: "Write the PRD. Preserve entity ids."
  context:
    - kind: file
      input: repository          # an externalResource input of this Task
      path: AGENTS.md
    - kind: artifact
      input: glossary            # an artifact input of this Task
    - kind: prompt
      ref: {kind: Prompt, name: write-prd-template}
    - kind: skill
      ref: {kind: Skill, name: prd-writer}
```

| kind | Fields | Resolution |
|---|---|---|
| file | `input`, `path` | `input` must be an externalResource port whose runtime ref carries `version`. Core records (ref, path); adapter reads the file at that version |
| artifact | `input` | `input` must be an artifact port. Core records the ArtifactRef; adapter loads content through the engine |
| prompt | `ref` | LocalDefinitionRef to a Prompt. Content frozen in the snapshot |
| skill | `ref` | LocalDefinitionRef to a Skill. Digest frozen in the snapshot; adapter fetches and verifies |

Rules: context entries are ordered; adapters receive them in order. Core performs no
templating or variable substitution. The TaskRun records the resolved context list.
No inheritance in this version; every Task states its own context.

## Executor

```yaml
kind: Executor
spec:
  type: agent | script | tool | human
  adapter: <adapter id>           # e.g. claude-code/v1, codex/v1, subprocess/v1
  configuration: {}               # opaque; validated by the adapter
  allowedOperations: [string]
  security:
    networkAccess: deny | allowlist
    allowedHosts: [string]
    credentialBindings: [string]  # names only, never secrets
```

`configuration` stays opaque. Model name, reasoning effort, sandbox settings and similar are
adapter concerns. Core validates `type`, `adapter`, `security` and the requirement
`Executor.type == Task.action.kind`. The adapter's `describe` call (see `40-plugin-protocol.md`)
returns a JSON Schema that the engine uses to validate `configuration` at admission.

## Gate and Validator

Unchanged. Gate is a first-class step kind with fixed output `result: GateResult`. Any
validator execution error fails the GateRun regardless of policy.

### Task evaluator result contract

A `task` evaluator names `resultOutput`, a `value` output of the Task. Checks:

- Static: the named output exists and its `type.kind` is `value`.
- Runtime: the returned value is validated against the ValidationResult schema before the
  ValidationRun succeeds. Mismatch fails the ValidationRun with `schema_violation`, which
  fails the GateRun.

Authors should declare the port with the well-known schema so the contract is visible:

```yaml
outputs:
  result:
    type: {kind: value, schema: {$ref: "persimmon.ai/v1#/ValidationResult"}}
```

### Well-known value schemas

Core exposes its embedded types as JSON Schemas addressable by `$ref` from any
`value.schema`. Resolution is local to the engine; no network fetch.

| `$ref` | Type |
|---|---|
| `persimmon.ai/v1#/ValidationResult` | passed, findings[], evidence[], score? |
| `persimmon.ai/v1#/GateResult` | passed, results{} |
| `persimmon.ai/v1#/Finding` | severity, code?, message |
| `persimmon.ai/v1#/ArtifactRef` | apiVersion, kind, namespace, id, revision |
| `persimmon.ai/v1#/ExternalResourceRef` | provider, type, id, locator, version?, url? |
| `persimmon.ai/v1#/EntityRef` | artifactRef, entityKind, id |

Only these refs are allowed inside `value.schema`; any other `$ref` is rejected at admission.
Port type equality (static rule 10) treats a `$ref` and its expanded schema as equal.

## Prompt (new)

Versioned instruction text referenced from Task context.

```yaml
kind: Prompt
metadata: {name: write-prd-template, namespace: demo}
spec:
  mediaType: text/markdown
  content: |
    You are writing a product requirement document...
```

Content is opaque to the engine. The snapshot stores the full content, so a TaskRun proves
which text was used. Templating is the adapter's concern; the engine passes typed inputs
separately.

## Skill (new)

Reference to an opaque, versioned capability bundle (for example a Claude Code skill
directory or a Codex plugin).

```yaml
kind: Skill
metadata: {name: prd-writer, namespace: demo}
spec:
  source:
    provider: git | oci | https | file
    type: string                  # e.g. repository, image, archive
    id: string
    locator: {}                   # provider-specific
    version: string               # required: commit, tag digest, etc.
  digest: sha256:<64 hex>         # of the bundle bytes as the adapter fetches them
  adapterTypes: [agent]           # executor types that may consume it
```

`source` reuses ExternalResourceRef with `version` mandatory. The engine verifies the digest
when it can fetch the bundle and records it in the snapshot; adapters verify it again before
use. The engine does not interpret bundle contents.

## Trigger (new)

Creates a WorkflowRun in response to an engine event. Not referenceable by other kinds.

```yaml
kind: Trigger
metadata: {name: on-change-request, namespace: demo}
spec:
  on:
    kind: artifactPublished
    apiVersion: engineering.persimmon.ai/v1
    artifactKind: ChangeRequest
  run:
    workflowRef: {kind: Workflow, name: prd-revise}
    inputs:
      changeRequest: {fromEvent: artifact}
      currentPrd:    {fromEvent: content.targetPrd}
    timeout: 24h
  enabled: true
```

Event kinds in this version:

| kind | Selector fields | `fromEvent` roots |
|---|---|---|
| artifactPublished | `apiVersion`, `artifactKind` | `artifact` (ArtifactRef), `content.<path>` (value) |
| workflowRunFinished | `workflowRef`, `phases` (subset of Succeeded, Failed, Cancelled) | `run` (ObjectRef), `outputs.<port>`, `phase` |

`fromEvent` is a Binding source valid only inside `Trigger.spec.run.inputs`. `content.<path>`
produces a `value`; artifact and run refs produce typed refs. Ordinary Binding sources
(`literal`) are also allowed there.

Static rules: the target Workflow's declared outputs may not include the triggering
`artifactKind`; a `workflowRunFinished` trigger may not target its own `workflowRef`.
Runtime rules are in `20-runtime-layer.md`.

## ArtifactSchema and RelationType

Unchanged (see `docs/reference/60`). They type the data layer but are declared here because
they are immutable definitions included in snapshots.

## LocalDefinitionRef

`kind` enum extends to: Workflow, Task, Executor, Validator, Gate, ArtifactSchema,
RelationType, Prompt, Skill. Trigger is excluded. Resolution stays namespace-local.

## Static validation rules

The JSON Schema checks structure. A separate static checker enforces, at admission and before
snapshotting:

1. `repeat` only on `uses.kind: Workflow`; step `retryPolicy` only on Task steps.
2. `quorum.count <= len(validators)` in Gate; `<= len(from)` in Transition.
3. `retryOn ∩ abortOn = ∅`; `permission_denied`, `invalid_input`, `schema_violation` not in `retryOn`.
4. `outputs` keys == `outputBindings` keys; `required: true` excludes `default`.
5. `onMissing: omit` only for optional inputs; never in output bindings.
6. DAG; `entry` equals the zero-in-degree set; exactly one owning Transition per non-entry
   step; each step consumed once; one dispatch never mixes terminal and step or two terminals.
7. Workflow reference graph acyclic.
8. `Executor.type == Task.action.kind`.
9. Bindings and `when` read only causal predecessors in scope; `fromState` and
   `fromIterationOutput` only inside `repeat`.
10. Port type equality between producer and consumer (explicit equality, no schema subtyping).
11. Expression profile: parse and type-check against the site's environment.
12. Context: `file` input is externalResource, `artifact` input is artifact, refs resolve,
    Skill `adapterTypes` includes the Executor type.
13. Trigger: target Workflow inputs required by the Workflow are all bound; `fromEvent`
    types match the port types; the two loop-prevention rules above.
14. `task` evaluator: `resultOutput` names an existing `value` output. `value.schema` may
    `$ref` only the well-known core schemas.
