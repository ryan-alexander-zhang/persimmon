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
cd tools/whiteboard
npm install
npm run build
npm start            # http://localhost:4173, honours PORT
```

The board walks up from the directory it is launched in to the nearest
`whiteboard.config.yaml` and serves that repository's `docs/`. Commands, the
configuration contract, and the local `.whiteboard/` state are documented in
[tools/whiteboard/README.md](tools/whiteboard/README.md).

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
- [tools/whiteboard/README.md](tools/whiteboard/README.md): the board itself

## Origin

The whiteboard was developed inside the template repository and moved here so
that one installed board can serve any number of template projects instead of
every project carrying its own copy. The move and the direction it sets are
recorded in
[decision-00019](docs/decision/decision-00019-whiteboard-standalone-repo.md).
