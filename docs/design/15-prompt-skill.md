# Prompt and Skill

status: active · layer: 1 · schema: [`schemas/prompt-skill.yaml`](schemas/prompt-skill.yaml)

Two pure-data Definition kinds referenced from `Task.action.context`. The engine stores and
freezes them; Adapters interpret them.

```text
Task.action.context
  ├─ {kind: prompt, ref} ─▶ Prompt {mediaType, content} ─▶ frozen in the snapshot ─▶ resolved {kind, name, mediaType, content, digest}
  └─ {kind: skill,  ref} ─▶ Skill {source, digest, format} ─▶ frozen in the snapshot ─▶ resolved {kind, name, source, digest, format}
                                                                                            │ skill install fetches source; Adapter verifies digest
```

Resolved entries are written to `TaskRun.status.context` and sent in the execute payload
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
| `digest` | `sha256:` over the bundle bytes, as `persimmon digest` computes them |
| `format` | `<name>/v<n>`; must appear in the Adapter's `describe.skillFormats` |

The engine never fetches or interprets a bundle.

## Rules

| Rule | Enforcer |
|---|---|
| field shapes: `mediaType`, `content`, `source.version`, `digest`, `format` | schema |
| `persimmon skill install` fetches `source` at `version`; the Adapter hashes the installed bundle at attempt start and verifies `digest`; mismatch fails the attempt with `skill_digest_mismatch`, not retryable | CLI, Adapter (`19-adapter-roles.md`) |
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
- Bundle digest for a directory, as the shipped agent Adapters compute it (fetch moved to `skill install`): sha256 over every
  regular file in sorted posix-path order, each fed as `<path>\0<bytes>\0`, `.git` excluded.
  `git` sources are fetched once per (remote, version) into `.persimmon/skills/<hash>`; `file`
  sources resolve `locator.path` against the engine cwd and, once verified, are copied into
  `.persimmon/skills/file-<digest16>`, so the agent reads the bytes that matched the digest. A bundle holding anything but regular
  files and directories is refused; `locator.remote` is an https, ssh, git or file URL, an
  scp-style address or an absolute path, `version` a commit or ref name, so git never reads an
  option or an `ext::` transport from a Skill. Closes reference open question 3. Found in
  implementation.
- A Skill is installed into a workspace once and stays: `persimmon skill install <name> --into <dir>`
  fetches into the cache, verifies the digest and copies the bundle to `<dir>/.agents/skills/<name>`
  and `<dir>/.claude/skills/<name>`, where codex and claude discover their own skills. A Task still
  declares the Skills it needs as context; at attempt start the Adapter finds each declared one in
  the workspace, hashes it and compares to the declared digest: missing or different fails the
  attempt and names the install command. Other skills present in the workspace are allowed and
  logged as unmanaged. Declared in YAML, verified before the run, recorded on the TaskRun; the
  files persist and every agent in the workspace sees them, humans too. A per-attempt link was
  tried first and dropped: churn for nothing, and skills are conventions, not secrets. Found in UAT.
- `persimmon digest <dir>` prints the bundle digest, so a Skill can be declared for a local
  directory without computing sha256 by hand; the CLI and the Adapters share the algorithm by
  test. Found in UAT.
- A `file` Skill is cached by digest like a `git` one: the source directory is verified, then
  copied; an edit to the source after the digest was declared fails the next `skill install`, an
  edit to the installed copy fails the next attempt, instead of reaching the agent unpinned. Found in UAT.

## Examples

- [`examples/prompt-write-prd-template.yaml`](examples/prompt-write-prd-template.yaml);
  validates against `#/$defs/Prompt`; frozen in `snapshot-closure.yaml`
- [`examples/skill-prd-writer.yaml`](examples/skill-prd-writer.yaml); validates against
  `#/$defs/Skill`; frozen in `snapshot-closure.yaml`
- [`examples/kind-definition-prompt.yaml`](examples/kind-definition-prompt.yaml): pure-data
  KindDefinition, no `handlerRef`
