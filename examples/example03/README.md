# example03: an event-driven release chain

Nothing here is started by hand except the first artifact. You publish release notes; a Trigger
packages them; a second Trigger announces the package. Two scripts, no agents, seconds to run,
free to replay.

```text
persimmon create notes.yaml ─▶ ReleaseNotes/todo-cli.r1
        │  Trigger on-notes-published   (artifactPublished)
        ▼
Workflow package  ── scripts/package.mjs ──▶ Package/<run>-build-package.r1, build/1.2.0.txt
        │  Trigger on-package-built     (workflowRunFinished, phases: [Succeeded])
        ▼
Workflow announce ── scripts/announce.mjs ──▶ announce/1.2.0.txt
```

Files:

- [`release.yaml`](release.yaml): two artifact kinds, one script Executor, two Tasks, two
  Workflows, two Triggers
- [`notes.yaml`](notes.yaml): the release notes, a revision document
- [`scripts/`](scripts/): the two programs; each reads the execute payload on stdin and writes
  its answer to the Executor's `resultFile`

## Prerequisites

- `persimmon` on your PATH: `npm install && npm install -g .` in the repository root ([Installation](../../README.md#installation))

## Steps

Run every command inside `examples/example03`.

### 1. Install

```sh
persimmon init
persimmon validate release.yaml            # every line ok
persimmon apply release.yaml               # 9 created
persimmon get Trigger                      # on-notes-published, on-package-built
```

Triggers are Namespaced: `apply` put these in `default`. A Trigger listens to events in its own
Namespace only.

### 2. Publish the notes

```sh
persimmon create notes.yaml
```

```text
created ReleaseNotes/todo-cli.r1
```

That one command ran the whole chain. Local mode drains until nothing is left to do: the
`artifact.published` event fired `on-notes-published`, the `package` run built, its
`resource.finished` event fired `on-package-built`, the `announce` run posted. Then the command
returned.

### 3. See what happened

```sh
persimmon get WorkflowRun
```

```text
WorkflowRun/on-notes-published-<hash>  -n default  Succeeded
WorkflowRun/on-package-built-<hash>  -n default  Succeeded
```

A triggered run is named after its Trigger and the event id. Where it came from is in its `spec`:

```sh
persimmon get WorkflowRun/on-package-built-<hash>       # spec.origin: kind trigger, triggerRef, eventId, causationRef (the package run)
persimmon tree WorkflowRun/on-notes-published-<hash>     # build   TaskRun   subprocess/v1   Succeeded, then Package/<...>.r1
persimmon tree WorkflowRun/on-package-built-<hash>       # post    TaskRun   subprocess/v1   Succeeded; outputs posted true
persimmon logs TaskRun/on-notes-published-<hash>-build   # under logs: what the script printed
cat build/1.2.0.txt announce/1.2.0.txt
```

Inputs the Triggers bound, visible in each run's `spec.inputs`:

| Trigger | Binding | What arrived |
|---|---|---|
| `on-notes-published` | `notes: {fromEvent: artifact}` | the RevisionRef of the notes |
| | `version: {fromEvent: content.version}` | `1.2.0`, a field of the published content |
| `on-package-built` | `package: {fromEvent: outputs.package}` | the finished run's `package` output |
| | `channel: {literal: releases}` | a fixed value |

### 4. Pause the chain

A disabled Trigger ignores its events; it does not queue them.

```sh
sed 's/enabled: true/enabled: false/' release.yaml > paused.yaml && persimmon apply paused.yaml   # 2 updated, 7 unchanged
sed 's/revision 1/revision 2/; s/revision: 1/revision: 2/; s/todo-cli.r1/todo-cli.r2/; s/1\.2\.0/1.2.1/g' notes.yaml > notes2.yaml
persimmon create notes2.yaml               # created ReleaseNotes/todo-cli.r2, nothing runs
persimmon apply release.yaml               # enabled again
persimmon get WorkflowRun                  # still two runs: the r2 event was consumed while paused
```

To package r2 now, publish r3, or run the Workflow by hand with the same inputs the Trigger would
have bound:

```sh
persimmon run package --input notes=@notes2.yaml --input version=1.2.1 --input title="Todo CLI 1.2.1" --follow
```

`on-package-built` fires on that run too: a Trigger does not care who started the run it watches.
`--follow` shows the package run only; `persimmon get WorkflowRun` lists the announce run it
caused, and `announce/1.2.1.txt` is there.

## Change it

| Want | Edit | Then |
|---|---|---|
| only failures announced | `on-package-built`: `phases: [Failed]` | `persimmon apply release.yaml` |
| another channel | `channel: {literal: ...}` | apply |
| a Trigger that restarts its own Workflow | copy `on-package-built` to `loop.yaml`, set `run.workflowRef` to `package` and its `inputs` to the `package` Workflow's | `persimmon validate loop.yaml` refuses: `a run-finished Trigger must start a different Workflow` |
| a Workflow that republishes what triggered it | give the `package` Task and Workflow a second output of kind `ReleaseNotes` | `persimmon validate release.yaml` refuses the Trigger: `target Workflow outputs the triggering artifact kind` |

## Reset

```sh
rm -rf .persimmon persimmon.yaml AGENTS.md CLAUDE.md .gitignore build announce paused.yaml notes2.yaml loop.yaml
```

## Known limits

- A script receives artifact references, not content; `package.mjs` gets the notes' `version` and
  `title` through `fromEvent: content.<path>` bindings instead of reading the revision. Agents
  read artifacts through the engine callback; scripts do not, yet.
- Both Tasks share one `resultFile`; fine while runs are sequential, as here.
