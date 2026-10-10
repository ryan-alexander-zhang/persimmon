# Conformance

status: active · layer: cross-cutting (`07-adapter.md`, `19-adapter-roles.md`) · schema: none

`persimmon adapter test <id>` plays the engine against one Adapter and reports every rule by
id. The same suite runs as a vitest file over the shipped Adapters.

```text
suite ── stdio request (env allowlist + conformance cues) ──▶ Adapter ──▶ agent CLI | configuration.command program
suite ◀── Engine callbacks (unix socket, call token) ─────── Adapter
suite ── `E3 pass  execute answers exactly the declared outputs` ─▶ terminal; exit 1 on any FAIL
```

## Verb

`persimmon adapter test <id> [--config <file>] [--live]`

| Step | Rule |
|---|---|
| Adapter | from the store by `id`; its manifest `command`; the suite runs it in a temp cwd with the engine's env allowlist (`07-adapter.md`) |
| configuration | `--config` (YAML, validated against `describe.configurationSchema`), else `describe.conformance.configuration`, else `{}` |
| credentials | the fixture's Task credential is the suite's own random value; the Adapter's `credentialBindings` resolve as at apply |
| callbacks | served by the suite: `getArtifact` answers the fixture artifact, `putBlob` hashes, `publishArtifact` answers a RevisionRef in Namespace `conformance`, `log` records; a wrong token is `unauthorized` |
| `--live` | no `PERSIMMON_ADAPTER_CONFORMANCE`, no cues, no record: the real CLI answers once; only the rules marked live run |
| report | one line per rule: `<id> pass \| FAIL \| skip  <rule>`, the reason after a FAIL or skip; exit 1 on any FAIL |

## Fixture

One Task, the same for every Adapter: context an artifact and a Prompt, one artifact input,
outputs `doc` (artifact `conformance.persimmon.ai/v1 Note`, content `{title}`) and `count`
(integer), credential binding `demo/github-token`, `sideEffects: idempotent`. The answer is what a careful
agent derives from the context anyway, the note's title and the number of notes, so a live agent
gives the same answer the stub gives.

## Rules

Applies: `all` every Role `executor` Adapter; `process` an Adapter whose `executorTypes`
include `agent`, `script` or `tool`; `human` one that includes `human`.

| Id | Rule | Source | Applies | Live |
|---|---|---|---|---|
| E1 | `describe` validates `ExecutorDescribe`; `adapterId` is the requested id; `roles` has `executor` | `07`, `19` | all | yes |
| E2 | a second `describe` is equal to the first | `07` | all | yes |
| E3 | `execute` answers a TaskResult with exactly the declared outputs; value ports equal the fixture answer; an artifact port is published with `putBlob` then `publishArtifact` under the call token, content equal to the answer, and the result carries the RevisionRef the suite returned | `19` | process | yes |
| E4 | a second `execute` with the same `idempotencyKey` publishes the same artifact identity | `19` | process | no |
| E5 | credentials reach the program only as `<NS>__<NAME>` environment; the secret appears in no argument, stdin, stream line or result | `07`, `13`, `19` | process | no |
| E6 | `engine.token` and `PERSIMMON_ADAPTER_TOKEN` reach the program nowhere: not environment, arguments or stdin | `19` | process | no |
| E7 | the program runs with cwd `payload.workspace`; a workspace that is not a directory is `invalid_input`, not retryable | `19` | process | yes (the refusal) |
| E8 | a deadline already passed is `timeout`; a program that outlives the deadline is killed and the error is `timeout`, retryable | `19` | process | yes (the passed deadline) |
| E9 | `cancel` of a running attempt by its `idempotencyKey` answers a CancelResult; a process attempt then answers `cancelled`; a human attempt is cancelled after its ack | `19` | `supports.cancel` | no |
| E10 | a program that exits non-zero is `agent_failed`, retryable; credential values are redacted from stream `log` lines | `19` | process | no |
| E11 | the prompt presents context entries before `instructions`, in order, and `instructions` verbatim | `19` | agent | no |
| E12 | a declared Skill not installed in the workspace is `invalid_input`; installed with another digest is `skill_digest_mismatch`, not retryable; installed and equal passes (the two installed cases need `describe.conformance.skillDir`) | `15`, `19` | `skillFormats` non-empty | yes (missing) |
| E13 | an unknown op is `invalid_input` | `07` | all | yes |
| E14 | `execute` answers HumanAck after a `waiting` stream line with reason `human` | `19` | human | yes |
| E15 | every error seen is `{code, message, retryable}` with a lower snake `code` | `03`, `07` | all | yes |

A rule whose `Applies` does not hold is `skip`. E15 is checked on every failure the other
rules provoke.

## Stub contract

An Adapter that drives a CLI answers `describe.conformance.configuration`, the Executor
configuration under which `execute` completes the fixture offline, and `describe.conformance.skillDir`,
where it discovers Skills under the workspace. For the shipped agent
Adapters that is `configuration.command`: a program array run in place of `claude` or `codex`
with the CLI's own arguments and stdin.

| Guard | Rule |
|---|---|
| `configuration.command` | honoured only when the Adapter process has `PERSIMMON_ADAPTER_CONFORMANCE=1`; otherwise `invalid_input`, not retryable |
| the engine | its stdio env allowlist never passes that variable; no `configurationSchema` lists `command`, so an applied Executor cannot name it |
| `PATH` | never changed |

The suite sets these on the Adapter process; the shipped runner passes its environment to the
program (`19-adapter-roles.md`).

| Variable | Content |
|---|---|
| `PERSIMMON_ADAPTER_CONFORMANCE` | `1` |
| `PERSIMMON_CONFORMANCE_ANSWER` | the flat JSON answer, one key per output port |
| `PERSIMMON_CONFORMANCE_RECORD` | a path; the program writes `{argv, stdin, env, cwd}` there before answering |
| `PERSIMMON_CONFORMANCE_AGENT` | `answer` (default) · `sleep` never answers · `fail` prints every environment value whose name contains `__` to stderr and exits 1 |

Shipped stubs: `adapters/<id>/conformance.mjs`, on `adapters/lib/conformance.mjs`, one per
CLI format. `subprocess/v1` names its stub as `configuration.program`; `cli-human/v1` needs
none.

## Decisions

- The stub replaces the CLI through `configuration.command` under `PERSIMMON_ADAPTER_CONFORMANCE=1`,
  never by shadowing binaries on `PATH`: a `PATH` the suite writes is a door every process
  behind it walks through. Found in UAT.
- The suite serves its own callbacks instead of the engine's: a real `publishArtifact` needs
  a registered artifact kind and a Publication scope owned by a run, and the suite checks the
  Adapter, not the engine. `putBlob` hashes for real so a digest mismatch would show.
- `command` is absent from every shipped `configurationSchema` on purpose: the engine refuses
  an Executor that names it at apply, and the runner refuses it without the flag.
- Handler and evaluator Roles are not covered: no shipped Adapter has them. Their rules
  (validate pure, declared Actions only, no-op after terminal; `evaluate` answers a
  ValidationResult) stay on the roadmap until an Adapter needs them.
- The fixture answer reaches the stub by environment and a live model by the instructions;
  the live run is one real `execute`, the cheapest proof that the argument mapping works.
- The fixture answer agrees with its context. An answer the context contradicted read as a
  prompt injection to claude, which answered from the context instead; a value input beside the
  instructions was copied as `count`. Found in UAT.
