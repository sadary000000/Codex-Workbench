# ARCH-V2-7 PromptRecovery Evidence

## Before

V1 `PromptRecovery` persisted bounded raw Prompt text in `workbench-state.json`, which made it too easy to treat the local recovery record as a second conversation truth.

## After

The canonical persisted record contains:

- `localRunId`
- `nativeThreadId`
- `turnId`
- `promptSha256`
- `promptLength`
- opaque `promptRef` (currently nullable)
- status/timestamps/lastError

The raw Prompt is accepted only in the `beginPrompt()` call and retained in an in-memory compatibility map for the current process, so existing UI/error-retention APIs do not regress. A reopened store exposes no raw Prompt. Recovery uses Native Thread/Turn/Item and persisted correlation/status, never raw Prompt replay.

Evidence: `tests/arch-v2-7-prompt-recovery.test.ts` verifies the file has no raw test Prompt, has the hash/length, and that a reopened store has no Prompt field.
