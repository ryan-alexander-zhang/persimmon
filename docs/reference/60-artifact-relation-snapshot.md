# Structured Artifacts, Relations, Snapshots (design doc §11–12)

## ArtifactSchema

Registers a `contentSchema` (Draft 2020-12) for one exact `apiVersion/kind`. It validates
`.spec.content`; the core schema validates envelope, identity and provenance. Published
schemas never change in place; no implicit conversion between schema versions.

Addressable objects carry `x-persimmon-entity: {kind, idField}` in the content schema. The
annotated node must be an object and `idField` a required string. Persimmon's entity indexer
consumes the annotation; plain JSON Schema validators ignore it.

Canonical source is the validated structured object, not YAML bytes. YAML/JSON are
serializations. Markdown, HTML, bundles and external sync results are representations listed
in `status.representations` (`name`, `uri`, `mediaType`, `digest`). An expiring URI is never an
identity. `status.contentDigest` is optional.

`ArtifactSpec`: `identity {id, revision}`, `content` (object), `provenance {producerRunRef?,
inputArtifacts[]}`.

## Relation

`Relation.from` / `to` are exclusive endpoints: ArtifactRef, EntityRef or ExternalResourceRef.
`RelationType` defines `predicate`, endpoint types, `inverse` name, `transitive` flag.
Relation also carries `evidence: ArtifactRef[]` and `assertedBy: ObjectRef`.

Example registrations, both non-transitive:

```text
ImplementationManifest.Change --implements--> ProductRequirementDocument.Requirement
VerificationReport.TestResult --verifies--> ProductRequirementDocument.AcceptanceCriterion
```

`inverse` is a query name; no reverse edge is stored. `contains` is projected from structure.

Relations bind exact revisions and do not inherit to new revisions with the same entity id.
A Relation is an auditable assertion, not a proof. Reference consistency, coverage
completeness, real test results and trusted approval are different evidence levels. Claims
without evidence may be stored but never gate a release by themselves.

## DefinitionSnapshot and Runs

WorkflowRun `spec` is immutable. Before first scheduling the server resolves the definition
closure into `status.snapshot` (set once). The snapshot contains the exact Workflow, Task,
Executor, Gate, Validator, ArtifactSchema and RelationType resources.

`SnapshotRef.digest` is SHA-256 of the archive bytes, not a resourceVersion, independent of
YAML key order. The server keeps the bytes long term and verifies the digest on read; an
unreachable URI fails rather than falling back to current definitions.

Data artifacts are frozen by immutable ArtifactRef plus retention, not by the definition
snapshot. External code, dependencies, build environments and adapter versions still need
recording. Same definition and inputs do not guarantee byte-identical LLM or external output.

- WorkflowRun: one invocation.
- TaskRun: one attempt; `attempt` from 1; records `logicalExecutionId`, `iterationPath`,
  optional `idempotencyKey`, inputs, snapshot. Validator-invoked TaskRuns record `validationRunRef`.
- ValidationRun: `result` exists only after success; records `loadedArtifacts`, `taskRunRefs`.
- GateRun: records `validationRunRefs` and `GateResult`.

Phases: Pending, Running, Waiting, Succeeded, Failed, Cancelled. Skipped exists only on
StepExecution; no TaskRun is fabricated for a step that never ran.

Status invariants encoded in schema: Succeeded requires `outputs`/`result`; any other phase
forbids them; Failed requires `error`; every other phase forbids `error` (Cancelled carries no
error). Terminal phases never revert; committed results are never rewritten by logs,
conditions or projections.
