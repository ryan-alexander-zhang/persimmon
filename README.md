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

```bash
npm install
npm run build
npm start            # http://localhost:4173, honours PORT
```

The board walks up from the directory it is launched in to the nearest
`whiteboard.config.yaml` and serves that repository's `docs/`.

## Commands

Run from the repository root:

| Task | Command |
| --- | --- |
| Setup | `npm install` |
| Build the UI | `npm run build` |
| Run | `npm start` (honours `PORT`, default 4173) |
| Test | `npm test` |
| Coverage | `npm run test:coverage` |
| Typecheck | `npm run typecheck` |
| UI dev server | `npm run dev` (proxies `/api` to a board started with `npm start`) |

`npm start` alone is enough to use the board: it serves the built UI from
`dist/web`, so run `npm run build` once first. `npm run dev` is for working on the
UI itself — it starts Vite with hot reload and proxies `/api` to a board that must
already be running via `npm start` in another terminal.

## Configuration

`whiteboard.config.yaml` at the repo root is the machine-readable carrier of
[rule-00001-docs-workflow](docs/rule/rule-00001-docs-workflow.md): the type
split, the relation fields, the product flow, and the agent commands. It is
validated at startup, and a missing or invalid config stops the board — there is
no built-in default.

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
  bit. npm blocks dependency install scripts, so `postinstall` restores it here;
  without it every session fails with `posix_spawnp failed`.
- The first-level subdirectories of a type's directory fold into one directory
  group node in that type's column, and the navigation sidebar mirrors it; the
  two share one expand state, and a group starts collapsed (`spec-00010`).
- The source runs on Node's native TypeScript stripping, so intra-package imports
  carry the real `.ts` extension and the code avoids constructor parameter
  properties, which strip-only mode rejects.

## Repo Map

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
