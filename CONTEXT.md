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

**Project directory**:
The directory a local engine runs in: `persimmon.yaml`, and `.persimmon/` with its lock, socket
and credentials; a relative **Workspace** resolves against it. Several may share one **Store**,
one per git worktree; a **Run** is driven only from the project directory that created its tree.
_Avoid_: project, working directory, worktree (for the persimmon concept)

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
A **Composition kind**: `produce` then `review`, repeated with `previous`, `feedback` and every
`carry` entry (a produce output fed back into the optional produce input it names) until
`passed` or `maxRounds`; expands to a Workflow and its `<name>-round` body. `maxRounds` names
both the ceiling on the loop and the optional run input that lowers it. The review may read what
the loop carries.
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
fixed output `result: GateResult`. A Gate decides; a Validator asks; the Executor answers. Its
Validators run at once, except one with `after`: it starts once the earlier ones it names pass, and
is skipped, its result `passed: false`, when one does not; it may read their results (`fromValidator`).
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
`fromIterationOutput`, `expression`, `fromArtifact` (one id's latest revision), `fromQuery`
(every latest revision of a kind whose content passes a `where`), `fromEvent` (Trigger only).
_Avoid_: mapping, wiring, assignment

**Port**:
A typed input or output slot: `InputSpec` or `OutputSpec` with a **PortType**.
_Avoid_: parameter, argument, field, variable

**PortType**:
`value` (with optional well-known `$ref` schema), `artifact` (a revisioned kind), `artifacts`
(an ordered list of revisions of one kind, any count) or `externalResource`. Producer and
consumer types must be equal.
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

**Behind**:
A latest **Revision** whose `provenance.inputs` pins an artifact that has a newer revision;
`persimmon get <Kind> --behind` lists them. Not behind: a `previous*` input beside the current one,
or a newer revision the document's own run wrote.
_Avoid_: stale, outdated, drift (drift is `rule-drift`, a Gate finding within one loop)

**Representation**:
Bytes of an **Artifact** in a media type (Markdown, HTML, bundle), stored in BlobStore at
`blob://<digest>`; `json` is the content itself, every other one a file the agent left beside
its answer, named by the file's stem.
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
A directory of definitions applied together: `global/` as **Global**, `namespaced/` (Triggers)
into a **Namespace**; `files/` copied into the project by `init`. Overridable by name in a Namespace. Two ship: the **SDLC pack**
`persimmon init` applies and the **Demo pack** applied by hand. A pack ships artifact kinds as
KindDefinitions and adds no Resource kind of its own.
_Avoid_: bundle, library, preset, plugin

**SDLC pack**:
The built-in default flow (`packs/sdlc/`, `23-pack-sdlc.md`), applied by `persimmon init`: a
spec-driven delivery process, domain artifacts first. Group `sdd.persimmon.ai`.
_Avoid_: AI Native pack (its name before the rename), SDD pack, process pack

**Demo pack**:
The PRD lifecycle (`packs/demo/`, `20-pack.md`): research, write-prd, reviews behind a Gate, a
Trigger. Proves the engine's mechanics; applied by hand. Group `engineering.persimmon.ai`.
_Avoid_: sample pack, PRD pack

**Subdomain**:
A part of the business the product serves, in the problem space (Evans, Vernon): named from the
brief, typed `core` (the competitive edge), `supporting` (needed, not differentiating) or `generic`
(bought or solved). Not a model boundary; one or more **BoundedContext**s realise it.
_Avoid_: domain (bare), area, module, context

**BoundedContext**:
**Artifact kind** of the SDLC pack: where one domain model holds, in the solution space; cut by the
storming, it realises one **Subdomain**; `inScope`, `outOfScope`, `relationships` (its own view of
the context map). Cited by artifact id.
_Avoid_: domain, module, subsystem, context (bare), subdomain

**Glossary**:
**Artifact kind**, one per **BoundedContext**: the ubiquitous language; a term's identity is its
`name`, documents cite it by using it.
_Avoid_: dictionary, terms list, vocabulary

**Fact type**:
`Glossary.factTypes[]` entry (SBVR): what can be said about a term, `subject predicate object`; the
object is a term or a typed value. The typed input of a rule's logic and of a **DecisionTable**.
_Avoid_: attribute, field, property, relation

**Field**:
A name a Design document declares inside its contract: an OpenAPI, AsyncAPI or JSON Schema
`properties` key, a DDL column. Its words, in the document's own convention (`claimLine`,
`claim_line`), are a **Glossary** term's name or a **Fact type**'s name less its subject and
predicate; `id` and a name ending in `id` are the document's own. Held by `design-consistency`.
_Avoid_: attribute, column (bare), property (bare), schema field

**BusinessRules**:
**Artifact kind**, one per product (`BR-n` unique across it); a Prd, Spec, Design or Architecture
names it in `businessRules`, so a `BR-n` there is a pair with that artifact id (a DomainModel,
DecisionTable or Adr cites `BR-n` through the artifact it hangs off): `BR-n` facts, constraints, derivations, decisions that outlive
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
**Artifact kind**, one per architecture decision (Nygard form, MADR alternatives); taken first, or
by the `architect` loop beside its **Architecture**, naming the strategy decision it backs; listed by
the Architecture or Design revision that applies it; a status change is a revision. A structural
one is `enforcedBy` a `build` **Quality scenario** whose test fails when the decision is broken.
_Avoid_: decision record, decision log, design decision (bare)

**Architecture**:
**Artifact kind**, once per product, arc42's twelve sections as fields; the frame every **Spec** is
written inside. Section 8's domain model and 12 by reference, 9 a list of **Adr** ids.
_Avoid_: architecture doc, system design, high-level design, technical design

**EventStorming**:
**Artifact kind** holding one event storming model in the tool's DSL v4.1 (`24-eventstorming.md`):
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

**Inbox**:
The TaskRuns parked on a human that this project directory's engine drives, each with its
`cli-human/v1` form; served under `/api/inbox` and answered there or with `persimmon complete`.
_Avoid_: queue, task list, approvals

**Progress**:
The **Tool** at `/tools/progress/`, home of `persimmon ui`: one product's SDLC phases as a map, a
phase's runs round by round, artifacts as documents, and the **Inbox** entries answered on it
(`37-progress.md`).
_Avoid_: dashboard, board (the Editor's), pipeline view

**DomainModel**:
**Artifact kind**, one per **BoundedContext**, derived from a design-level **EventStorming**:
aggregates with their commands, events and invariants, policies, read models, external systems;
names are storming labels, attributes are **Fact types** (`26-domain-discovery.md`).
_Avoid_: domain object model, class model, entity model, aggregate list

**Unrealised**:
A name a **DomainModel** owns (an aggregate's command, an event, a read model, an `AG-n`) that no
element of a **Design** naming the model realises; `design-coverage` reports each as a warning.
_Avoid_: uncovered, missing endpoint, unimplemented

**Story**:
A **Spec** element `US-n` in Connextra form: `role` (a Prd user), `goal`, `benefit`; covers
requirements, owns acceptance scenarios.
_Avoid_: user story (as a different thing), feature, epic

**Requirement**:
A **Spec** element `FR-n`: one EARS sentence over "the system", enforcing rules by `BR-n`. Always
"requirement" for the Spec element; a Prd capability is not a requirement.
_Avoid_: functional requirement (as a different thing), FR text, system requirement

**Acceptance scenario**:
A **Spec** element `AC-n` under a **Story**: `given`, `when`, `then` with concrete values, decided
by one test on one run. Not a **Test case**: a scenario says what is accepted, a test case
how it is verified.
_Avoid_: acceptance criterion, AC (in prose), test case (for a scenario)

**Prd process**:
The pack process from a brief to a **Prd**: Task `draft-prd` writes the Prd and the context's
**BusinessRules** under ReviewLoop `author-prd`, whose Gate `prd-gate` runs `prd-consistency` (Adapter
`sdd/v1`) and the human `prd-confirmed`.
_Avoid_: prd pipeline, prd workflow, requirements phase

**Spec process**:
The pack process from a **Prd** capability to its **Spec**: Task `write-spec` under a ReviewLoop whose
gate is `spec-consistency` (Adapter `sdd/v1`), repeated by `spec-all` over a list of `CAP-n`.
_Avoid_: spec pipeline, spec workflow, specification phase

**Domain discovery**:
The pack process from a **Prd** to the domain kinds: three storming phases as ReviewLoops with a
human gate, then one derivation per context, checked by `domain-consistency`.
_Avoid_: storming pipeline, discovery workflow, modelling phase

**Plan process**:
The pack process from a **Spec** and its **Design**s to a **Plan**: one ReviewLoop `plan-one` per Spec,
the Designs listed by the caller, checked by `plan-consistency`.
_Avoid_: planning phase, task breakdown, plan-all

**Quality scenario**:
An Architecture element `QS-n` under a quality goal: stimulus, response, a measure, the `method` that
proves it (`test`, `fitness`, `load`, `chaos`, `observe`) and when (`provenAt`: `build`, `release`,
`runtime`). A Spec cites the ones its capability is held to; a `build` one verifies a **Plan** task.
A bare scenario in a Plan or an **AcceptanceRecord** is an `AC-n` or a `QS-n`.
_Avoid_: NFR, non-functional requirement, stage (for `provenAt`)

**Build process**:
The pack process from a **Plan** task to code and its evidence: ReviewLoop `build-one` per `T-n`, the
**Builder** writing an **AcceptanceRecord**, `run-tests` a **TestOutcome**, the **Auditor** judging the
tests, checked by `acceptance-evidence` and `acceptance-audited`.
_Avoid_: implementation phase, coding stage, build-all

**Builder**:
Who builds a **Plan** task: by default the developer with their own coding agent, answering a
`cli-human/v1` form; in an unattended Namespace, the agent the Executor `builder` is overridden to.
_Avoid_: developer (for the role), coder, implementer, code agent

**Auditor**:
An agent on the Executor `auditor`, read only, judging what no deterministic check decides: whether
each test an **AcceptanceRecord** names proves its scenario (Task `audit-acceptance`), or whether a
draft **Prd**, **Spec**, **Architecture** or **Design** means what its form says (Task `audit-<kind>`,
after the check and before a human). An error of its fails the round; whether a test passed or a
citation resolves is never its question.
_Avoid_: reviewer (a human at a Gate), judge, LLM validator

**Autopilot**:
The developer's agent running the whole run order from one idea with no human: it starts each run,
hands every human Gate's form to a fresh **Reviewer subagent** and every **Builder** form to a fresh
builder subagent, and writes the **Issue**s. `autopilot-doc` runs it to the **Plan**s, `autopilot-code`
from them; `autopilot` is both. Three agent skills `init` places in the project.
_Avoid_: unattended Namespace (an Executor override inside the engine), auto mode, agent mode

**Reviewer subagent**:
The **Autopilot**'s stand-in for the human at a Gate: a subagent with no part in the authoring,
started fresh for one form, that answers its ValidationResult.
_Avoid_: auditor (the pack's own agent), self-review, judge

**Architecture process**:
The pack process from a **Prd** and the domain kinds of its contexts to the **Architecture** and its
**Adr**s: ReviewLoop `architect`, once per product, checked by `architecture-consistency` and a human.
_Avoid_: architecting phase, design phase, architecture pipeline

**UI design process**:
The pack process from the Architecture's client blocks to the **DesignSystem** (ReviewLoop
`design-system`, once per product, linted and confirmed by a human) and the `ui` **Design**s
(`design-all` with `type: ui`).
_Avoid_: UX phase, frontend design, screen design process

**Product**:
What one **Prd** describes: one or more **Subdomain**s served together, realised by the bounded
contexts the storming cuts, named by a `productId` that stems the Prd's, the rules' and the
Architecture's artifact ids.
_Avoid_: project (the persimmon project is the store), system, initiative (for the id)

**Prd**:
**Artifact kind** of the SDLC pack: why, for whom, `CAP-n` capabilities, `SC-n` success
criteria. No stories, requirements or technology; those are the **Spec**'s.
_Avoid_: ProductRequirement (demo pack), EarsPrd (example06), product spec

**DesignSystem**:
**Artifact kind** of the SDLC pack, one per product: the visual language as a **DESIGN.md**
file embedded whole in `document`, plus `prd`, `decisions` and `openQuestions`. Confirmed by a human.
Always the capitalised kind name.
_Avoid_: style guide, brand book, theme, design tokens (for the kind)

**DESIGN.md**:
Google Labs' open format for a design system: YAML front matter of tokens and eight ordered
markdown sections. The `document` of a **DesignSystem**; linted by `designmd/v1`.
_Avoid_: design.md (the package is `@google/design.md`), design spec

**Design**:
**Artifact kind** of the SDLC pack: one reusable contract, schema or screen document (`type`
http-api, async-api, data-schema, ui) of one **Architecture** building block, its `document` embedded whole and indexed by
`elements` that name what in the **DomainModel** each realises (a `ui` Design: which operation of the block's API Designs
each screen or action calls; it names no DomainModel). Shared by every capability of the
block; a **Spec** never cites one, the Plan does. Always the capitalised kind name.
_Avoid_: design doc, technical design, design asset, design per capability, API spec (for the kind)

**Plan**:
**Artifact kind** of the SDLC pack, one per **Spec**: tasks `T-n` in build order, each on one
**Architecture** block, covering the Spec's `FR-n`, verified by its `AC-n` and `build` `QS-n`, realising `EL-n` of the
**Design**s it lists. The only artifact that links a Spec to Designs. Always the capitalised kind name.
_Avoid_: tasks.md, work breakdown, implementation plan, task (for the kind; a Task is the engine's)

**AcceptanceRecord**:
**Artifact kind** of the SDLC pack, one per built **Plan** task: for each `AC-n` and `QS-n` the task is verified by,
the tests the builder says prove it. A claim, checked against a **TestOutcome**.
_Avoid_: test report, implementation report

**TestOutcome**:
**Artifact kind** of the SDLC pack: what the project's own tests did once, read from JUnit XML, one
entry per test with its status, plus the commit tested. The evidence an **AcceptanceRecord** is
checked against. The one `build-all` takes before any task is the baseline TestOutcome: a test red
there and red still is not the build's. Always so named: a bare "baseline" is the arc42 baseline.
_Avoid_: TestRun (a Run is the engine's), test report, test result, CI run

**Test level**:
Which kind of test a test or a **Test case** is: `unit`, `integration`, `api` or `e2e`. One **TestOutcome** per
level and run: `unit` on the Executor `test-runner`, the others on `level-runner`. Coverage and
mutation are measures of the `unit` level, recorded in its TestOutcome, not levels.
_Avoid_: test type, test kind, test layer, suite (for the level), stage

**Test tier**:
When a **Test level** runs: `round` (every `build-one` round, on the **Change set**), `plan` (once
after `build-all`'s last task, every enabled level in full) or `release`.
_Avoid_: phase (a Pipeline's or a Run's), stage, test stage, gate (for the tier)

**Change set**:
The files and lines that differ from the baseline **TestOutcome**'s `head`, untracked files
included: what a `round` tier selects tests by and measures coverage and mutation over.
_Avoid_: diff (git's output), delta (a Spec's field), changes

**Test process**:
The pack process that decides and writes the tests apart from the code: Task `setup-tests` once per
product (a **TestHarness**), ReviewLoop `test-design-one` per **Spec** (a **TestDesign**), the **Tester**'s
tests inside `build-one`, and a **TestReport** after `build-all`.
_Avoid_: QA phase, test phase, verification phase

**Tester**:
Who sets up the tests and writes the `api` and `e2e` tests: the Executor
`tester`, by default the developer's own agent answering a `cli-human/v1` form in a fresh subagent,
never in the **Builder**'s context.
_Avoid_: QA, test engineer, test agent, builder (for tests)

**TestHarness**:
**Artifact kind** of the SDLC pack, one per product: for each **Test level** the project has, its
tool, the command for the suite and for one test, the JUnit XML it writes, where its tests live, how
the app starts and a seed test. The one source the runners and every test-writing Task read.
_Avoid_: test config, test framework, test setup (for the kind)

**TestDesign**:
**Artifact kind** of the SDLC pack, one per **Spec**: its **Test case**s, confirmed before any task is
built.
_Avoid_: test plan, test spec, test suite, coverage map

**Test case**:
A **TestDesign** element `TC-n`: the scenarios and rules it verifies, its **Test level**, a priority
`P0` to `P3`, preconditions, steps and the expected result. The tests that run it carry `TC-n` in
their names.
_Avoid_: test (a **TestOutcome** entry), scenario (an `AC-n` or `QS-n`), TestCase (the old roadmap name)

**TestReport**:
**Artifact kind** of the SDLC pack, one per built **Plan**: each **Test case**'s result, a coverage
status per scenario and requirement (`ok`, `nok`, `notrun`, `uncovered`), the measures, the verdict
(`pass`, `concerns`, `fail`) with the rule that gave it, and a written evaluation.
_Avoid_: test summary, completion report, AcceptanceRecord (one task's claim)

**Defect**:
Wrong behaviour of the code that a **Builder** sees and its task does not cover: in code built
before, in an earlier task, behind a test red in the baseline **TestOutcome**. A `D-n` of the
**AcceptanceRecord**: what was seen, what was expected and what says so, where. Reported, never fixed
in that task, never investigated there: the investigation is an **Issue**.
_Avoid_: bug (for the `D-n`), finding (a Gate's), `Q-n` (an unknown, not a defect)

**Issue**:
**Artifact kind** of the SDLC pack, one per investigated **Defect**: observed and expected, root
cause, every site with that cause, the test that reproduces it, whether the code broke the **Spec**
or the Spec was wrong or missing, and the artifacts the fix revises (`blocks`). Written by hand with
`persimmon create`; a new revision changes its `status`. The fix takes the path of any change: a
Spec revision when the Spec was wrong, a Plan revision, `build-one`.
_Avoid_: bug report, ticket, incident, defect (for the investigated one)

**Spec**:
**Artifact kind** of the SDLC pack, one per `CAP-n` of a **Prd**: stories `US-n` (Connextra)
covering requirements `FR-n` (EARS) that enforce rules `BR-n`, acceptance scenarios `AC-n`
(Given/When/Then) under each story, `qualities` citing Architecture `QS-n`, open questions. Names
are the **DomainModel**'s; no NFR text or entity of its own. Always the capitalised kind name; the
envelope field is `spec`.
_Avoid_: feature spec, requirements doc, spec.md

**Rewrite pack**:
The process pack for rebuilding an existing system (`packs/rewrite/`, `40-pack-rewrite.md`): it
recovers the knowledge in the **Source system**'s code into SDLC pack artifacts, then rebuilds on
the SDLC pack's processes. Installed beside the SDLC pack; uses its kinds and processes by name and
copies none.
_Avoid_: migration pack, modernization pack, brownfield pack, reverse pack

**Source system**:
The existing system a rewrite replaces: its repository pinned at one commit, and the app it runs
when it can be started. Read, never changed.
_Avoid_: legacy system, old system, as-is system, target (the new system is the rewrite)

**SourceInventory**:
**Artifact kind** of the **Rewrite pack**, one per **Source system**: facts read off the source at
its commit (entry points, state changes, guards, entities, external systems, tests), each with
where it is. A guard is every branch that decides, its `role` a rule, plumbing or unknown. The
evidence a recovered **Prd**, its **BusinessRules** and the storming cite.
_Avoid_: code facts, knowledge graph, analysis report, code map

**Oracle**:
Where the expected behaviour of the **Source system** comes from: `running` (its app answers),
`partial` (its units run in a harness, the app does not), `recorded` (input and output pairs it
produced, given by the developer) or `static` (its code only). Stated per capability; the
**ParityLedger** reports it, weakest last.
_Avoid_: mode, assurance level, test oracle (bare), source of truth

**Characterization test**:
A test of what the **Source system** does, bugs included, its expected value read off the
source's answer or a record, never off a recovered rule: what keeps a rule nobody recovered.
Written by the **Tester** before any rule is recovered.
_Avoid_: pinned test, golden master, snapshot test, regression test

**Recovery process**:
The **Rewrite pack** process from a **Source system** to a **Prd** and its **BusinessRules**:
ReviewLoop `inventory` writes the **SourceInventory**, ReviewLoop `characterize` the
**Characterization test**s and the first **ParityLedger**, ReviewLoop `recover-prd` the Prd and rules
citing both, with a **Disposition** per item confirmed by a human. **Domain discovery** then runs on
that Prd.
_Avoid_: reverse engineering (for the process), extraction phase, archaeology

**Disposition**:
What a rewrite does with one recovered `CAP-n` or `BR-n`: `keep`, `change` or `drop`, decided by a
human at the **Recovery process**'s Gate. `keep` leaves it; `change` deprecates the rule and adds
one sourced from the decision; `drop` moves the capability to the Prd's `nonGoals`.
_Avoid_: parity policy (for one item), triage, verdict

**ParityLedger**:
**Artifact kind** of the **Rewrite pack**, one per **Source system**, computed: every guard of the
**SourceInventory** accounted for (tested, ruled, plumbing, dropped, dead, or open), every difference
between the Source system and the rewrite with its cause, the **Oracle** per capability, and a
verdict. A revision after characterization, after recovery and after each **Parity check**.
_Avoid_: parity report, equivalence report, coverage report, TestReport (the build's)

**Parity check**:
The **Rewrite pack** run of the **Characterization test**s against the rewrite after `build-all`:
each difference from the **Source system** is a `change` **Disposition** or a **Defect**, never
unexplained; the **ParityLedger**'s next revision holds the result.
_Avoid_: regression (the build's), equivalence test, golden master, shadow test

## Flagged ambiguities

- **Tool vs `tool`.** A web surface under `tools/` and the Executor type. Resolution: the surface is
  capitalised **Tool** or "the event storming tool"; the Executor type is always `tool` in code font.
- **Spec vs `spec`.** The SDLC pack's kind and every Resource's envelope field. Resolution: the
  kind is always `Spec` or "a Spec"; the field is always `spec` in code font or `spec.content`.
- **Issue vs `issues`.** The SDLC pack's kind and the EventStorming relation (`actor issues
  command`). Resolution: the kind is always capitalised `Issue`; the relation always `issues` in code font.
- **Defect.** A `D-n` of an AcceptanceRecord, and the auditors' Prompts' word for any fault they
  name in a draft or a record. Resolution: capitalised **Defect** is the `D-n`; what an auditor names is
  a finding.
- **Level.** A **Test level**, an Architecture building block's level, an EventStorming
  `meta.level`. Resolution: prose always says "test level"; the bare field `level` is the
  TestOutcome's and the record row's only.
- **Test case.** JUnit's `testcase`, which `35-build-process.md`, `36-test-levels.md` and the
  acceptance findings call a test case, and a **TestDesign**'s `TC-n`. Resolution: **Test case** is
  the `TC-n`; JUnit's entry is a test, one `TestOutcome.tests[]` entry, in those files' prose and
  in the Gate's messages; a Decision recorded before keeps its words.
- **Source.** The **Source system** and the `BusinessRules` field `source` (law, policy, contract,
  decision). Resolution: the system is always **Source system** in full; the field is `source` in
  code font, and a recovered rule's `source` names the **SourceInventory** item it rests on.

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
