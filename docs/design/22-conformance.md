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
| probe | one `describe` before any rule; its answer is E1's and V1's and tells the Roles; a probe that fails or names no Roles leaves every rule running so E1 and V1 report it |
| configuration | `--config` (YAML, validated against `describe.configurationSchema`), else `describe.conformance.configuration` offline, else `{}` |
| credentials | the fixture's Task credential is the suite's own random value; the Adapter's `credentialBindings` resolve as at apply only with `--live`, offline they are fake too, so the record the stub writes holds no real secret |
| callbacks | served by the suite: `getArtifact` answers the fixture artifact, `putBlob` hashes, `publishArtifact` answers a RevisionRef in Namespace `conformance`, `log` records; a wrong token is `unauthorized` |
| `--live` | no `PERSIMMON_ADAPTER_CONFORMANCE`, no cues, no record: the real CLI answers once with `--config` or `{}`; only the rules marked live run |
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
| E4 | a second `execute` with the same `idempotencyKey` publishes the same artifact identity, or publishes nothing and answers the same outputs | `19` | process | no |
| E5 | credentials reach the program only as `<NS>__<NAME>` environment; the secret appears in no argument, stdin, stream line or result | `07`, `13`, `19` | process | no |
| E6 | `engine.token` and `PERSIMMON_ADAPTER_TOKEN` reach the program nowhere: not environment, arguments or stdin | `19` | process | no |
| E7 | the program runs with cwd `payload.workspace`; a workspace that is not a directory is `invalid_input`, not retryable | `19` | process | yes (the refusal) |
| E8 | a deadline already passed is `timeout`; a program that outlives the deadline is killed and the error is `timeout`, retryable | `19` | process | yes (the passed deadline) |
| E9 | `cancel` of a running attempt by its `idempotencyKey` answers a CancelResult; a process attempt then answers `cancelled`; a human attempt is cancelled after its ack, any state | `19` | `supports.cancel` | no |
| E10 | a program that exits non-zero is `agent_failed`, retryable; credential values are redacted from stream `log` lines | `19` | process | no |
| E11 | the prompt presents context entries (an artifact by content or by id) before `instructions`, in order, and `instructions` verbatim | `19` | agent | no |
| E12 | a declared Skill not installed in the workspace is `invalid_input`; installed with another digest is `skill_digest_mismatch`, not retryable; installed and equal passes (the two installed cases need `describe.conformance.skillDir`) | `15`, `19` | `skillFormats` non-empty and `contextKinds` has `skill` | yes (missing) |
| E13 | an unknown op is `invalid_input` | `07` | all | yes |
| E14 | `execute` answers HumanAck after a `waiting` stream line with reason `human` | `19` | human | yes |
| E15 | every error seen is `{code, message, retryable}` with a lower snake `code` | `03`, `07` | all | yes |
| E16 | `execute` with `task.outputIds` publishes the artifact output under that id, and the output is its RevisionRef | `12`, `19` | process | no |
| E17 | `execute` with an `artifacts` output and `task.outputIds` publishes each item of the answered list as `<prefix>-<n>` in order, and the output is their RevisionRefs | `12`, `19` | process | no |

Evaluator Role (`24-eventstorming.md` brought the first one):

| Id | Rule | Source | Applies | Live |
|---|---|---|---|---|
| V1 | `describe` validates `EvaluatorDescribe`; `roles` has `evaluator` | `19` | evaluator | yes |
| V2 | `evaluate` with the fixture artifact as `artifacts.model` answers a ValidationResult; `passed` may be false | `14`, `19` | evaluator | yes |
| V3 | a second identical `evaluate` answers an equal result | `19` | evaluator | yes |
| V4 | `evaluate` makes no Engine callback | `14` | evaluator | yes |
| V5 | an unknown op is `invalid_input`; every error is `{code, message, retryable}` | `07` | evaluator | yes |

An Adapter without the executor Role skips E1–E17 "not an executor"; one without the evaluator
Role skips V1–V5 "not an evaluator".

A rule whose `Applies` does not hold is `skip`. A process rule that needs the record and finds none
after a succeeded E3 is a `FAIL`: a program that ignores the contract proves nothing. E12 without
`describe.conformance.skillDir` passes on the missing case alone and says so. E15 is checked on
every failure the other rules provoke.

## Stub contract

An Adapter runs offline when it honours this contract; one that does not runs live only. It
answers `describe.conformance.configuration`, the Executor configuration under which `execute`
completes the fixture offline, and `describe.conformance.skillDir`, where it discovers Skills under
the workspace. For the shipped agent Adapters that configuration is `configuration.command`: a
non-empty program array run in place of `claude` or `codex` with the CLI's own arguments and stdin.

| Guard | Rule |
|---|---|
| `configuration.command` | honoured only when the Adapter process has `PERSIMMON_ADAPTER_CONFORMANCE=1`; otherwise `invalid_input`, not retryable |
| the engine | its stdio env allowlist never passes that variable, `Adapter.spec.env` may not name `PERSIMMON_*`, and the stdio transport drops any such name from `spec.env` or a credential binding before it adds the token; no shipped `configurationSchema` lists `command`, so an applied Executor cannot name it |
| the operator | not kept out: whoever runs the engine owns its environment (`NODE_OPTIONS` included) and its Adapters |
| `PATH` | never changed |

The suite sets these on the Adapter process; the shipped runner passes its environment to the
program (`19-adapter-roles.md`).

| Variable | Content |
|---|---|
| `PERSIMMON_ADAPTER_CONFORMANCE` | `1` |
| `PERSIMMON_CONFORMANCE_ANSWER` | the flat JSON answer, one key per output port |
| `PERSIMMON_CONFORMANCE_RECORD` | a path; the program writes `{argv, stdin, env, cwd, pid}` there before answering |
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
  an Executor that names it at apply, and the runner refuses it without the flag. The suite's
  flag and cues travel as call options, never as `Adapter.spec.env`, which may not name
  `PERSIMMON_*` at all. Found in audit.
- The handler Role is not covered: no shipped Adapter has it. Its rules (validate pure, declared
  Actions only, no-op after terminal) stay on the roadmap until an Adapter needs them. The evaluator
  Role arrived with `eventstorming/v1` and has V1–V5.
- The fixture answer reaches the stub by environment and a live model by the instructions;
  the live run is one real `execute`, the cheapest proof that the argument mapping works.
- The fixture answer agrees with its context. An answer the context contradicted read as a
  prompt injection to claude, which answered from the context instead; a value input beside the
  instructions was copied as `count`. Found in UAT.
- `junit/v1` ships without a stub and is not in the shipped list the suite runs over: E3 expects
  the fixture's answer and E10 an `agent_failed` on a non-zero exit, and its contract is the
  opposite of both, an answer read from JUnit XML and an exit code that is an outcome
  (`35-build-process.md`). Its own tests cover it. Found in implementation.
