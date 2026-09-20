# Ports, Bindings, Expressions (design doc §5)

## Port types

`InputSpec = {type, required, default?, description?}`. `OutputSpec = {type, description?}`.
Every declared output must be present on success; no optional outputs.

`PortType` is a four-way exclusive union:

| kind | other fields | RuntimeValue shape |
|---|---|---|
| value | `schema` (JSON Schema) | `{kind: value, value: <JSON>}` |
| artifact | `apiVersion`, `artifactKind` | `{kind: artifact, ref: <ArtifactRef>}` |
| externalResource | `provider`, `resourceType` | `{kind: externalResource, ref: <ExternalResourceRef>}` |
| collection | `items` (a ScalarType) | `{kind: collection, items: [<ScalarValue>...]}` |

Collections do not nest. Plain scalars, small objects and plain JSON arrays use `value`.
Batches of ArtifactRefs use `collection` of `artifact`, never an untyped JSON array.

Missing and null differ. A missing optional input is absent from the input map. `null` is
valid only if `value.schema` permits it. `required: true` and `default` are mutually exclusive.
`default` is a RuntimeValue and must pass the same type check.

Workflow declares `outputs` (types) and `outputBindings` (values) with identical key sets.
Task declares only `outputs`. Gate has one fixed output `result`.

## Bindings

Each Binding has exactly one source:

| Field | Meaning and scope |
|---|---|
| literal | A complete RuntimeValue |
| fromInput | An input port of the current definition |
| fromStep | Named output of a completed, causally preceding step in the same invocation |
| fromState | Current repeat state variable; only for repeat body inputs |
| fromIterationOutput | Output of the just-finished body invocation; only for constructing next state |
| expression | Evaluated in an explicit environment; result wrapped as `kind: value` |

`fromStep` and `fromState` accept `onMissing: error | omit` (default error). `omit` is only
valid for optional inputs. Missing optional `fromInput` may propagate along optional chains
but never feed a required input. Output ports never use `omit`.

Expressions cannot produce artifact or externalResource port values. References flow only
through explicit literals or typed bindings.

Control dependency comes from Transitions, never implied by Bindings. Inputs read only
causal predecessors in the current scope: not self, not future steps, not other iterations,
not unrelated parallel steps that happened to finish first.

## Expression profile

Restricted CEL-compatible subset: JSON scalar literals, field access, parentheses, `!`,
`&&`, `||`, `== != < <= > >=`. No function calls, macros, indexing, network, clock, random.

Unpacking in the environment: value gives its JSON, artifact gives its Ref, externalResource
gives its Ref, collection gives an unpacked array. This is not artifact content loading.

| Site | Root variables |
|---|---|
| Binding / Transition `when` | `inputs`, `steps` (current invocation) |
| `repeat.until`, `repeat.next` | `iteration.outputs` |
| CEL Validator | `inputs`, `artifacts` (declared via `loadArtifacts`) |

`steps.<id>` exposes `phase` and `outputs`. Comparisons require compatible types. Missing
fields or wrong result types are execution errors, not `false`. Boolean positions must yield
booleans.

The design doc's `expression_profile.py` is a local checker, not a CEL implementation. A real
service uses a conformant CEL parser/checker/evaluator and keeps the profile restriction.
Parse, check and evaluate are separate phases.
