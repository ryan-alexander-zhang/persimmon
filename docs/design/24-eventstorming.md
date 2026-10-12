# Event storming

status: draft · layer: 2 (`23-pack-ai-native.md`) · schema: the `EventStorming` kind in `packs/ai-native/global/10-artifact-kinds.yaml`

The event storming tool, built in: its DSL as an artifact kind, its grammar as a module, its
validator as the first shipped evaluator Adapter. The editor (`tools/eventstorming/`, later) and
the pack Tasks that run a session (unit 2) build on these three.

```text
EventStorming revision ──▶ Validator eventstorming-grammar ──▶ Adapter eventstorming/v1 (evaluator)
   content: DSL v4.0            inputs.model                      evaluate: grammar.check(content) ──▶ ValidationResult
                                                                  imports tools/eventstorming/grammar/index.mjs
```

## Kind

`EventStorming`, `sdd.persimmon.ai/v1`, Namespaced, Immutable, revisioned. Content is DSL v4.0 of
the tool without `meta.createdAt`; one artifact per model, a revision per phase as `meta.level`
rises.

| Field | Content |
|---|---|
| `version` | `"4.0"`, the grammar version |
| `meta` | `{name, level: big-picture \| process \| design}`; the level gates which node types may appear |
| `contexts[]` | `{id, name, order, classification?: core \| supporting \| generic, bigBallOfMud?}` |
| `contextRelationships[]` | `{id, source, target, type}`; `source` is upstream; the tool's eight camelCase types |
| `nodes[]` | `{id, type, label, context?, order?, properties}`; ten types; `order` on `domainEvent` only, one global sequence |
| `edges[]` | `{id, source, target, relation}`; eleven relations, each legal for fixed source and target types |

The schema is the shape: closed objects, enumerated `properties` keys, enum values. Which key is
legal on which type, level gating, edge rules and smells are the grammar's. Shape errors stop at
publish; grammar findings arrive all at once from the Validator.

## Grammar

`tools/eventstorming/grammar/index.mjs` with `index.d.ts`, no dependencies, the tool's
`grammar.json`, `validate.py` and `health.ts` as one module.

| Export | Content |
|---|---|
| `elements`, `levels`, `levelRank`, `relations`, `contextRelations`, `propertyTypes` | the tables |
| `check(content)` | `Finding[]` in the engine's shape `{severity, code, message}`; errors first, then by code and message |

| Severity | Codes |
|---|---|
| error | `not-a-model`, `duplicate-id`, `undeclared-context`, `self-relationship`, `not-at-level`, `order-not-on-event`, `property-not-on-type`, `bad-enum`, `bad-parameters`, `edge-endpoint-missing`, `illegal-connection`, `wrong-relation` |
| warning | `event-without-order`, `empty-context`, `no-pivotal-event`, `orphan-event` (not a temporal event, not at big-picture), `dangling-command`, `unissued-command`, `overloaded-aggregate` (over 5 commands or 5 events), `untriggered-policy`, `idle-policy`, `policy-without-execution`, `lone-alternative`, `reaction-cycle`, `duplicate-edge`, `unrecorded-resolution` |
| info | `open-hotspots` |

An error is what the tool's editor refused; a warning is a smell the author decides on; info is
work left open.

## Adapter `eventstorming/v1`

`adapters/eventstorming/`, Role `evaluator` only, stdio, no Engine callbacks, no credentials.

| Op | Answer |
|---|---|
| `describe` | `roles: [evaluator]`, `configurationSchema: {level?: big-picture \| process \| design, failOnWarning?: boolean}` |
| `evaluate` | `artifacts.model.content` through `check`; `passed` = no error, and no warning under `failOnWarning`; a required level from `inputs.level` (the Validator's value input, bound per Gate) else `configuration.level`; the model's `meta.level` below it adds error `below-level`; content that is not a model is `passed: false` with `not-a-model`, never an Adapter error; `artifacts.model` missing is `invalid_input`; `evidence: []` |
| other | `invalid_input` |

Pure: the same payload answers the same result.

## Conformance, evaluator Role

`22-conformance.md` gains rules V1–V5; the suite sends one `describe` first, which is E1's and V1's
answer and tells the Roles, then `persimmon adapter test eventstorming/v1` runs V1–V5 and skips E1–E15 as "not an
executor".

| Id | Rule |
|---|---|
| V1 | `describe` validates `EvaluatorDescribe`; `roles` has `evaluator` |
| V2 | `evaluate` on the fixture artifact answers a ValidationResult; `passed` may be false |
| V3 | a second identical `evaluate` answers an equal result |
| V4 | `evaluate` makes no Engine callback |
| V5 | unknown op is `invalid_input`; every error is `{code, message, retryable}` |

## Pack

| Member | Content |
|---|---|
| Validator `eventstorming-grammar` | inputs `model` and optional value `level`, `evaluator: {type: adapter, adapter: eventstorming/v1}`; a Gate per phase (unit 2) binds `level`, since `configuration` lives on the Validator (`14-gate.md`) and a Gate's `validators[]` carries inputs only |

## Rules

| Rule | Enforcer |
|---|---|
| content validates the kind schema | engine at publish |
| grammar findings as above; `passed` iff no error | Adapter |
| `version` other than `4.0` is `not-a-model`; a new grammar is a new kind version | schema (`const`), grammar |
| the grammar module and the Adapter answer the same findings the tool's `validate.py` answers for the tool's example models, errors and warnings alike | `test/tools/grammar.test.ts` over two ported models |

## Decisions

- DSL v4.0 kept verbatim except `meta.createdAt`: the revision carries time, and one truth means
  no second timestamp. The tool's Zod defaults (`meta.level`, the four arrays) are `required` here:
  the tool's exporter always writes them and a stored artifact has no reader that fills defaults, so
  the grammar carries none either. An old `.eventstorming.json` imports once with that key removed; JSON is
  YAML, so `persimmon create` reads it inside the envelope.
- The tool's camelCase context relationship names (`acl`, `customerSupplier`) stay in this kind;
  `BoundedContext` keeps its kebab enum. One grammar per kind, mapped by the derivation Task, so
  neither kind carries the other's spelling.
- Shape in the schema, rules in the grammar: JSON Schema `if/then` per node type would be ten
  blocks nobody reads, and the engine stops at the first schema error while an author needs every
  grammar finding at once.
- The grammar is `.mjs` with a `.d.ts`, like `adapters/lib/skills.mjs`: the Adapter runs without
  a build and the editor bundles the same file. No `src/` → `tools/` import.
- The evaluator is a shipped Adapter, not a pack script: a pack ships YAML only (`20-pack.md`), and
  an Adapter with the evaluator Role is what the conformance roadmap row waited for.
- `tools/` is the directory for human-facing web surfaces, one per tool, the pure model code
  beside the UI. The word collides with the Executor type `tool`; `CONTEXT.md` keeps both and
  flags it. Found in design review.
- `evaluate` answers `evidence: []`: the payload carries the model as `{content, provenance}`, and
  `provenance.inputs` are the model's inputs, not the model; the Validator's own input binding is the
  evidence the engine already holds. Found in implementation.
- The old tool is ported, not copied: its projects, autosave, snapshots and compare are the Store,
  revisions and two revisions here; import and export are `create` and `get`.

## Examples

- [`examples/ai-native-domain.yaml`](examples/ai-native-domain.yaml): `expense-claims-storming`, a
  big-picture model with three contexts, nine events, two alternative sets and one open hotspot
- `test/tools/*.json`: two of the tool's example models, the grammar's regression fixtures
