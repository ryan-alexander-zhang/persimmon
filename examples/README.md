# Examples

Each directory is one persimmon project that teaches one scenario. Run the CLI inside it;
`persimmon init` generates `.persimmon/` and `persimmon.yaml` there, both ignored by git.
Every example has a `README.md` with the steps, the expected output and how to reset.

| Example | Scenario | Agents |
|---|---|---|
| [`example01/`](example01/) | idea to PRD: agent research, PRD in a template (Summary plus EARS features), agent review, P0 fix, your approval | codex `gpt-6-sol`, claude `claude-sonnet-5` |
| [`example02/`](example02/) | spec to tested code: agent implements, a Gate checks coverage by script and acceptance criteria by agent, rejected rounds loop back with findings, HTML test report | codex `gpt-6-sol`, claude `claude-sonnet-5`, a script |
| [`example03/`](example03/) | event-driven release chain: an artifact published by hand fires a Trigger, the run's finish fires the next; pausing, origins, the self-trigger rules | two scripts, no agents |
| [`example04/`](example04/) | your own SDLC: three templates you edit (idea, spec with EARS and GWT, report), approval at the terminal, code behind a Gate where codex verifies every GWT criterion has a real test, verification report | claude `claude-sonnet-5`, codex `gpt-6-sol`, a script |
