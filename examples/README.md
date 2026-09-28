# Examples

Each directory is one persimmon project that teaches one scenario. Run the CLI inside it;
`persimmon init` generates `.persimmon/` and `persimmon.yaml` there, both ignored by git.
Every example has a `README.md` with the steps, the expected output and how to reset.

| Example | Scenario | Agents |
|---|---|---|
| [`example01/`](example01/) | idea to PRD: agent research, PRD in a template (Summary plus EARS features), agent review, P0 fix, your approval | codex `gpt-6-sol`, claude `claude-sonnet-5` |
| [`example02/`](example02/) | spec to tested code: agent implements, a Gate checks coverage by script and acceptance criteria by agent, rejected rounds loop back with findings, HTML test report | codex `gpt-6-sol`, claude `claude-sonnet-5`, a script |
