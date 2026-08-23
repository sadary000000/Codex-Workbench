# ARCH-V2-7 Projection Rebuild Evidence

Test: `tests/arch-v2-7-review-harness.test.ts` — `projection can be deleted and rebuilt from an isolated Native read fixture without changing identity`.

Procedure:

1. Create a Project and Thread projection in a temporary `V1PersistenceStore`.
2. Keep the Native identity/cwd/project/title/state/turn fixture as the only rebuild input.
3. Remove the `threads` projection array in the isolated file.
4. Re-run `ensureThreadProjection()` with the same Native read facts.
5. Compare semantic projection fields and verify no PromptRecovery rows are fabricated.

Result: PASS. `nativeThreadId`, ownership, cwd, title, state and last turn remain equal. Native App Server truth is not modified. This is an isolated gate, not a claim that a full production `rebuildAllProjections` command exists.
