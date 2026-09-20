# Source Materials

Summaries in this directory are extracted from Ryan's pre-research notes. This file
indexes them and records which copy is authoritative where copies disagree.

| Note | Content | Authority |
|---|---|---|
| `20260916204559-PersimmonAI-Design.md` | Prose design (§1–15) plus a full copy of the JSON Schema and examples | Prose is authoritative. Schema section is corrupted (see below) |
| `20260917170003-Resource Schema.md` | `resource.schema.json`: one Draft 2020-12 schema, `oneOf` over 13 kinds, 72 `$defs` | Authoritative schema |
| `20260917170054-Type Example Schema.md` | `type-examples.json`: one example instance per `$def`, plus the full `DefinitionSnapshot` | Authoritative examples |
| `20260917170148-Example YAML.md` | `examples.yaml`: 76 resources forming the complete SDLC example | Authoritative example corpus |
| `20260917170340-Example SDLC YAML.md` | The `Workflow/sdlc` document extracted from `examples.yaml` | Byte-identical extract |
| `20260916101242-Persimmon AI Project Research.md` | Earlier thinking: recursive workflow model, tool landscape, runtime options | Input for candidates only; design doc is the baseline |
| `20260914101336-Persimmon Template Review.md` | Review of a docs-template repository | Out of scope for the workflow engine |

## Corruption in the design doc schema section

The design doc's `模型 Schema 与实例` section (lines 428–7546) was pasted through an
editor that inserts spaces between letters and digits. Examples:

- `sha 256:[a-f 0-9]{64}` should be `sha256:[a-f0-9]{64}`
- `persimmon.snapshot/v 1` should be `persimmon.snapshot/v1`
- `" #/ $defs/Condition"` should be `"#/$defs/Condition"`
- `engineering.persimmon.ai/v 1` should be `engineering.persimmon.ai/v1`

All 72 `$defs` match the clean copies byte-for-byte once the inserted spaces are removed.
Use the three linked notes when copying schema text; use the design doc for prose.

## Content overlap

- Resource Schema: 100% duplicated in the design doc (corrupted there).
- Type Example Schema: 71 of 72 duplicated. New: the `DefinitionSnapshot` example
  (54 resources: 20 Task, 14 ArtifactSchema, 5 Validator, 5 Workflow, 4 Executor, 4 Gate, 2 RelationType).
- Example YAML: 26 of 76 duplicated. New: the full `sdlc` workflow, 19 Tasks, 3 Executors,
  4 Validators, 3 Gates, 4 Workflows, `RelationType/verifies-v1`, extra Run samples.

## Referenced but absent files

The design doc §15 lists `validate.py`, `test_spec.py`, `simulate.py`, `expression_profile.py`,
`requirements.txt`, `validation-report.json`, `test-output.txt`, `simulation-trace.json`.
None exist in the notes or in this repository.
