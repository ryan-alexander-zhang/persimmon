# Ports and bindings

status: active · layer: 1 · schema: [`schemas/ports.yaml`](schemas/ports.yaml)

Typed slots on definitions, typed values at run time, and the rules that connect them.

```text
definition                          run
  inputs:  {port: InputSpec}  ───▶  inputs:  {port: RuntimeValue}     bound by Binding
  outputs: {port: OutputSpec} ───▶  outputs: {port: RuntimeValue}     produced by the executor

PortType  value {schema?} | artifact {artifactKind} | artifacts {artifactKind} | externalResource {provider, type}
Binding   literal | fromInput | fromStep | fromState | fromIterationOutput | expression | fromEvent | fromArtifact | fromQuery
```

## Names

| Name | Grammar |
|---|---|
| port | `^[a-z][a-zA-Z0-9]*$` |
| step id | `^[a-z][a-z0-9-]*$` |
| Duration | `^[0-9]+(ms\|s\|m\|h\|d)$`, single unit |

## PortType

| kind | Fields | RuntimeValue |
|---|---|---|
| `value` | `schema?`: JSON Schema, or `{$ref: persimmon.ai/v1#/<Name>}` from the well-known set | `{kind: value, value}` |
| `artifact` | `artifactKind: {apiVersion, kind}` of a revisioned kind (`x-persimmon-kind-ref`) | `{kind: artifact, ref: RevisionRef}` |
| `artifacts` | `artifactKind`, as `artifact` | `{kind: artifacts, refs: RevisionRef[]}`, ordered, may be empty; every ref of the kind |
| `externalResource` | `provider`, `type` | `{kind: externalResource, ref: ExternalResourceRef}` |

Equality: `kind` and every field equal after expanding `$ref`. No subtyping.

## InputSpec, OutputSpec

| Field | InputSpec | OutputSpec |
|---|---|---|
| `type` | PortType | PortType |
| `required` | default true; or `{expression: <cel>}` over `inputs.<port>` of the same definition, `bool`: the input is required when it holds, decided at bind from the inputs present (`has(inputs.x)` for presence) | — |
| `default` | RuntimeValue of the port's kind; `required: false` only; applied when the binding omits | — |
| `description` | text | text |

`inputs` and `outputs` maps default to `{}`.

## Binding

| Shape | Value | Where |
|---|---|---|
| `{literal: <json>}` | as written, a `value` port | anywhere |
| `{fromInput: <port>}` | the enclosing definition's input | anywhere |
| `{fromStep: {stepRef, output}}` | a predecessor step's output | Workflow steps, output bindings |
| `{fromState: <var>}` | repeat loop state | inside `repeat` |
| `{fromIterationOutput: <port>}` | last iteration's output | `repeat.next` only |
| `{expression: <cel>}` | CEL result, a `value` port | anywhere |
| `{fromEvent: <root path>}` | engine projection of the Outbox event; roots per event kind in `16-trigger.md` | Trigger only |
| `{fromArtifact: {kind: {apiVersion, kind}, id: <cel>}}` | the latest committed revision, in the run's Namespace, of the artifact whose id the expression yields; an `artifact` port of that kind; absent when no revision exists | Workflow steps, `repeat` bindings, `outputBindings`; never a Gate, Trigger or Task output `id` |
| `{fromQuery: {kind: {apiVersion, kind}, where: <cel>}}` | every id of that kind in the run's Namespace, at its latest committed revision, for which `where` holds, ordered by id; an `artifacts` port of that kind; `where` reads the site's roots and `content`, the revision tested; none matching is an empty list, never absent, so no `onMissing`; a `where` that throws on a revision (an unguarded optional field: `has(content.x)`) or answers no bool fails the bind, naming the revision | Workflow steps, `repeat` bindings, `outputBindings`; never a Gate, Trigger or Task output `id` |

`onMissing: omit` on `fromInput`, `fromStep`, `fromState`, `fromIterationOutput`, `fromEvent`,
`fromArtifact`: skip the port when the source is absent; optional inputs only. An input is optional
when `required` is `false` or an expression: what the expression decides, only the run's values can
tell, so every static rule on required inputs treats it as optional and the bind refuses the run.

## Expression profile

CEL, with the environment of the site:

| Root | Content |
|---|---|
| `inputs.<port>` | enclosing definition's inputs |
| `steps.<id>.phase`, `steps.<id>.outputs.<port>` | causal predecessors |
| `steps.<id>.error.{code, message, retryable}` | only when `phase == "Failed"` |
| `steps.<id>.iterations` | how many iterations a finished `repeat` step ran (`11-workflow.md`) |
| `iteration.index` (1-based), `iteration.outputs.<port>` | inside `repeat` |
| `state.<var>` | the `repeat` state, typed by its declared InputSpec; inside `repeat`: body inputs and `next`, never `until` (`11-workflow.md`) |
| `event` | Trigger only |
| `artifacts.<port>.{content, provenance}`, a list of them for an `artifacts` port; `inputs.<port>` | `cel` Validator (`14-gate.md`) |

Artifact and externalResource values appear as their ref objects, an `artifacts` value as a
list of them. No side effects, no network, no custom functions; of the CEL string extension
only `lowerAscii()`, `upperAscii()`, `replace()`, `split()`, `trim()` and `join()` are relied on
(`@marcbachmann/cel-js` ships them; a Task's output `id` uses `lowerAscii()`).

Values enter CEL typed by the port schema: `integer` → `int`, `number` → `double`, `string`,
`boolean`, `array` → `list`, `object` → `map`. Map literals may mix value types.

## Well-known value schemas

`{$ref: "persimmon.ai/v1#/<Name>"}` resolves inside the engine.

| Name | Shape |
|---|---|
| `Finding` | `{severity: error \| warning \| info, code?, message}` |
| `ValidationResult` | `{passed, findings: Finding[], evidence: RevisionRef[], score?: 0..1}` |
| `GateResult` | `{passed, results: {<validator>: ValidationResult}}` |
| `RevisionRef`, `ExternalResourceRef` | `00-resource.md` |

## Rules

| Rule | Enforcer |
|---|---|
| `default` only with `required: false` | schema |
| `default.kind` equals `type.kind` | static checker |
| `value.schema` carries no `$ref` outside the well-known set, at any depth | static checker |
| producer type equals consumer type; `literal` and `expression` feed `value` ports only; `fromArtifact` produces an `artifact` of its `kind`, `fromQuery` an `artifacts` of its `kind` with `where` a `bool` (or `dyn`) at the site plus `content`, and its `id` expression type-checks as a string at the site | static checker |
| a Binding reads only causal predecessors in scope | static checker |
| `fromState`, `fromIterationOutput` only inside `repeat`; `fromEvent` only in Trigger | static checker |
| `onMissing: omit` only on optional inputs, never in output bindings | static checker |
| every `expression` parses and type-checks against its site's environment; a `required` expression against the definition's own `inputs`, as `bool`; never on a `repeat` state var (`11-workflow.md`) | static checker |
| an input whose `required` expression holds and is unbound fails the bind (`required input missing`), where a plainly required one does: at `run` for a Workflow, at the step for a Task, Gate or Validator; plainly required ports are checked first, and an expression that fails to evaluate is the same bind error | bind |
| `artifactKind` resolves to a registered revisioned kind at snapshot time; admission warns | walk (`04-snapshot.md`) |

## Decisions

- The execute payload carries every value port schema with its `$ref`s inlined from the design
  files, so an Adapter or a human form reads it alone. Found in implementation.
- Well-known `ArtifactRef` renamed `RevisionRef` everywhere, including the `$ref` id;
  `CONTEXT.md` amended. `EntityRef` dropped with entity indexing (`91-roadmap.md`).
- Step ids allow `-`. Reference allowed `_` only; every example and `logicalExecutionId` use `-`.
- `artifact` PortType carries `artifactKind` with `x-persimmon-kind-ref`, so the snapshot
  walk freezes the schema.
- `fromEvent` reads an engine projection, not the raw Outbox event, because payloads are
  pointers (`06-outbox.md`).
- `Finding.severity` gains `info`.
- CEL library: `@marcbachmann/cel-js`. Spike over every expression in `examples/`: it evaluates
  all of them and its `Environment.check` rejects unknown roots, unknown fields and type errors
  before any run, which is what static rule 11 needs. `cel-js` lacks the `size()` method form and
  `startsWith`; `@bufbuild/cel` has no exported checker. Needs `homogeneousAggregateLiterals: false`
  for the ValidationResult map literal.
- Port values bind to CEL by schema type, because a JSON integer bound as `double` makes
  `inputs.n + 1` a type error in every spec-conformant library.
- `inputs` and `outputs` optional on a definition.
- `required` takes an expression over the definition's own inputs, so one Task serves a value input
  that decides what else it needs: the pack's `design-asset` takes a DomainModel for an API or a
  schema and the API Designs for a `ui` Design, and without the rule it had to make all four optional
  and let a run that lacked one fail minutes later at review. The expression reads `inputs` only: the
  other roots are a step's business, and a port's requirement is the definition's. The override
  check compares `required` by value, so a Namespace override keeps the Global expression. Found in
  UAT.
- `fromArtifact` binds an artifact by id, not by ref, because a Workflow that repeats over a
  Prd's capabilities knows the Spec of `CAP-n` by its chosen id (`12-task.md`) but not its
  revision. "Latest committed revision at bind time" is the rule a run start follows for
  definitions (`04-snapshot.md`): a run started after a Spec's second round plans `r2`, one
  started before keeps `r1`; provenance pins whichever was bound. Bind reads the store, so the
  Sources carry a lookup the Handler supplies. Found in design review.
- `fromQuery` filters by content at bind, the same rule `fromArtifact` and `kind:<Kind>` follow:
  the latest committed revision per id in the run's Namespace, pinned in provenance. `where` is a
  CEL bool over the site and `content`, typed `dyn` statically, since the checker reads no kind
  schema; a field typo surfaces at bind, naming the revision. A list with no match is an answer
  (`design-coverage` over a model no Design names yet: everything unrealised), where
  `fromArtifact` asks for one id and absent means missing. A throwing `where` fails the bind
  rather than dropping the revision: a quietly shorter list is the bug a filter must not hide.
  First consumer `design-coverage`, which dropped its `designs` input; `plan-all` and a `ui`
  `design-all` keep the caller's `kind:Design`. Found in design review.
- `artifacts` is a PortType of its own, not a flag on `artifact`: one port holds any number
  of revisions of one kind, in the caller's order, because a Plan builds against every Design
  of its blocks and fixed slots cap the count. A `{kind: artifact, input}` context entry on it
  injects one entry per ref (`12-task.md`); an evaluator receives `artifacts.<port>` as a list
  (`14-gate.md`); each ref lands in `provenance.inputs`, once. A Workflow output passes it
  through; a Task output of it names an id prefix and the Adapter publishes the list's items as
  `<prefix>-<n>` in order (`12-task.md`), a rule that came when the Architecture process needed one
  Adr per strategy decision. Found in design review; the output in UAT.

## Examples

- [`examples/ports-task.yaml`](examples/ports-task.yaml): ports of the `write-prd` Task;
  validates against `#/$defs/Ports`
- [`examples/ports-runtime-values.yaml`](examples/ports-runtime-values.yaml): one of each
  RuntimeValue; validates against `#/$defs/RuntimeValue`
- [`examples/ports-bindings.yaml`](examples/ports-bindings.yaml): one of each Binding
  source; validates against `#/$defs/Binding`
