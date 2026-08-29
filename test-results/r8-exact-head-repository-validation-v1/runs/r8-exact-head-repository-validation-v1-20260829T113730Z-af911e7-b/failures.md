# Failures

The exact target was valid and reproducible, but the full test gate failed deterministically.

- Command: `npm test`
- Result: 566 passed, 1 failed
- Failing test: `tests\workspace-layout-contract.test.ts:10:1`
- Test name: `workspace layout keeps the conversation container separate from the composer`
- Assertion: `workspace conversation shell must close`
- No retry was performed.

The result is scoped only to the exact tested commit; no source/test fix was applied during validation.
