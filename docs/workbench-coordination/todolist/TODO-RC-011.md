# TODO-RC-011

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P1`
Latest report: `none`

## Goal

Clear stale `StepRuntime.terminalResult` when a new ExecutionAttempt becomes current and throughout non-terminal lifecycle states, while preserving the prior Attempt's terminal history.

## Evidence

External investigation finding B09 confirmed that `createExecutionAttempt()` creates the new Attempt with `terminalResult: null` but replaces StepRuntime by spreading the old runtime and changing only `currentAttemptId/revision/updatedAt`. A failed Attempt followed by a successful Retry can therefore expose `VERIFYING / FAILED` and `REVIEWING / FAILED` until final review overwrites the result.

## Dependencies

- RC-010 must be `DONE` to avoid concurrent Store/recovery writes.

## Allowed scope

- `src/automation/store.ts`
- narrowly related lifecycle transition code if required
- dedicated stale-terminalResult regression tests

## Forbidden scope

- Do not delete or rewrite the failed prior ExecutionAttempt.
- Do not set a new terminal result before the new Attempt actually reaches terminal state.
- Do not broaden lifecycle semantics beyond the stale-field correction.

## Write ownership

Only the listed Store/lifecycle file(s), one dedicated regression test, this Todo, and its report.

## Acceptance criteria

- Binding a new current Attempt clears StepRuntime terminalResult.
- START/RUNNING/VERIFYING/REVIEWING for the new Attempt keep terminalResult null.
- Prior failed Attempt retains its original terminalResult and timestamps.
- Final completion/failure of the new Attempt sets only the new current terminal result.
- Persistence/restart at each active stage preserves the same invariant.

## Required validation

Run a failed Attempt #1 -> Retry Attempt #2 regression across create/start/verify/review and at least one database reopen boundary.

## Blocker / Unblock condition

Blocker: RC-010 owns overlapping Store/recovery settlement work.

Unblock condition: RC-010 is `DONE`.

## Attempt history

Fresh product-fix task from external investigation finding B09. The finding is confirmed but is not treated as the original six-test CI root cause.
