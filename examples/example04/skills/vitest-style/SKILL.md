---
name: vitest-style
description: How tests are written in this workspace. Use when writing or changing any test under test/.
---

# vitest-style

One test per acceptance criterion, in `test/*.test.mjs`, named with the AC id first:

```js
test('F1-AC1 counts words in a file', async () => { ... })
```

Given, When, Then map to three blocks, in that order, separated by a blank line:

- Given: build the starting state in a temporary directory (`mkdtempSync`), never in the workspace.
- When: run the exact command the AC names with `spawnSync(process.execPath, ['src/cli.mjs', ...])`.
  A criterion about a command is verified by running the command, not by calling a function.
- Then: assert the exact output text, exit code or file content the AC states. `toBe`, not `toMatch`,
  when the AC gives exact text.

No shared mutable state between tests. No `beforeEach` that hides the Given. Clean the temporary
directory in `afterEach`.
