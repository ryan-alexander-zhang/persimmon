# persimmon

A local, single-user docs whiteboard for repositories built on
[ai-native-project-template](https://github.com/ryan-alexander-zhang/ai-native-project-template):
the `docs/` tree is rendered as a board (documents are nodes, front matter
relations are edges), and every action — review, promote, ask, co-write,
annotate — writes back to the Markdown files and commits.

The Markdown files stay the only source of truth. The board is a view and an
operations console over a repository; it can be discarded and rebuilt at any time.

This repository is also a project on the template: its own `docs/` holds the
whiteboard's idea, prd, specs, rules, decisions, designs, plans, issues, and
acceptance records, and this board is what renders them.

## Quick Start

Install the `persimmon` command:

```bash
curl -fsSL https://raw.githubusercontent.com/ryan-alexander-zhang/persimmon/main/install.sh | sh
```

The script picks the archive for this machine from the latest GitHub Release and
puts the binary on the PATH (linux and darwin; on Windows take the zip from the
Release page). **The first release, `v0.2.0`, has not been cut yet**, so there is
nothing for the script to download until it is — until then use the developer
form below.

Developing this repository:

```bash
npm install
npm run build
npm start            # the host alone: http://localhost:4173, honours PORT
```

`npm start` runs `bin/host.js`: it serves the board and registers nothing. For
the command's full startup handshake against this checkout instead of the
published host package:

```bash
npm run build && PERSIMMON_HOST=$PWD go -C cli run .
```

Both forms need `npm run build` first, because the host reads `lib/` and
`dist/web`.

The board walks up from the directory it is launched in to the nearest
`whiteboard.config.yaml` and serves that repository's `docs/`.

## Workspaces

A **workspace** is one registered project directory — a git repository with a
`whiteboard.config.yaml` and a `docs/` tree. One process serves any number of
them: each workspace gets its own board under `/w/<id>`, with its own graph,
sessions, ask threads, annotations and agent settings, and nothing crosses
between them (`spec-00011`).

The registry is a single file in your home directory,
`~/.persimmon/workspaces.json`: a version and a list of entries, each with an
`id` derived from the directory name, a display name, and the absolute path.
Entry order is switcher order. A missing file reads as an empty registry, and a
hand edit shows up on the next listing — no restart. The board writes nothing
else outside a project: `.whiteboard/`, the flow config and `docs/` all stay in
the project directory.

The **switcher** sits at the far left of the top bar. It lists every entry with
its path, its availability, and its running and waiting session counts, and it
carries the add and per-entry remove controls. Choosing an entry swaps the whole
board to it and puts it in the address bar; the process and the port do not
change, and the sessions of the other workspaces keep running. An entry whose
directory is gone, holds no flow config, is not a git repository, or has an
invalid config is listed as unavailable with the reason, and choosing it is
refused.

## The `persimmon` command

```bash
persimmon             # start, or attach to a process already running
persimmon new <name> [--lang <l>] [--variant <v>] [--dir .] [--ref <branch>] [--set KEY=VALUE]
persimmon update [--dir .]
persimmon list-langs
persimmon add [path] [--name <n>]
persimmon remove <id|path>
persimmon list
persimmon version
persimmon help
```

`persimmon` with no subcommand walks up from the current directory to the
nearest `whiteboard.config.yaml`; the project it finds is registered (idempotent)
and opened. Outside any project it opens the workspace this browser was last in,
otherwise the first available entry, otherwise the empty state. It prints the
address to open. The port comes from `PORT`, default 4173.

If a persimmon is already listening on that port, the command starts no second
process: it registers through the one already running — whose switcher picks the
new entry up at once — prints that workspace's address and exits 0. A port held
by anything else is reported as occupied, with a non-zero exit.

`add` takes a path, or defaults to the project the current directory is in;
`--name` sets the display name, which otherwise follows the id. It is
non-interactive and idempotent — an already registered directory exits 0 with
the existing entry. A path that does not exist, is not a directory, or holds no
flow config is refused; an invalid flow config or a directory that is no git
repository is *not* — it registers and shows up as unavailable.

`remove` takes an id or a path and deletes the registry entry only, touching
nothing inside the directory; it is refused while that workspace has a running
session. That refusal comes from the running process, which is the only thing
that has sessions: with no process the command writes the registry file
directly, and the rule holds vacuously ([design-00004](docs/design/design-00004-persimmon-cli.md)
§4). `list` prints every entry's id, name, path and availability.

`new` scaffolds a new project from the
[ai-native-project-template](https://github.com/ryan-alexander-zhang/ai-native-project-template)
repository into `<dir>/<name>` and registers it as a workspace in the same step;
`--lang` and `--variant` pick a `lang/*` branch, `--ref` overrides the branch
outright, and `--set KEY=VALUE` (repeatable) fills the template's variables.
`list-langs` prints the templates that repository offers. `update` three-way
merges later template changes into an existing project, using the creation
marker written by `new`; conflicts are left as ordinary `<<<<<<<` markers for
you to resolve and commit ([spec-00013](docs/spec/spec-00013-persimmon-scaffold.md)).

`version` prints the command's version, `help` its usage; both also answer to
their `-v` / `-h` and `--version` / `--help` forms.

## Commands

Run from the repository root:

| Task | Command |
| --- | --- |
| Setup | `npm install` |
| Build the UI and the server | `npm run build` |
| Run | `npm start` (honours `PORT`, default 4173) |
| Test | `npm test` |
| Coverage | `npm run test:coverage` |
| Typecheck | `npm run typecheck` |
| UI dev server | `npm run dev` (proxies `/api` to a board started with `npm start`) |

`npm start` alone is enough to use the board: it serves the built UI from
`dist/web` and loads the server from `lib/`, both of which `npm run build`
produces, so run it once first. `npm run dev` is for working on the UI itself —
it starts Vite with hot reload and proxies `/api` to a board that must already
be running via `npm start` in another terminal.

## Configuration

`whiteboard.config.yaml` at the repo root is the machine-readable carrier of
[rule-00001-docs-workflow](docs/rule/rule-00001-docs-workflow.md): the type
split, the relation fields, the product flow, and the agent commands. There is
no built-in default: a workspace whose config is missing or invalid is listed as
unavailable with the reason, and cannot be opened until it is fixed — the process
and the other workspaces are unaffected. A workspace already open keeps the
config it was opened with, so an edit takes effect on the next start.

`exclude` is a list of glob patterns relative to `docs/`: a matched file does not
exist for the board — no node, no anomaly, no id — and the list is read at
startup, so a change to it takes effect on the next start (`spec-00010`).

### Adding an agent CLI

The `agents` block names the CLI a session runs. A session's working directory is
`docs/`, which is the write-scope constraint the MVP relies on. **Before adding a
CLI here, verify it against `spec-00001-AC-13.2`**: a write outside the docs tree
must not land. An unverified CLI does not belong in the shipped config.

That block is the **project layer**, shared through git. Over it sits a **local
layer** — `.whiteboard/agents.json`, which git ignores — holding this machine's
own choices: a different `model` or `command` for an entry the project declares,
extra `env`, an entry only this machine has, a disabled entry, a different
default. Edit it from the settings panel in the board's top bar, or by hand; it
is re-read on every session start, so a change takes effect without a restart,
and an ill-formed file is ignored whole rather than stopping the board. The
verification discipline above applies to the **project layer only**: what runs on
your own machine is your own call.

## Notes

- `node-pty` ships prebuilt binaries whose `spawn-helper` needs the executable
  bit, and npm blocks dependency install scripts. In this checkout `postinstall`
  restores it. A user never installs the host package by hand — the command
  fetches it with `npx`, whose cache install runs no install script at all — so
  the bit is set again at spawn time from `src/pty.ts`
  ([issue-00030](docs/issue/issue-00030-npx-leaves-the-pty-spawn-helper-non-executable.md)).
  Without either, every session fails with `posix_spawnp failed`.
- The first-level subdirectories of a type's directory fold into one directory
  group node in that type's column, and the navigation sidebar mirrors it; the
  two share one expand state, and a group starts collapsed (`spec-00010`).
- The source runs on Node's native TypeScript stripping, so intra-package imports
  carry the real `.ts` extension and the code avoids constructor parameter
  properties, which strip-only mode rejects.

## Repo Map

- [cli/](cli/): the `persimmon` command — Go, its own `go.mod`
- [AGENTS.md](AGENTS.md): behavior rules for coding agents in this repo
- [ARCHITECTURE.md](ARCHITECTURE.md): architecture index for the whiteboard
- [CONTEXT.md](CONTEXT.md): the project glossary
- [DEVELOPMENT.md](DEVELOPMENT.md): implementation workflow, commands, Definition of Done
- [DOCUMENT.md](DOCUMENT.md): document management rules
- [TESTING.md](TESTING.md) and [UNIT_TESTING.md](UNIT_TESTING.md): test policy and the unit stack
- [CODE_QUALITY.md](CODE_QUALITY.md): quality gates
- [whiteboard.config.yaml](whiteboard.config.yaml): the flow configuration this repo's board reads
- [docs/README.md](docs/README.md): source of truth for the docs taxonomy

## Origin

The whiteboard was developed inside the template repository and moved here so
that one installed board can serve any number of template projects instead of
every project carrying its own copy. The move and the direction it sets are
recorded in
[decision-00019](docs/decision/decision-00019-whiteboard-standalone-repo.md).
