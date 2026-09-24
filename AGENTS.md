# Guidelines 
## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Reuse before build, in this order: this repo, the framework or starters,
  present dependencies, a maintained open-source library. Build only when none
  fits; record why in a `decision`.
- Every new dependency is a `decision`: what it supplies, what was compared,
  why it won.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Language Consistency

**Use one canonical term for one concept.**

- `CONTEXT.md` is the glossary; create it from `CONTEXT_TEMPLATE.md` if absent.
- A term conflicting with `CONTEXT.md`: stop, resolve, then continue.
- Vague or overloaded language: propose one precise term, test it against concrete scenarios.
- Stated behavior conflicting with code or docs: call out the mismatch.
- Update `CONTEXT.md` as soon as a term is resolved. Glossary only: no implementation, specs, or decisions.


## 6. Design Map

- `DESIGN.md` indexes `docs/design/`; every design file is listed there with its status.
- `ARCHITECTURE.md` maps `src/` to design files; a new directory is added there first.

## 7. Small Commits

**One verified unit, one commit. Commit it yourself.**

- A unit is one function, one module, one test, one behavior change, or one design decision.
- Verify first: tests pass, examples validate, or the check named in the plan step holds.
- Commit right after verification. Do not batch units; do not wait to be asked.
- Conventional Commits header: `<type>(<scope>): <summary>`; body states why, not what.
- Never mix a rule change with the work it governs; land the rule first.
