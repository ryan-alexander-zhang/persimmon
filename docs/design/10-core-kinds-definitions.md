# Layer 1: Core Definition Kinds

Kinds Persimmon ships for describing work. Each is registered on the framework
(`05-framework.md`) through a `KindDefinition` and a built-in `Handler`, exactly as a user
kind would be. Nothing here is special to the engine.

| Kind | mutability | snapshot | Handler (builtin) | Notes |
|---|---|---|---|---|
| Workflow | SpecMutable | Definition | `workflow` | `validate` enforces the static rules in this file |
| Task | SpecMutable | Definition | `task` | executor-agnostic since decision 24 |
| Executor | SpecMutable | Definition | `executor` | `validate` calls the adapter's `describe` |
| Gate | SpecMutable | Definition | `gate` | |
| Validator | SpecMutable | Definition | `validator` | |
| Prompt | SpecMutable | Definition | none | pure data |
| Skill | SpecMutable | Definition | `skill` | verifies digest when reachable |
| Trigger | SpecMutable | None | `trigger` | subscribes to framework events |
| RelationType | Immutable | Definition | none | pure data |

Artifact kinds are not a separate meta-kind: they are `KindDefinition`s with `revisioned:
true` (decision 27, see `30-artifact-kinds.md`). All core kinds live under
`apiVersion: persimmon.ai/v1`; `LocalDefinitionRef` fields are annotated `x-persimmon-ref` so
the framework can validate them and build snapshot closures.

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
- A Failed Workflow exports no outputs. Model a business rejection as Succeeded plus a verdict
  output (for example `accepted: false`) so the parent can branch on it and still read the
  produced artifacts. Reserve terminal Failed for "could not complete".
- Feedback for rework travels as artifacts (a ReviewReport), not as a GateResult value.
  GateResult is audit data; read `steps.<gate>.outputs.result.passed` for branching only.

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
with `fromStep: {stepRef, output}`; expressions read `steps.<id>.phase`,
`steps.<id>.outputs.<port>` and, only when the phase is Failed, `steps.<id>.error`
(`code`, `message`, `retryable`).

Routing on failure: a step has exactly one consuming Transition, so list both outcomes there
and branch with `when`. CEL `&&` short-circuits, so the guard is safe:

```yaml
from: [{stepRef: review, outcomes: [Succeeded, Failed]}]
to:
  - {stepRef: gate,   when: 'steps.review.phase == "Succeeded"'}
  - {stepRef: retry_review, when: 'steps.review.phase == "Failed" && steps.review.error.code == "timeout"'}
  - {terminal: Failed, reason: ReviewFailed}
dispatch: first
```

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
  until: "iteration.outputs.accepted || iteration.index >= inputs.maxRounds"
  maxIterations: 5                  # hard cap, includes the first iteration
```

No `repeat.timeout`: the step `timeout` is the budget for the whole loop; the body Workflow's
own `timeout` bounds one iteration. (Change from the baseline, decision 20.)

`until` and `next` see `iteration.outputs`, `iteration.index` (1-based) and `inputs` of the
enclosing Workflow. Exhausting `maxIterations` with `until` still false fails the step with
`iteration_limit` and exports nothing. To hand the last round downstream instead, end the
loop from `until` (as above) and branch on the body's verdict output.

Body inputs read state with `fromState: <var>` (plus `onMissing: omit` for optional state).
Each iteration is a new body WorkflowRun with its own invocation address and a `parent` link
(see `20-core-kinds-runs.md`).

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
  executorRef: {kind: Executor, name}       # the ONLY place that says who/what does the work
  action:
    instructions: string                    # what to do, in words
    context?: [ContextEntry]                # what to look at (see below)
    parameters?: {}                         # executor-type-specific, validated by the adapter
  timeout: Duration
  retryPolicy?: RetryPolicy
  sideEffects: none | idempotent | nonIdempotent
  resultProtocol: persimmon.result/v1
```

Task is executor-agnostic (decision 24). There is no `action.kind`. Swapping a human reviewer
for an agent reviewer, or an agent for a script, changes `executorRef` only. Fields that used
to live on the action move to `Executor.spec.configuration` (`approvalGroup`, `program`,
`resultFile`, `operation`) or to `action.parameters` when they vary per Task and the adapter's
`describe` schema declares them.

Consequence for Gates: *a Gate decides; a Validator asks a question; the Executor behind the
Validator's Task answers.* Human approval, AI review and script checks are the same shape and
differ only in which Executor is referenced. Mixing them is a Gate `policy` choice.

### Execution context (new)

`action.context` is an optional ordered list. Adapters declare in `describe.contextKinds`
which entry kinds they accept; the Executor handler rejects a Task whose context uses a kind
its adapter does not support (this replaces decision 21's per-action-kind rule).

```yaml
action:
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

Rules:
- Entries are ordered; adapters receive them in order, then `instructions`.
- `context` means "inject into the agent's working context". Inputs not listed remain
  fetchable through `getArtifact` but are not injected.
- An entry whose `input` is optional and absent at runtime is skipped. An absent required
  input fails the attempt with `invalid_input`.
- Core performs no templating or variable substitution. The TaskRun records the resolved list.
- No inheritance in this version; every Task states its own context.

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

`configuration` stays opaque. Model name, reasoning effort, sandbox settings, approval
group, script entry point and similar are adapter concerns. The Executor handler validates
`type`, `adapter`, `security`, and `configuration` against the adapter's `describe`
`configurationSchema` at admission (see `40-plugin-protocol.md`).

Adapter availability: `validate` warns `adapter_unavailable` when the adapter cannot be
reached; `apply` fails unless `--skip-adapter-validation` is given; snapshot resolution at
Run creation always requires the adapter.

`credentialBindings` name entries in the engine's CredentialStore (see `50-modes.md`). The
engine resolves them and passes secrets to the adapter for the attempt; they never appear in
definitions, snapshots, logs or run records.

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
  format: claude-code-skill/v1    # bundle format; must appear in the adapter's skillFormats
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
Runtime rules are in `20-core-kinds-runs.md`.

## Artifact kinds and RelationType

Artifact kinds are registered with `KindDefinition {revisioned: true}`; the `contentSchema`
of the baseline `ArtifactSchema` becomes that KindDefinition's `schema`. See
`30-artifact-kinds.md`. `RelationType` is unchanged (see `docs/reference/60`).

## LocalDefinitionRef

`kind` enum: Workflow, Task, Executor, Validator, Gate, RelationType, Prompt, Skill, plus any
`KindDefinition` marked `snapshot: Definition`. Trigger is excluded. Resolution: writer's
namespace first, then cluster scope (framework §7); this is how a namespace overrides a
shipped definition by name.

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
8. `action.parameters` and `action.context` validate against the referenced Executor's
   adapter `describe` (`parametersSchema`, `contextKinds`).
9. Bindings and `when` read only causal predecessors in scope; `fromState` and
   `fromIterationOutput` only inside `repeat`.
10. Port type equality between producer and consumer (explicit equality, no schema subtyping).
11. Expression profile: parse and type-check against the site's environment.
12. Context: `file` input is externalResource, `artifact` input is artifact, refs resolve,
    the Executor's adapter lists the Skill `format` in `skillFormats`.
13. Trigger: target Workflow inputs required by the Workflow are all bound; `fromEvent`
    types match the port types; the two loop-prevention rules above.
14. `task` evaluator: `resultOutput` names an existing `value` output. `value.schema` may
    `$ref` only the well-known core schemas.
15. Repeat state: required state variables are bound in both `initial` and `next`; `next`
    keys ⊆ `state` keys; `fromIterationOutput` names a body output of equal type;
    `until` type-checks to boolean in its environment.
16. Every artifact PortType in the definition closure resolves to a registered revisioned kind
    at snapshot time; admission of a single definition only warns.
