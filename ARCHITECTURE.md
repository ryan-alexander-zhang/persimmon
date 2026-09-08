# Architecture Overview

persimmon is a local, single-user Node.js service that renders one repository's `docs/` tree as a board in the browser and drives the docs workflow of [rule-00001](docs/rule/rule-00001-docs-workflow.md) over it: documents are nodes, front matter relations are edges, and every action — review, promote, ask, co-write, annotate — writes back to the Markdown files and commits. Agent CLIs (Claude Code, Codex) run as child processes in embedded terminals or headless. The Markdown files are the only source of truth; the board can be discarded and rebuilt. The service stays Node; the command-line entry — scaffolding a project, registering a workspace, and the startup handshake that opens the board — is a single Go binary named `persimmon` that starts the service on demand ([decision-00020](docs/decision/decision-00020-unified-go-cli.md)).

## 1. Introduction & Goals

For the single document owner of a repository built on ai-native-project-template, and for the agents that write its docs. Requirements: [prd-00001](docs/prd/prd-00001-docs-whiteboard.md), [prd-00002](docs/prd/prd-00002-doc-annotations.md), and the specs under [docs/spec/](docs/spec/README.md).

1. **Files stay the truth** — no state the board cannot rebuild from `docs/`, `whiteboard.config.yaml`, and git.
2. **Rules are enforced by the tool, not remembered by people** — status transitions, relation shapes, and gates are refused, not warned about.
3. **Human reviews, agent executes** — every agent write is bounded to declared paths and committed with provenance.

## 2. Constraints

| Constraint | Source |
| --- | --- |
| Single user, `localhost` only; one process serves many workspaces | [spec-00011](docs/spec/spec-00011-multi-workspace.md) |
| Behaviour is driven by `whiteboard.config.yaml`; a missing or invalid config makes that workspace unavailable, there is no built-in default | spec-00011-FR-6 |
| The host package (the npm package in this repository) needs Node.js ≥ 23.6 — type stripping for its own `npm start` and tests, which import `src/*.ts`; the shipped package carries compiled JS in `lib/` because Node does not strip under `node_modules` (issue-00029); `node-pty` native module | `package.json` |
| `cli/`: Go 1.24, standard library only, its own `go.mod` — no CLI framework and no third-party dependency | [decision-00020](docs/decision/decision-00020-unified-go-cli.md) §2 |
| Every write goes through git; the working tree must be a git repository | [design-00001](docs/design/design-00001-docs-whiteboard.md) §6 |

## 3. Context & Scope

```mermaid
flowchart LR
  U[Document owner<br/>browser] --> S[persimmon<br/>Node service]
  H[Document owner<br/>shell] --> C[persimmon command<br/>Go binary]
  C -->|new · update · list-langs| T[(GitHub<br/>template repository)]
  C -->|start · join · add · remove · list| S
  S --> D[(repository<br/>docs/**/*.md · whiteboard.config.yaml)]
  S --> G[(git)]
  S --> A[agent CLI<br/>Claude Code / Codex]
  A --> D
```

| Neighbor | Direction | Purpose |
| --- | --- | --- |
| Browser | in | The board UI: canvas, editor, terminals, panels |
| Repository files | in/out | Documents read and rewritten; flow config read at startup |
| git | out | Stage declared paths, commit, read history and diffs |
| Agent CLIs | out | Child processes per session (PTY or headless) that write documents |
| Shell | in | The `persimmon` command's own surface: scaffold, registry, and startup subcommands |
| GitHub template repository | out | Branch tarballs and the `lang/*` branch list, for `new` / `update` / `list-langs` ([spec-00013](docs/spec/spec-00013-persimmon-scaffold.md)) |

The template repository is reached only by the command.

## 4. Solution Strategy

- One Node process serves the built React UI and an HTTP/WebSocket API; no database — [design-00001](docs/design/design-00001-docs-whiteboard.md) §1.
- Markdown is the DSL: one grammar, validated in three places, no second source of truth — [decision-00005](docs/decision/decision-00005-whiteboard-parsing-contract.md).
- Layout is type-columned, not graph-derived — [decision-00002](docs/decision/decision-00002-whiteboard-layout.md).
- Agent work is a session with a pre-session snapshot; the commit is the diff against it — design-00001 §5–§6.
- Two agent config layers: project layer in `whiteboard.config.yaml`, local layer in `.whiteboard/agents.json` — [decision-00017](docs/decision/decision-00017-whiteboard-agent-settings.md).
- The board lives in its own repository and serves any template project — [decision-00019](docs/decision/decision-00019-whiteboard-standalone-repo.md).

## 5. Building Block View

```
persimmon/
├── docs/                    # this project's own docs, rendered by this board
├── whiteboard.config.yaml   # flow config this repo's board reads (rule-00001 carrier)
├── .whiteboard/             # local state: sessions, asks, annotations, agents.json (git-ignored)
├── cli/                     # the `persimmon` command (Go, own go.mod)
│   ├── main.go              #   subcommand dispatch
│   └── internal/            #   scaffold (new/update/list-langs), registry (workspaces.json), hostproc (probe, start host)
├── bin/host.js              # entry: listen, print the address, forward signals
├── .goreleaser.yaml         # release matrix for the Go binaries
├── install.sh               # installs the `persimmon` binary
├── src/                     # server: config, docRepository, docService, workflow, requirements,
│                            #   sessionManager, headless, cowrite, annotations, askStore, gitLayer,
│                            #   watcher, server (HTTP/WS API)
├── web/src/                 # React UI: Board canvas, Inspector, Editor, Terminal, Sidebar, panels
├── test/, web/test/         # vitest suites
└── dist/web/                # built UI served by `npm start`
```

`cli/`, `.goreleaser.yaml`, `install.sh` and the `bin/host.js` entry are the code layout of [design-00004](docs/design/design-00004-persimmon-cli.md) §6; the npm package is the host service alone, `@ryan-alexander-zhang/persimmon-host` with the bin `persimmon-host` (design-00004 §7).

```mermaid
flowchart LR
  subgraph Browser
    UI[React UI<br/>React Flow · CodeMirror · xterm.js]
  end
  subgraph Node service
    API[HTTP/WS API]
    DR[Doc Repository]
    WE[Workflow Engine]
    SM[Session Manager]
    GL[Git Layer]
    WA[Watcher]
  end
  UI <--> API
  API --> DR & WE & SM & GL
  WA --> API
  DR --> FS[(docs/**)]
  SM --> CLI[agent CLI]
  GL --> GIT[(git)]
```

Component internals: [design-00001](docs/design/design-00001-docs-whiteboard.md) (service), [design-00002](docs/design/design-00002-whiteboard-ui.md) (UI).

## 6. Runtime View

| Scenario | Design |
| --- | --- |
| Advance a document to its next stage | design-00001 §4 |
| Agent session lifecycle, snapshot and commit | design-00001 §5–§6 |
| Headless ask thread | design-00001 §10 |
| Co-write session | design-00001 §11 |
| Annotation batch: question / issue | design-00001 §12 |
| External edit → watcher → board refresh | design-00001 §2 |
| Command startup: probe, then join or start the host | design-00003 §8 + [design-00004](docs/design/design-00004-persimmon-cli.md) §3 |
| `persimmon new` → scaffold → registration closes the loop | design-00004 §5 |
| `persimmon update` three-way merge | [spec-00013](docs/spec/spec-00013-persimmon-scaffold.md) |

## 7. Deployment View

Local only. A user installs the `persimmon` binary with `install.sh`; developing this repository is `npm run build` once, then `npm start` from anywhere inside a repository that has `whiteboard.config.yaml`.

Release is one tag, one workflow, two paired artifacts: `.github/workflows/release.yml` fires on a `v*` tag, publishes the host package to npm first, then runs goreleaser for the `persimmon` binaries (linux/darwin/windows × amd64/arm64), both carrying the tag as their version ([design-00004](docs/design/design-00004-persimmon-cli.md) §8). No tag has been pushed yet, so nothing is published and `install.sh` has nothing to download until the first release, `v0.2.0`.

`.github/workflows/ci.yml` runs both halves on every push and pull request: Node build, typecheck and tests; Go `gofmt -l cli`, `go -C cli vet ./...`, `go -C cli test ./...` and the coverage gate `scripts/go-coverage.sh`. The remaining open gates are listed in [CODE_QUALITY.md](CODE_QUALITY.md) §2.

## 8. Crosscutting Concepts

Security: [SECURITY.md](SECURITY.md). Style: [CODE_STYLE.md](CODE_STYLE.md). Quality gates: [CODE_QUALITY.md](CODE_QUALITY.md). Testing: [TESTING.md](TESTING.md), [UNIT_TESTING.md](UNIT_TESTING.md). Business invariants of the docs flow: [rule-00001](docs/rule/rule-00001-docs-workflow.md). Vocabulary: [CONTEXT.md](CONTEXT.md).

## 9. Architecture Decisions

| Decision | Outcome |
| --- | --- |
| [decision-00001](docs/decision/decision-00001-whiteboard-ui-stack.md) | Tailwind CSS + shadcn/ui + Lucide for the UI |
| [decision-00002](docs/decision/decision-00002-whiteboard-layout.md) | Type-columned layout; ELK dropped |
| [decision-00003](docs/decision/decision-00003-whiteboard-edge-emphasis.md) | Edge readability by focus and lists, not routing |
| [decision-00004](docs/decision/decision-00004-whiteboard-requirement-panel.md) | Requirement items read in the inspector and sub-canvas |
| [decision-00005](docs/decision/decision-00005-whiteboard-parsing-contract.md) | Markdown is the DSL; one grammar, validated in three places |
| [decision-00006](docs/decision/decision-00006-whiteboard-ask-clarify.md) | Clarify as agent-led questioning; ask added |
| [decision-00007](docs/decision/decision-00007-whiteboard-audit-and-resolved-gate.md) | Audit as third review action; `resolved` gated by acceptance coverage |
| [decision-00008](docs/decision/decision-00008-whiteboard-revision-create-and-session-reach.md) | Revision returns to draft; entry types can be created; session history |
| [decision-00009](docs/decision/decision-00009-whiteboard-parallel-sessions.md) | Parallel sessions |
| [decision-00010](docs/decision/decision-00010-whiteboard-desktop-notifications.md) | Page-level Notification API, only when away |
| [decision-00011](docs/decision/decision-00011-whiteboard-explicit-waiting-signal.md) | Explicit waiting signal (OSC 777 latch) |
| [decision-00012](docs/decision/decision-00012-whiteboard-ask-threads.md) | Ask goes headless; terminal ask retired |
| [decision-00013](docs/decision/decision-00013-rule-notation-not-dmn.md) | Rule notation stays Markdown; no DMN |
| [decision-00014](docs/decision/decision-00014-entry-type-birth-paths.md) | Six more entry types can be created directly |
| [decision-00015](docs/decision/decision-00015-whiteboard-co-write.md) | Co-write as the fifth session kind |
| [decision-00016](docs/decision/decision-00016-whiteboard-navigation-sidebar.md) | Navigation sidebar and minimap |
| [decision-00017](docs/decision/decision-00017-whiteboard-agent-settings.md) | Two-layer agent settings |
| [decision-00018](docs/decision/decision-00018-whiteboard-directory-groups-and-exclude.md) | Config `exclude` and directory groups |
| [decision-00019](docs/decision/decision-00019-whiteboard-standalone-repo.md) | The board is its own repository; multi-workspace is the next direction |
| [decision-00020](docs/decision/decision-00020-unified-go-cli.md) | One `persimmon` command: a Go binary owns every command-line entry, the npm package becomes the host service |

## 10. Quality Requirements

| Quality | Scenario | Target |
| --- | --- | --- |
| Correctness of writes | Any board action on a doc | The resulting file re-parses to the same model; only declared paths are staged (spec-00001) |
| Test coverage | Any code change | Lines, branches, functions ≥ 90% over `src/` and `web/src/` (TESTING.md) |
| Test coverage of the command | Any change under `cli/` | Statement coverage ≥ 90% for new Go packages; branch and function have no Go tooling, and `cli/internal/scaffold` is legacy debt gated at its recorded ratchet (TESTING.md, decision-00020 §4) |
| Responsiveness at scale | A repo with hundreds of docs and sub-directories | Directory groups and `exclude` keep the first screen readable (spec-00010) |

## 11. Risks & Technical Debt

| Item | Impact | Mitigation |
| --- | --- | --- |
| No format / complexity gate yet | Style drift is caught only in review | Listed as open in CODE_QUALITY.md §2 |
| The registry file contract has two implementations: Go `cli/internal/registry` and TS `workspaceRegistry.ts` | Drift splits `add` / `remove` / `list` behaviour between the with-process and no-process paths | design-00003 §2 stays the single contract, and both sides' tests cite the same `spec-00011` requirement ids, so drift turns one side red (decision-00020 §4) |

## 12. Glossary

See `CONTEXT.md`.
