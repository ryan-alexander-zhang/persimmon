# Prompt and Skill

status: draft · layer: 1 · schema: [`schemas/prompt-skill.yaml`](schemas/prompt-skill.yaml)

Two pure-data Definition kinds referenced from `Task.action.context`. The engine stores and
freezes them; Adapters interpret them.

```text
Task.action.context
  ├─ {kind: prompt, ref} ─▶ Prompt {mediaType, content} ─▶ frozen in the snapshot ─▶ resolved {kind, name, mediaType, content, digest}
  └─ {kind: skill,  ref} ─▶ Skill {source, digest, format} ─▶ frozen in the snapshot ─▶ resolved {kind, name, source, digest, format}
                                                                                            │ Adapter fetches source, verifies digest
```

Resolved entries are written to `TaskRun.spec.context` and sent in the execute payload
(`17-runs.md`, `19-adapter-roles.md`). After resolution `name` is a label; the snapshot
already picked the Namespaced or Global Resource.

## Prompt

| Field | Rule |
|---|---|
| `mediaType` | `text/<subtype>`, lowercase, no parameters |
| `content` | text; opaque to the engine; no templating; no size bound, and every snapshot and execute payload carries it |

`digest` in the resolved entry is `sha256:` over the UTF-8 bytes of the frozen `content`,
computed by the engine at context resolution.

## Skill

| Field | Rule |
|---|---|
| `source` | ExternalResourceRef with `version` required (`00-resource.md`); `provider` open |
| `digest` | `sha256:` over the bundle bytes as the Adapter fetches them |
| `format` | `<name>/v<n>`; must appear in the Adapter's `describe.skillFormats` |

The engine never fetches or interprets a bundle.

## Rules

| Rule | Enforcer |
|---|---|
| field shapes: `mediaType`, `content`, `source.version`, `digest`, `format` | schema |
| Adapter fetches `source` at `version` and verifies `digest` before use; mismatch fails the attempt with `skill_digest_mismatch`, not retryable | Adapter (`19-adapter-roles.md`) |
| `format` ∈ the referencing Task's adapter `skillFormats` | static checker on the Task (`12-task.md`) |
| the Executor's `security.allowedHosts` admits the `source` host | operator; not checked |
| Prompt and Skill are `SpecMutable`, `snapshot: Definition`, `scope: Any`, no `handlerRef` | KindDefinition |

## Decisions

- No Skill handler and no engine-side digest check. Reference had a `skill` handler that
  verified when reachable; one verifier, the Adapter, means one algorithm. Reference open
  question 3 (Git tree digest) is the Adapter's contract.
- Prompt `mediaType` restricted to `text/*`; delivered in the resolved entry. Reference
  allowed any and did not deliver it.
- Skill `format` grammar is `<name>/v<n>`, like Adapter ids.
- `source.provider` is open. Reference listed `git | oci | https | file`.
- New Layer 1 code: `skill_digest_mismatch`.

## Examples

- [`examples/prompt-write-prd-template.yaml`](examples/prompt-write-prd-template.yaml);
  validates against `#/$defs/Prompt`; frozen in `snapshot-closure.yaml`
- [`examples/skill-prd-writer.yaml`](examples/skill-prd-writer.yaml); validates against
  `#/$defs/Skill`; frozen in `snapshot-closure.yaml`
- [`examples/kind-definition-prompt.yaml`](examples/kind-definition-prompt.yaml): pure-data
  KindDefinition, no `handlerRef`
