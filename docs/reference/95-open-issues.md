# Open Issues Found in Source Materials

Recorded during extraction. Resolutions belong in `docs/design`.

## Inconsistencies

- Design doc §13 sketch names a step `evidence_alignment`; examples.yaml has no such step. The
  two checks are validator ids `quality` and `traceability` in `Gate/engineering-quality`.
- The design doc's schema section is corrupted by inserted spaces (see `00-sources.md`).
- The design doc says Failed requires `error`; the schema additionally forbids `error` on every
  other phase, so Cancelled carries none.

## Rules stated in prose that the JSON Schema cannot express

A static checker must enforce them:

- `repeat` only on `uses.kind: Workflow` steps.
- Step `retryPolicy` only on Task steps.
- `quorum.count <= len(validators)` and `<= len(from)`.
- `retryOn ∩ abortOn = ∅`; forbidden codes in `retryOn`.
- `outputs` keys == `outputBindings` keys.
- `required: true` excludes `default`.
- `onMissing: omit` only on optional inputs; never on output bindings.
- DAG, explicit entry set, single transition owner per step, each step consumed once.
- `Executor.type == Task.action.kind`.
- `when` and bindings read only causal predecessors.
- No terminal mixed with steps, no two terminals, in one dispatch.
- Workflow reference graph is acyclic.
- Expression profile restriction (no calls, macros, indexing).
- Binding type equality between producer port and consumer port.

## Gaps relative to the research notes

The design doc has no: entrypoints, execution context sources, model/effort abstraction,
context inheritance, ChangeRequest handling, event triggers, fork/time travel, artifact scope
(internal/exported), `Blocked` phase or `waitingReason`, runtime backend choice, plugin
mechanism, local versus server deployment shape.
