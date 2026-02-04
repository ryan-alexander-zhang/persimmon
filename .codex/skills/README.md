# Repo-local Codex Skills

All repo-local skills live under `.codex/skills/<skill-name>/SKILL.md`.

Start here:
- `scaffold-router`: decides module/package/skill based on path + intent
- `scaffold-architecture-guardrails`: layer rules, conventions, testing strategy

Generator skill standard:
- `.codex/skills/GENERATOR_SKILL_STRUCTURE.md`
- `.codex/skills/VARIABLES.md`

Infra generators aligned to `package-info.java`:
- `infra-bc-repository-generator` (BC-first write-side repositories: `infra.repository.<bc>.*`)
- `infra-bc-query-generator` (BC-first read-side/CQRS queries: `infra.query.<bc>.*`)
- `infra-system-gateway-generator` (system-first external integrations: `infra.gateway.<system>.*`)

Start generators:
- `start-yaml-config-generator` (YAML keys + wiring synchronization)
