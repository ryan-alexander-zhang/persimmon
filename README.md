# persimmon

[![CI](https://github.com/ryan-alexander-zhang/persimmon/actions/workflows/ci.yml/badge.svg)](https://github.com/ryan-alexander-zhang/persimmon/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A local whiteboard for the `docs/` tree of a repository built on
[ai-native-project-template](https://github.com/ryan-alexander-zhang/ai-native-project-template),
and the command that creates, upgrades and opens such repositories.

Documents are nodes, front-matter relations are edges. Every action on the
board — review, promote, ask, co-write, annotate — writes back to the Markdown
files and commits. The Markdown stays the only source of truth; the board is a
view over it and can be discarded and rebuilt at any time.

- **One process, many projects.** Register any number of repositories; each gets
  its own board under `/w/<id>` with its own sessions, threads and settings.
- **Scaffold and upgrade.** `persimmon new` creates a project from the template;
  `persimmon update` three-way-merges later template changes into it.
- **Agent sessions in the browser.** Run your coding-agent CLI against a
  document from the board, with a real terminal, scoped to `docs/`.
- **Nothing hidden.** State lives in the project (`docs/`, `.whiteboard/`,
  `whiteboard.config.yaml`) and in one registry file in your home directory.

## Requirements

- Node.js ≥ 23.6
- `git` and `tar` on `PATH`
- Linux or macOS

## Install

Nothing is published to npm yet. Install from source:

```bash
git clone https://github.com/ryan-alexander-zhang/persimmon.git
cd persimmon
npm ci && npm run build
npm link                      # puts `persimmon` on your PATH, pointing at this checkout
```

After changing the source, `npm run build` is enough — the link keeps pointing
at the checkout. `npm unlink -g @ryan-alexander-zhang/persimmon` removes the
command.

Once a version is published the same command will install with
`npm i -g @ryan-alexander-zhang/persimmon` or run with
`npx @ryan-alexander-zhang/persimmon`.

## Usage

```bash
persimmon new demo --lang go      # scaffold a project from the template and register it
cd demo
persimmon                         # serve its board and print http://localhost:4173/w/demo
```

| Command | What it does |
| --- | --- |
| `persimmon` | Start the board for the project the current directory is in, or attach to a board already running. Outside any project, open the last used workspace. |
| `persimmon new <name> [--lang <l>] [--variant <v>] [--dir <d>] [--ref <branch>] [--set KEY=VALUE]` | Create `<dir>/<name>` from the template and register it. `--lang`/`--variant` choose a `lang/*` branch; `--ref` names a branch outright; `--set` fills template variables (repeatable). |
| `persimmon update [--dir <d>]` | Merge the template's changes since the project was created. Conflicts are left as ordinary `<<<<<<<` markers for you to resolve and commit. |
| `persimmon list-langs` | List the languages and variants the template offers. |
| `persimmon add [path] [--name <n>]` | Register a project (default: the one the current directory is in). Idempotent. |
| `persimmon remove <id\|path>` | Unregister a project. Touches nothing inside it. Refused while it has a running session. |
| `persimmon list` | Every registered project with its id, name, path and availability. |
| `persimmon version`, `persimmon help` | Also `-v` / `--version`, `-h` / `--help`. |

The port comes from `PORT` (default `4173`). If a persimmon is already
listening there, a second `persimmon` does not start another process — it
registers through the running one and prints that project's address. A port
held by anything else is reported as occupied.

The template repository defaults to `ryan-alexander-zhang/ai-native-project-template`;
override with `AINPT_OWNER` and `AINPT_REPO`.

## How it works

**Workspaces.** A workspace is one registered project directory: a git
repository with a `whiteboard.config.yaml` and a `docs/` tree. The registry is
`~/.persimmon/workspaces.json` — a version and a list of `{ id, name, path }`
entries, in switcher order. A missing file is an empty registry; a hand edit
shows up on the next listing. A project whose directory is gone, is not a git
repository, or has a missing or invalid config is listed as unavailable with the
reason and cannot be opened; the others are unaffected.

**Configuration.** `whiteboard.config.yaml` at the project root declares the
document types, their relation fields, the product flow, and the agent CLIs a
session may run. There is no built-in default. `exclude` lists glob patterns
under `docs/` that the board ignores. Both are read when the workspace is
opened.

**Agents.** The `agents` block in the config is the project layer, shared
through git. `.whiteboard/agents.json` (git-ignored) is the local layer for
this machine — a different model or command, extra environment, an entry only
you have, a disabled entry. Edit it from the settings panel or by hand; it is
re-read on every session start. A session's working directory is `docs/`.

## Troubleshooting

**Every agent session fails with `posix_spawnp failed`.** `node-pty` ships a
prebuilt `spawn-helper` that needs the executable bit, and npm no longer runs
dependency install scripts. persimmon restores the bit itself before the first
spawn; if you see this error, check that the `node_modules/node-pty` tree is
writable by the user running the command.

## Development

```bash
npm ci
npm run build          # vite build + tsc → dist/web and lib/
npm test               # vitest, ~2 300 tests
npm run typecheck
npm run test:coverage  # 90 % lines / branches / functions
npm run dev            # Vite with hot reload; proxies /api to a board started with `npm start`
npm run test:install   # end-to-end: npm pack → npm link, npx and global install of the tarball
```

The source runs on Node's native TypeScript stripping, so intra-package imports
carry the `.ts` extension and the code avoids constructor parameter properties.

This repository is itself a project on the template: its `docs/` holds the
specs, designs, decisions, plans and acceptance records that govern it, and
this board renders them. Start there:

- [ARCHITECTURE.md](ARCHITECTURE.md) — how the pieces fit
- [DEVELOPMENT.md](DEVELOPMENT.md) — implementation workflow and definition of done
- [CONTEXT.md](CONTEXT.md) — the project glossary
- [docs/README.md](docs/README.md) — the document taxonomy

## License

[MIT](LICENSE)
