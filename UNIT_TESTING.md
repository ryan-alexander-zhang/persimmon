# Unit Testing

The project-specific unit testing choice for this repo.

## Test Framework

Framework: `vitest`. It runs the TypeScript server modules and the React web
modules from one config, is the default test runner for a Vite project, and its
`@vitest/coverage-v8` reporter carries the coverage gate without a second tool.

## Command

From the repository root:

- `npm test` — run the suite once
- `npm run test:coverage` — run with the coverage report

## Scope

Unit tests cover the server modules under `src/` (parsing, config, workflow,
stores, session and git layers, API handlers) and the web modules under
`web/src/` (models, layout, rendering helpers, components), exercising each
requirement's GWT examples. Fixtures are written to a temporary directory; no
test touches this repository's `docs/`, except the config tests that load the
root `whiteboard.config.yaml` as the reference configuration.

## Gate

The suite passes, and coverage over `src/` and `web/src/` meets the bar in
[TESTING.md](TESTING.md). The measured scope excludes `web/src/main.tsx` and
the vendored `web/src/components/ui/**`, per [CODE_QUALITY.md](CODE_QUALITY.md) §2.

## Report

`npm run test:coverage` prints the summary and writes the HTML report to
`coverage/` (git-ignored).
