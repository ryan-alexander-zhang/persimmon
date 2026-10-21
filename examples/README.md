# Examples

Each directory is one persimmon project that teaches one scenario. Run the CLI inside it;
`persimmon init` generates `.persimmon/`, `persimmon.yaml`, `AGENTS.md`, a `CLAUDE.md` link to it and
a `.gitignore` there, all ignored by the checkout's git.
Every example has a `README.md` with the steps, the expected output and how to reset.

| Example | Scenario | Agents |
|---|---|---|
| [`example01/`](example01/) | idea to PRD: agent research, PRD in a template (Summary plus EARS features), agent review, P0 fix, your approval | codex `gpt-6-sol`, claude `claude-sonnet-5` |
| [`example02/`](example02/) | spec to tested code: agent implements, a Gate checks coverage by script and acceptance criteria by agent, rejected rounds loop back with findings, HTML test report | codex `gpt-6-sol`, claude `claude-sonnet-5`, a script |
| [`example03/`](example03/) | event-driven release chain: an artifact published by hand fires a Trigger, the run's finish fires the next; pausing, origins, the self-trigger rules | two scripts, no agents |
| [`example04/`](example04/) | your own SDLC: three templates you edit (idea, spec with EARS and GWT, report), approval at the terminal, code behind a Gate where codex verifies every GWT criterion has a real test, verification report | claude `claude-sonnet-5`, codex `gpt-6-sol`, a script |
| [`example05/`](example05/) | PRD hardened by debate: two reviewers (claude, codex) read the same PRD in parallel, the author judges every finding true or false and fixes the true ones, rounds repeat until clean | claude `claude-sonnet-5`, codex `gpt-6-sol` |
| [`example06/`](example06/) | example05 as composition kinds: a `ReviewLoop` (author produces, an `Approval` of two agent reviewers judges, verdict and last PRD fed back) inside a `Pipeline` that ends with your sign-off `Approval`; no Workflow, Gate or Validator written by hand | claude `claude-sonnet-5`, codex `gpt-6-sol` |
| [`example07/`](example07/) | the SDLC pack from a brief to code: Prd, domain discovery, Architecture, a Spec per capability, Designs, Plans, a human at every Gate; then one Plan built into a starter app whose old red test the builder reports as a defect, investigated as an Issue | claude `claude-sonnet-5` |
| [`example08/`](example08/) | the SDLC pack over two bounded contexts, brief to Plan: two subdomains, the storming cuts the contexts, one set of rules tagged by subdomain | claude `claude-sonnet-5` |
| [`example09/`](example09/) | test levels by language: one claims app in JavaScript, Java and Go, each with unit, integration (Testcontainers), api (Bruno) and e2e (Playwright) levels and coverage and mutation minimums; `build-all` selects each round by the Change set and reruns every level after the last task | none: you build and audit |
| [`example10/`](example10/) | an existing system analyzed, not rewritten: example09's three apps as a directory of checkouts, the Rewrite pack's survey, inventory, recovered Prd and rules with your Dispositions, then the storming and the domain kinds; the run order stopped at the domain model | claude `claude-sonnet-5` |
