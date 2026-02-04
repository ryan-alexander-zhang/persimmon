# Generator Skill Structure (Repo Standard)

This repository prefers generator skills to be *actionable*: they should be sufficient for a model
to produce consistent code that matches existing module/package conventions.

## Required sections for generator skills

1) **Use For**
- The exact artifact types and the module(s)/package(s) it targets.

2) **Inputs Required**
- The minimum questions/parameters the user must provide (or the skill must ask for), e.g.:
  - module + target package
  - name(s) (class/table/config key)
  - status machine + retry semantics
  - unit vs integration test requirement

3) **Outputs**
- The expected file list (paths) the generator should create/update.

4) **Naming & Packaging**
- Suffix/prefix conventions and which package roots are allowed.
- BC-first / system-first guidance as per `package-info.java`.

5) **Implementation Rules**
- Technology constraints and patterns:
  - allowed dependencies/annotations (per module)
  - transaction rules
  - concurrency/locking predicates (status + lease + lock owner)
  - idempotency and retry classification
  - migration constraints (no foreign keys)

6) **Reference Implementations**
- Point to existing files in this repo that should be copied/modified instead of reinvented.

7) **Tests**
- Which tests to add and what to validate.
  - `*Test` vs `*IT` conventions.

8) **Pitfalls**
- Common mistakes for that artifact type in this codebase.

## Optional sections (recommended when relevant)
- **Code Templates**: short snippets or a skeleton file tree; prefer referencing existing code.
- **Config Keys**: recommended YAML keys and where they belong (`start` module).
- **Verification Commands**: minimal commands to run.

