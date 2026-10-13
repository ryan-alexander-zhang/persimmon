# Persimmon

A framework that runs a software delivery lifecycle as declared resources. The engine knows
resources, kinds, handlers, runs, events, snapshots and adapters; every business meaning is a
kind registered on top.

```text
Layer 3  User kinds        same registration path as Layer 1
Layer 2  SDLC pack         Layer 1 instances installed by `init`
Layer 1  Core kinds        Workflow Task Gate Validator Executor Prompt Skill Trigger, artifact kinds
Layer 0  Framework         kind-agnostic resource runtime
```

Dependency runs downward only. Layer 0 names no Layer 1 kind.

## Language

### Layer 0: framework

**Resource**:
A stored object with the envelope `apiVersion`, `kind`, `metadata`, `spec`, `status`. Users
write `spec`; the owning **Handler** writes `status`.
_Avoid_: object, record, entity, CR

**Kind**:
A resource type, named `group/version` + `Kind`. Registered by one **KindDefinition**.
_Avoid_: type, CRD, resource type

**KindDefinition**:
The global resource that registers a **Kind**: schema, scope, mutability, snapshot behaviour,
`handlerRef`, `terminal`, optional `stepContract`. One per kind.
_Avoid_: CRD, kind schema, type definition

**Handler**:
The global resource that binds one or more kinds to behaviour, built in or via an **Adapter**.
Contract: `validate` and `reconcile`. Stateless between calls.
_Avoid_: controller, operator, plugin

**Reconcile**:
One call `reconcile(resource, event, context)` returning a status patch and **Actions**,
committed in one store transaction keyed by `(uid, sequence)`.
_Avoid_: tick, step, process

**Event**:
One of the closed set the framework delivers to `reconcile`: Created, SpecUpdated,
ChildFinished, TimerFired, Signal, CancelRequested, AdapterFinished. At-least-once, per-resource
order.
_Avoid_: message, notification, trigger

**Outbox event**:
An open-string event (`resource.created`, `artifact.published`, …) written to the **Outbox**.
Delivered to subscribed kinds as a Signal **Event**.
_Avoid_: bus event, domain event, event (unqualified)

**Action**:
The only way a **Handler** changes the world: `createResource`, `cancelResource`,
`publishArtifact`, `commitScope`, `abandonScope`, `emitEvent`, `setTimer`, `clearTimer`,
`callAdapter`, plus the `statusPatch` in the reconcile result. All commit atomically.
_Avoid_: command, effect, operation

**Terminal**:
The `KindDefinition.terminal {path, values}` the engine watches. Reaching a listed value emits
ChildFinished to the parent. Terminal values never revert.
_Avoid_: done, finished, complete

**Child**:
A resource created by `createResource`; carries `ownerReferences` to its parent. One parent,
many children.
_Avoid_: sub-resource, dependent

**Snapshot**:
A definition closure frozen at resource creation, serialized canonically, stored by
`{uri, digest}` in `metadata.snapshot`. Children inherit it. Digest verified on read, no
fallback.
_Avoid_: DefinitionSnapshot, version, freeze, pin

**Definition**:
A resource whose kind has `snapshot: Definition`; part of any **Snapshot** that reaches it.
_Avoid_: spec, template, blueprint

**Step contract**:
`KindDefinition.stepContract`: input and output port paths, `runKind`, phase, outputs and
error paths. Makes any kind usable as a **Step** by any composing kind.
_Avoid_: step interface, step kind enum

**Revisioned kind**:
A kind with `revisioned: true`: an append-only series of immutable revisions under one stable
`identity.id`. Framework adds `identity`, `content`, `provenance`, `contentDigest`,
`representations`.
_Avoid_: versioned kind, artifact kind (in Layer 0 text)

**Publication scope**:
Staging area for revisions published during one `callAdapter`, keyed by its `idempotencyKey`.
Visible after `commitScope`; abandoned by `abandonScope` or owner reaching **Terminal**.
_Avoid_: scope (unqualified), transaction, batch

**Actor**:
`{kind: user | service | handler, id, display?}` from the authenticated channel. Stamped on
every write and on `provenance.actor`.
_Avoid_: user, principal, identity, author

**Adapter**:
Out-of-process code the engine talks to through `persimmon.adapter/v1` over stdio or http.
Registered as a global `Adapter` resource with `id`, `roles`, `transport`. Must be Ready.
_Avoid_: plugin, provider, connector, integration

**Role**:
A named operation set an **Adapter** reports in `describe`. Framework knows `handler`; Layer
1 adds `executor`, `evaluator`.
_Avoid_: capability, interface, type

**Describe**:
The `describe` operation result, cached in `Adapter.status.describe`; its digest is recorded
in snapshots.
_Avoid_: manifest, capabilities, metadata

**Conformance suite**:
`persimmon adapter test <id>`: the engine's side of `persimmon.adapter/v1` played against one
**Adapter**, one verdict per numbered rule (`E1`…). Runs offline through a stub the Adapter names,
or live once.
_Avoid_: compliance test, certification, contract test, smoke test

**Reference**:
One of four validated shapes: **ObjectRef** (existing resource), **LocalDefinitionRef**
(kind + name, writer's namespace then global), **RevisionRef** (revisioned kind + id +
revision), **ExternalResourceRef** (provider, type, id, locator, version?, url?).
_Avoid_: pointer, link, handle

**Namespace**:
Scope unit for Namespaced kinds. A same-name definition in a namespace shadows the global one.
_Avoid_: project, tenant

**Global**:
Kind scope with no namespace: KindDefinition, Handler, Adapter, pack definitions.
_Avoid_: cluster-scoped, system, shared

**Mode**:
How the one engine library runs: **local** (CLI, in-process, SQLite) or **server** (daemon,
Postgres, HTTP clients). Same semantics. Server mode is roadmap.
_Avoid_: cloud mode, CLI mode, deployment, environment

**Store**:
One storage interface, one implementation per **Mode**, SQLite now: ResourceStore, RunLog,
SnapshotStore, BlobStore, Outbox, TimerStore, CredentialStore, AuditLog, LeaseStore, TokenStore.
_Avoid_: database, backend, repository

**RunLog**:
Append-only per-resource event log; the only log. Resume = redeliver undelivered events and
outstanding adapter calls.
_Avoid_: journal, history, WAL

**Transcript**:
An agent's output lines in the **RunLog**, at most 5000 per stream per **Attempt**, credentials
redacted; read with `persimmon logs`.
_Avoid_: log (unqualified), trace, output

### Layer 1: definition kinds

**Workflow**:
A **Definition** kind: a strict DAG of **Steps** joined by **Transitions**, with typed inputs
and outputs. Loops only through `repeat`.
_Avoid_: flow, process, DAG

**Composition kind**:
A **Definition** kind with `expansion`: sugar that a Handler's `expand` turns into Workflow or
Gate Resources at write and at snapshot. Shipped: **Pipeline**, **Approval**, **ReviewLoop**.
_Avoid_: macro, template, sugar kind

**Expansion**:
The Resources `expand` produces for a **Composition kind**: the first of the target kind with
the composition's name, then helpers named `<name>-<suffix>`. A run pins the expansion in its
snapshot.
_Avoid_: compilation, lowering, generated workflow

**Pipeline**:
A **Composition kind**: **Phases** in order, expanding to a Workflow with implied Transitions.
Fail-fast; a gate phase rejects with `<id>_rejected`.
_Avoid_: linear workflow, chain

**Phase**:
One entry of `Pipeline.spec.phases`, a **Step** whose position is its routing.
_Avoid_: stage, step (inside a Pipeline)

**Approval**:
A **Composition kind**: **Approvers** under a `policy`, expanding to a **Gate** and one
**Validator** per approver.
_Avoid_: sign-off, review gate

**Approver**:
One entry of `Approval.spec.approvers`: a Task, human or agent, whose `resultOutput` is a
ValidationResult.
_Avoid_: reviewer (for the Resource), voter

**ReviewLoop**:
A **Composition kind**: `produce` then `review`, repeated with `previous` and `feedback` until
`passed` or `maxRounds`; expands to a Workflow and its `<name>-round` body. `maxRounds` names
both the ceiling on the loop and the optional run input that lowers it.
_Avoid_: revision loop, feedback loop

**Step**:
One entry in `Workflow.spec.steps`: `id`, `uses` (any kind with a **Step contract**), input
**Bindings**, `timeout`, optional `repeat`. Runs as a **Child** of the WorkflowRun.
_Avoid_: node, stage, activity, job

**Transition**:
Routing from one or more finished **Steps** to next steps or a terminal, with `join`, `when`,
`dispatch`, `noMatch`. Exactly one consuming Transition per non-entry step.
_Avoid_: edge, dependency, link, arrow

**Repeat**:
`Step.repeat`: typed loop state, `initial`, `next`, `until`, `maxIterations`. Each iteration is
a new `runKind` instance. Step `timeout` bounds the whole loop. `steps.<id>.iterations` reads
how many iterations a finished repeat step ran.
_Avoid_: loop, retry, iteration (for the policy)

**Task**:
A **Definition** kind: one unit of work with `action` (instructions, **Context**, parameters,
**Workspace**), `executorRef`, `timeout`, `retryPolicy`, `sideEffects`. Executor-agnostic.
_Avoid_: job, action, activity, function

**Workspace**:
`Task.action.workspace`: the directory an **Attempt** runs in; the agent's cwd, a script's cwd,
the root of `file` context paths. Absent: the project directory.
_Avoid_: working directory, cwd, sandbox root

**Executor**:
A **Definition** kind naming who does a **Task**: `type` (agent, script, tool, human),
`adapter` id, opaque `configuration`, `security`. The only place that says who works.
_Avoid_: runner, worker, agent (as the kind), backend

**Context**:
`Task.action.context`: ordered entries of kind `file`, `artifact`, `prompt`, `skill`. Prompts and
artifacts go into the prompt; files are paths into the **Workspace**; Skills are installed in the
Workspace and verified. Resolved list recorded in `TaskRun.status.context`.
_Avoid_: inputs, attachments, references, prompt

**Prompt**:
A **Definition** kind: instruction text, opaque to the engine, frozen in snapshots.
_Avoid_: template, instructions, system prompt

**Reading**:
What a human executor reads before answering: the resolved `prompt` and `artifact` **Context**
entries with their content, in order, as the `cli-human/v1` form's `reading[]`. The
**Executor** answers; the reading is what it answers about.
_Avoid_: review, attachments, materials, evidence (that is the ValidationResult field)

**Skill**:
A **Definition** kind: reference to an opaque capability bundle by **ExternalResourceRef**,
`digest`, `format`. Installed once into the **Workspace** by `persimmon skill install`; the
digest is verified at every **Attempt**.
_Avoid_: plugin, tool, extension, package

**Gate**:
A **Definition** kind and step kind that decides: runs **Validators** under a `policy`, emits
fixed output `result: GateResult`. A Gate decides; a Validator asks; the Executor answers.
_Avoid_: check, checkpoint, review

**Validator**:
A **Definition** kind: one question asked by a **Gate**, answered by `cel`, a `task`, or an
evaluator **Adapter**. Produces a ValidationResult.
_Avoid_: check, rule, assertion, reviewer

**Trigger**:
A kind that creates a WorkflowRun from an **Outbox event** (`artifactPublished`,
`workflowRunFinished`). Not referenceable; not in snapshots.
_Avoid_: hook, listener, subscription, watcher

**Firing**:
One **Trigger** reacting to one **Outbox event**: the Signal, the bound inputs, the created
WorkflowRun.
_Avoid_: activation, invocation (for the Trigger)

**Binding**:
How a port gets its value: `literal`, `fromInput`, `fromStep`, `fromState`,
`fromIterationOutput`, `expression`, `fromEvent` (Trigger only).
_Avoid_: mapping, wiring, assignment

**Port**:
A typed input or output slot: `InputSpec` or `OutputSpec` with a **PortType**.
_Avoid_: parameter, argument, field, variable

**PortType**:
`value` (with optional well-known `$ref` schema), `artifact` (a revisioned kind), or
`externalResource`. Producer and consumer types must be equal.
_Avoid_: data type, schema (unqualified)

**Static rule**:
A cross-field or graph rule the JSON Schema cannot express, enforced by the static checker at
admission and before snapshotting.
_Avoid_: lint, validation (unqualified), constraint

**RelationType**:
An immutable **Definition** kind typing a **Relation** between artifact, entity or external
endpoints.
_Avoid_: link type, edge type

### Layer 1: run kinds

**Run**:
An Immutable, `snapshot: None` kind whose `status.phase` is the **Terminal**: WorkflowRun,
TaskRun, GateRun, ValidationRun.
_Avoid_: execution, instance, job, invocation (for the resource)

**WorkflowRun**:
One invocation of a **Workflow**; `snapshotOnCreate: true`; `origin` manual, trigger or
parent. The top run is the root; a body run has `origin: parent`. `timeout`
defaults to the Workflow's.
_Avoid_: pipeline run, execution, job

**TaskRun**:
One per **Step** invocation of a **Task**; identity `logicalExecutionId`; owns `attempts[]`.
_Avoid_: task execution, job, attempt (for the resource)

**Attempt**:
One `callAdapter(execute)` inside a TaskRun, keyed `logicalExecutionId/<index>`; states
running, succeeded, failed, unknown. Retries are attempts, never new TaskRuns.
_Avoid_: retry, try, run, execution

**Invocation address**:
`{workflowRunRef, stepRef, iterationPath, logicalExecutionId}`; `logicalExecutionId` is
`workflowRunName / own iteration / stepRef`, unique because the run name carries the enclosing
iterations.
_Avoid_: path, key, id (unqualified)

**Phase**:
`Pending → Running → (Waiting ↔ Running) → Succeeded | Failed | Cancelled`. Terminal phases
never change. `waitingReason` is free text.
_Avoid_: state, status (for the enum), stage

**Tree**:
A run, what it produced, and every run it owns, nested, as `persimmon tree` prints it; `run
--follow` and `complete` end with it.
_Avoid_: graph, hierarchy, status view

**Unknown**:
Attempt or adapter-call state when the result is not recorded. Never success. The Handler
queries if the Adapter supports it, else fails the attempt `unknown_result`, retried unless
`nonIdempotent`.
_Avoid_: pending, lost, timeout

**Signal**:
The **Event** carrying an external input: adapter `signal` callback, `persimmon signal`, or an
**Outbox event** match. Carries an **Actor** when external.
_Avoid_: callback, webhook, completion, notification

### Layer 1: artifacts

**Artifact**:
An instance of a **Revisioned kind** in Layer 1 and above. One `identity.id`, many revisions.
_Avoid_: document, output, deliverable, file, asset

**Artifact kind**:
A **KindDefinition** with `revisioned: true`; its `schema` validates `spec.content`.
_Avoid_: ArtifactSchema, artifact type, content type

**Revision**:
Integer ≥ 1 reserved per publication; gaps allowed, reuse never. Abandoned revisions stay
stored, unreadable by **RevisionRef**.
_Avoid_: version, generation, edition

**Provenance**:
`spec.provenance {producerRef, inputs[], actor}`: all three required and stamped by the engine,
never kept from the writer; `actor` is the committing reconcile's **Actor**.
_Avoid_: lineage, metadata, source

**Representation**:
Bytes of an **Artifact** in a media type (Markdown, HTML, bundle), stored in BlobStore at
`blob://<digest>`.
_Avoid_: rendering, export, format, attachment

**Relation**:
Immutable assertion between two endpoints typed by a **RelationType**, with `evidence[]`.
_Avoid_: link, edge, association

**Publish**:
Stage a revision through the `publishArtifact` **Action** or engine callback; visible only
after commit. `persimmon create` of a revisioned Resource publishes too, stamped by the engine
(`05-revisioned-kind.md`).
_Avoid_: save, write, upload

### Layer 1: adapter roles

**Executor role**:
Adapter **Role** bound from `Executor.spec.adapter`: `describe`, `execute`, `query`, `cancel`;
a result returns from `execute`; human completion arrives through the `signal` callback.
_Avoid_: executor adapter, runner, driver

**Evaluator role**:
Adapter **Role** bound from `Validator.spec.evaluator.adapter`: `describe`, `evaluate`.
_Avoid_: judge, checker, validator adapter

**TaskResult**:
The `persimmon.result/v1` object an **Attempt** returns: declared outputs only, matching types.
_Avoid_: result, output, response

**Engine callback**:
Operations a **Handler** or **Adapter** calls on the engine with a scoped token: `getResource`,
`list`, `getArtifact`, `getBlob`, `putBlob`, `publishArtifact`, `getKindSchema`, `log`, `signal`.
_Avoid_: API, engine API, SDK

### Layer 2

**Pack**:
A directory of definitions applied together: `global/` as **Global**, `namespaced/` into
`defaultNamespace` (the Trigger). Overridable by name in a **Namespace**.
The SDLC pack ships Workflows, Tasks, Gates, Validators, Executors, Prompts, Triggers,
artifact kinds and RelationTypes; no kinds of its own.
_Avoid_: bundle, library, preset, plugin

**AI Native pack**:
The second shipped **Pack** (`packs/ai-native/`, `23-pack-ai-native.md`): a spec-driven delivery
process, domain artifacts first. Group `sdd.persimmon.ai`.
_Avoid_: SDD pack, real SDLC pack, process pack

**BoundedContext**:
**Artifact kind** of the AI Native pack: where one domain model holds; `inScope`, `outOfScope`,
`relationships` (its own view of the context map). Cited by artifact id.
_Avoid_: domain, module, subsystem, context (bare)

**Glossary**:
**Artifact kind**, one per **BoundedContext**: the ubiquitous language; a term's identity is its
`name`, documents cite it by using it.
_Avoid_: dictionary, terms list, vocabulary

**Fact type**:
`Glossary.factTypes[]` entry (SBVR): what can be said about a term, `subject predicate object`; the
object is a term or a typed value. The typed input of a rule's logic and of a **DecisionTable**.
_Avoid_: attribute, field, property, relation

**BusinessRules**:
**Artifact kind**, one per **BoundedContext**: `BR-n` facts, constraints, derivations, decisions that outlive
any **Prd** or **Spec**; one RuleSpeak `statement` each, optional typed `logic` over **Fact types**;
withdrawn rules stay `deprecated`.
_Avoid_: policies, domain rules, constraints (bare)

**Decision rule**:
A `BusinessRules` rule of `type: decision`: one signed outcome with its rationale and source,
`then.decision` naming the outputs of the **DecisionTable** whose row cites it.
_Avoid_: inference, action enabler, routing rule

**DecisionTable**:
**Artifact kind**, one per decision (DMN subset): inputs over **Fact types**, outputs, `hitPolicy`,
`R-n` rows with unary tests, each row one **Decision rule**; cites every `BR-n` it implements.
_Avoid_: rule table, routing table, DRD

**Adr**:
**Artifact kind**, one per architecture decision (Nygard form, MADR alternatives); taken first,
listed by the **Architecture** or Design revision that applies it; a status change is a revision.
_Avoid_: decision record, decision log, design decision (bare)

**Architecture**:
**Artifact kind**, once per product, arc42's twelve sections as fields; the frame every **Spec** is
written inside. Section 8's domain model and 12 by reference, 9 a list of **Adr** ids.
_Avoid_: architecture doc, system design, high-level design, technical design

**EventStorming**:
**Artifact kind** holding one event storming model in the tool's DSL v4.0 (`24-eventstorming.md`):
contexts, nodes, edges, a `meta.level`; a revision per phase.
_Avoid_: board, storming session, event storming JSON

**Grammar**:
The event storming rules beyond the schema's shape: which property on which type, level gating,
edge rules, smells; `tools/eventstorming/grammar`, run by the Adapter `eventstorming/v1`.
_Avoid_: validator (the kind), linter, health check

**Local API**:
The JSON routes `persimmon ui` serves over the Store on loopback (`25-ui.md`): kinds, artifacts,
one revision, create a revision; server mode's first slice, without https or tokens.
_Avoid_: REST API, backend, web API, server (bare)

**Tool**:
A human-facing web surface over artifact kinds, one directory under `tools/`, its pure model code
beside the UI. Not the Executor type `tool`, which is a program run once per attempt.
_Avoid_: app, studio, plugin, editor (bare)

**Editor**:
The event storming **Tool**, `tools/eventstorming/`, opened at `/tools/eventstorming/` by
`persimmon ui`; reads one revision, saves the next.
_Avoid_: board app, canvas (for the whole tool), event storming web tool

**DomainModel**:
**Artifact kind**, one per **BoundedContext**, derived from a design-level **EventStorming**:
aggregates with their commands, events and invariants, policies, read models, external systems;
names are storming labels, attributes are **Fact types** (`26-domain-discovery.md`).
_Avoid_: domain object model, class model, entity model, aggregate list

**Spec process**:
The pack process from a **Prd** capability to its **Spec**: Task `write-spec` under a ReviewLoop whose
gate is `spec-consistency` (Adapter `sdd/v1`), repeated by `spec-all` over a list of `CAP-n`.
_Avoid_: spec pipeline, spec workflow, specification phase

**Domain discovery**:
The pack process from a **Prd** to the domain kinds: three storming phases as ReviewLoops with a
human gate, then one derivation per context, checked by `domain-consistency`.
_Avoid_: storming pipeline, discovery workflow, modelling phase

**Prd**:
**Artifact kind** of the AI Native pack: why, for whom, `CAP-n` capabilities, `SC-n` success
criteria. No stories, requirements or technology; those are the **Spec**'s.
_Avoid_: ProductRequirement (demo pack), EarsPrd (example06), product spec

**Spec**:
**Artifact kind** of the AI Native pack, one per `CAP-n` of a **Prd**: stories `US-n` with EARS
acceptance criteria `AC-n`, `qualities` citing Architecture `QS-n`, open questions. Names are the
**DomainModel**'s, rules `BR-n`; no FR, NFR or entity of its own. Always the capitalised kind name;
the envelope field is `spec`.
_Avoid_: feature spec, requirements doc, spec.md

## Flagged ambiguities

- **Tool vs `tool`.** A web surface under `tools/` and the Executor type. Resolution: the surface is
  capitalised **Tool** or "the event storming tool"; the Executor type is always `tool` in code font.
- **Spec vs `spec`.** The AI Native pack's kind and every Resource's envelope field. Resolution: the
  kind is always `Spec` or "a Spec"; the field is always `spec` in code font or `spec.content`.

- **ArtifactRef vs RevisionRef.** Same shape. Framework says RevisionRef; reference well-known
  schemas exposed `persimmon.ai/v1#/ArtifactRef`. Resolution: **RevisionRef** everywhere,
  including the `$ref` id `persimmon.ai/v1#/RevisionRef`. `ArtifactRef` is dead.
- **Event.** Framework uses one word for the closed reconcile set and the open outbox strings.
  Resolution: **Event** = reconcile event; **Outbox event** always qualified.
- **Scope.** `KindDefinition.scope` (Namespaced | Global) and `commitScope` staging.
  Resolution: **scope** alone = kind scope; staging is **Publication scope**.
- **Plugin.** An old protocol file title; the protocol is `07-adapter.md`.
  Resolution: **Adapter**; "plugin" is dead.
- **Execution.** Appears in `logicalExecutionId` and "step execution". Resolution:
  **Invocation address** for the identity, **TaskRun** for the resource, **Attempt** for one
  try. `logicalExecutionId` stays as a field name.
- **Artifact kind vs Revisioned kind.** Same thing at two layers. Resolution: Layer 0 text
  says **Revisioned kind**; Layer 1 and above say **Artifact kind**.
- **Definition.** Sometimes "definition YAML" means any applied resource. Resolution:
  **Definition** only for kinds with `snapshot: Definition`; otherwise **Resource**.
- **Cloud mode.** Renamed. Resolution: **server mode**.

## Example dialogue

> **Dev:** When a reviewer approves, does the Workflow write `approved` into status?
>
> **Expert:** No. A **Gate** decides. It runs a **Validator**, the Validator asks a **Task**,
> the Task's **Executor** is human. The human answer arrives as a **Signal** with an
> **Actor**.
>
> **Dev:** And retries of that Task?
>
> **Expert:** Retries are **Attempts** inside one **TaskRun**. New TaskRun only for a new
> **Invocation address**, so a new `repeat` iteration.
>
> **Dev:** If the reviewer edits the PRD, is that a new version of the document?
>
> **Expert:** New **Revision** of the same **Artifact**. Published into the attempt's
> **Publication scope**, visible when the `task` **Handler** issues `commitScope`.
>
> **Dev:** Someone edits the Workflow YAML mid-run. Does the run pick it up?
>
> **Expert:** Never. The WorkflowRun holds a **Snapshot** by digest. Children inherit it.
>
> **Dev:** Where does the Claude Code integration live? A plugin?
>
> **Expert:** An **Adapter** with the **Executor role**, registered as a global `Adapter`
> resource. The engine knows the protocol, not what the adapter does.
