# Testing

## Purpose

This file defines the minimum testing standard for this repo.

Use it to decide:
- what level to test at
- what tests are required for a change
- when work is done

## Test Pattern

Keep tests simple:
- test the behavior you changed
- use the lowest test level that proves the behavior
- keep tests deterministic and easy to read
- prefer one clear behavior per test
- every bug fix must add or update a regression test

## Test Levels

### Unit

Use unit tests for business logic, validation, mapping, and small decision logic.

Unit tests should:
- be fast
- be deterministic
- avoid real infrastructure

### Integration

Use integration tests when correctness depends on real boundaries such as the database, migrations, messaging, filesystem, framework wiring, or external service clients.

Integration tests should:
- test the real boundary that matters
- isolate their data
- not depend on execution order

### API

Use API tests when the behavior is an HTTP contract or endpoint workflow and does not require full UI coverage.

API tests should:
- verify request and response behavior at the boundary
- check status, shape, and key side effects
- stay smaller and cheaper than E2E tests

### E2E

Use E2E tests only for critical user flows, high-risk system flows, and smoke checks.

E2E tests should:
- stay small in number
- cover the full happy path first
- cover only the most valuable failure paths

## Test Level Guides

Use the following docs to define the project-specific framework choice for each test level.

- [UNIT_TESTING.md](UNIT_TESTING.md): fill in the unit testing guide for this repo.
- [INTEGRATION_TESTING.md](INTEGRATION_TESTING.md): fill in the integration testing guide for this repo.
- [API_TESTING.md](API_TESTING.md): fill in the API testing guide for this repo.
- [E2E_TESTING.md](E2E_TESTING.md): fill in the E2E testing guide for this repo.

The `persimmon` command in `cli/` has the unit level only — `go test ./...` with
the standard library `testing` package, no browser and no E2E. Where its
behaviour is an HTTP contract, the startup handshake's `GET /api/instance` and
`POST /api/workspaces`
([design-00004](docs/design/design-00004-persimmon-cli.md) §3–§5), the API-level
test is a Go test against an `httptest` stub server rather than a Bruno
collection: what is under test is the request the command sends and how it reads
the reply, and the server side of that contract is covered by the TS suites.

## Testing Matrix

| Change type | Minimum requirement |
| --- | --- |
| Docs-only change | Manually verify the edited text, links, commands, and examples. |
| Pure logic change | Add or update relevant unit tests. |
| Database or persistence change | Add or update relevant unit tests and integration tests. Verify migrations if schema changed. |
| API or HTTP contract change | Add or update the relevant API and/or integration tests. Verify the request, response, and key side effects. |
| Messaging or async workflow change | Add or update the relevant unit and/or integration tests. Verify the contract or workflow behavior. |
| Critical user or system flow change | Add or update the relevant tests and run an E2E or smoke check for the changed flow. |
| Bug fix | Add or update a regression test that would have caught the bug. |
| Refactor with no intended behavior change | Keep existing tests green. Add tests only if coverage is too weak to prove safety. |

## Definition of Done

A change is done only when all of these are true:

- the requested behavior is complete
- the required tests from the matrix are added or updated
- the relevant tests pass
- no known regression is left behind
- for executable code changes, line coverage is at least 90%
- for executable code changes, branch coverage is at least 90%
- for executable code changes, function coverage is at least 90%
- for Go code changes under `cli/`, statement coverage is at least 90% for new
  packages, in place of the three bars above (see Coverage)

## Coverage

- Line coverage: the percentage of executable lines run by tests
- Branch coverage: the percentage of decision paths run by tests
- Function coverage: the percentage of functions or methods called by tests

For executable code changes, the minimum acceptable coverage is `90%` for line coverage, branch coverage, and function coverage.

Do not mark work complete below this bar unless an explicit exception is approved in advance.

### Go (`cli/`)

The Go toolchain reports statement coverage only (`go test -cover`); branch and
function coverage have no tooling in Go and the two bars above do not apply
there ([decision-00020](docs/decision/decision-00020-unified-go-cli.md) §4). New
Go packages must reach `90%` statement coverage. The `cli/internal/scaffold`
package imported from ainpt arrives at 25.7% statement coverage and is recorded
as legacy debt per [CODE_QUALITY.md](CODE_QUALITY.md) §8: the gate blocks new
violations and this bar ratchets up toward 90% as
[spec-00013](docs/spec/spec-00013-persimmon-scaffold.md)'s acceptance set lands
— never by lowering it.
