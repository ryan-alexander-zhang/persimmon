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

Sections 2 and 3 govern code changes to this repo. A product, domain or artifact-placement decision is governed by section 8, never by these.

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

## 8. First Principles in Review and Decisions

**Answer what is right for the business scenario. Cost of change is not a consideration.**

Applies to every review, audit, open-question decision and recommendation: a code review here, a
persimmon owner decision (`owner-decisions`, `owner-review`), an auditor's finding, a copilot
recommendation to the developer.

- Start from the scenario: what the product must do for the case at hand, which rule or
  invariant it rests on, where the defect or gap really is. The answer is the one that holds
  there, stated in the domain's own terms.
- The answer goes to the artifact or module that owns the thing, wherever that is. A wrong
  definition is changed where it is defined, whatever that reruns; the cost of the change is not
  an input to the decision, not a reason to keep a defect local, and not a reason to bend a lower
  artifact to fit.
- A finding names the root defect and the artifact that owns it, not the cheapest patch over the
  symptom; a defect only an upstream artifact can fix still names that artifact and the defect.
- Alternatives are ranked by how well each serves the scenario, and by nothing else. "No
  upstream change needed", "smaller diff" and "fewer reruns" are not reasons and are not said;
  what runs next because of the answer is reported after it, as sequencing, never as a weight.
- The test: would the answer be the same if every artifact were free to change? If not, it was
  chosen for cost, and it is the wrong recommendation.
- Settled decisions stay settled unless shown wrong; the "smallest change" when reopening one is
  the smallest *correct* change, never the cheapest.
