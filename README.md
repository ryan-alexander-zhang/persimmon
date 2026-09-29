# Persimmon

A Kubernetes-style resource engine that runs a software delivery lifecycle with agents,
humans and scripts as interchangeable workers. Every fact is a versioned Resource; every run
is replayable and auditable; the engine knows no business concept.

```text
YAML definitions ──▶ persimmon run ──▶ WorkflowRun ──▶ TaskRun ──▶ Adapter (Claude Code, Codex, script, human)
   Workflow Task Executor            snapshot frozen      attempts       │
   Gate Validator Prompt Skill                                           ▼
                                                              Artifact revisions, provenance, audit
```

## Shape

| | |
|---|---|
| Form | one binary `persimmon`; local mode with SQLite; server mode (daemon, Postgres) is roadmap |
| Input | YAML definitions: Workflow, Task, Executor, Gate, Validator, Prompt, Skill, Trigger, KindDefinition, RelationType, Adapter |
| Output | artifacts: immutable, numbered revisions with provenance |
| Workers | Adapters, out of process, behind one JSON protocol |
| Language | TypeScript engine; Adapters in any language |
| Users | one developer locally; team use on a server is roadmap |

## Concepts

1. **Resource**: `apiVersion, kind, metadata, spec, status`. Users write `spec`, Handlers write
   `status`, every write is audited with an Actor.
2. **KindDefinition**: registers a kind with its schema. Shipped kinds and user kinds use the
   same path. Any kind with a `stepContract` can be a Workflow step.
3. **Handler**: pure function `reconcile(resource, event) → status patch + actions`. Decides,
   never does slow work.
4. **Reconcile loop**: one Event in, one transaction out, per Resource, in order. Crash-safe by
   construction.
5. **Snapshot**: a run freezes every definition it depends on by digest. Edits never reach a
   running run.
6. **Artifact**: append-only revisions, staged during an attempt, visible on commit, provenance
   stamped by the engine.
7. **Outbox**: in-database event bus. Triggers react to `artifactPublished` and
   `workflowRunFinished`.
8. **Adapter**: out-of-process worker with Roles `handler`, `executor`, `evaluator`. The engine
   validates capability, never interprets behaviour.

Layer 1 in one line each:

- **Workflow**: DAG of Steps and Transitions, typed ports, loops only via `repeat`.
- **Task**: `executorRef` says who, `action` says what, `context` says what to look at.
- **Executor**: agent, script, tool or human behind an Adapter.
- **Gate / Validator**: a Gate decides over Validators by policy; a Validator asks one question.
- **Prompt / Skill**: frozen text and a pinned capability bundle for Task context.
- **Trigger**: creates a run from an Outbox event.
- **Runs**: WorkflowRun, TaskRun with attempts, GateRun, ValidationRun; phases never revert.

## Principles

- Swapping human, agent, script touches one `executorRef`.
- Failed means "could not complete"; a business rejection is Succeeded plus a verdict output.
- Unknown is never success.
- Every reference to produced data is pinned to an exact revision. No implicit latest.
- Framework first: Workflow gets no engine special case.
- Simplest expression: no manifests, no composition kinds, no policy resource in v1.

## Not in v1

No server mode, no deployment lifecycle, no web UI, no composition kinds, no cross-Namespace
references, no external webhooks. See `docs/design/91-roadmap.md`.

## Quickstart

```sh
npm install && npm run build
alias persimmon="node $PWD/dist/main.js"
cd <your project> && persimmon init             # .persimmon/, persimmon.yaml, shipped Adapters, the SDLC pack
persimmon run <Workflow> --input k=v --follow    # a manual WorkflowRun; a path fills a repository port; one line per phase change, then the tree; stops when done or parked
persimmon get WorkflowRun                        # phases, waiting reasons, errors
persimmon tree WorkflowRun/<name>                # the run, what it produced, every run it owns, nested
persimmon complete <taskRun>                     # answer a human Task at the terminal; --file result.yaml to script it
persimmon resume                                 # drive waiting work after a Signal or a timer
```

Write verbs run the engine in process and drain before they exit; read verbs (`get`, `describe`,
`logs`, `tree`, `validate`) only look. `persimmon --help` lists every verb, including
`skill install` and `digest`. A Skill is installed once into the workspace with `skill install`
and verified at every attempt. `PERSIMMON_DEBUG=1` prints reconcile errors. Tests: `npm test`;
the end-to-end scenario is `test/scenario/prd.test.ts`.

## Walkthrough: the PRD loop

The SDLC pack binds `claude-agent` to `claude-code/v1`. Pick a model and the sandbox in a
Namespaced Executor override, then run the pack's two Workflows end to end. `init` installed
the pack and its Trigger `on-prd-published` in Namespace `default`.

```sh
cat > executor.yaml <<'EOF'
apiVersion: persimmon.ai/v1
kind: Executor
metadata: {name: claude-agent}
spec:
  type: agent
  adapter: claude-code/v1                        # or codex/v1 with {model: gpt-6-sol}
  configuration: {model: sonnet, sandbox: read-only}
  security: {networkAccess: allowlist, allowedHosts: [api.anthropic.com]}
EOF
persimmon apply executor.yaml -n default          # init already armed the pack's Trigger in this Namespace

persimmon run prd-create --input repository=. --follow   # a path on a repository port becomes a ref pinned to HEAD
# research and write-prd run on the agent; a ProductRequirement is published; the Trigger starts prd-approval,
# whose security-review and product-review run in the same --follow; the Gate parks on you
persimmon get WorkflowRun                        # lists on-prd-published-<id>
persimmon tree WorkflowRun/on-prd-published-<id> # approval/humanreview/task   TaskRun   cli-human/v1   Waiting human
cat > approve.yaml <<'EOF'
protocol: persimmon.result/v1
outputs:
  result: {kind: value, value: {passed: true, findings: [], evidence: []}}
EOF
persimmon complete on-prd-published-<id>-approval-humanreview-task --file approve.yaml   # drains, prints the tree
persimmon get WorkflowRun                        # WorkflowRun/on-prd-published-<id>  -n default  Succeeded
persimmon get ProductRequirement                 # ProductRequirement/prd-create-<hex>-write-prd-prd.r1  -n default
```

A script Executor runs the same way: `subprocess/v1` feeds the execute payload on stdin and
reads `{outputs, summary}` from `configuration.resultFile`. Credentials come from
`PERSIMMON_CRED_<NAME>` in the environment or `.persimmon/credentials.yaml`.

## Read next

- [`examples/`](examples/): one project per scenario with a step-by-step README; start with `example01`, an idea to an approved PRD
- [`DESIGN.md`](DESIGN.md): map of the design, one file per model with schema and examples
- [`CONTEXT.md`](CONTEXT.md): glossary; one canonical term per concept
- [`docs/design/90-decisions.md`](docs/design/90-decisions.md): every decision, by file
