# TODO-RC-010

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Make terminal provider receipts and the corresponding ExecutionAttempt/StepRuntime settlement crash-safe so a restart can consume already-persisted terminal truth locally without requiring the provider again.

## Evidence

External investigation finding B07 injected a failure after terminal receipt persistence but before ExecutionAttempt transition. On restart, receipt/Action state remained terminal while ExecutionAttempt/StepRuntime remained RUNNING. Current deterministic catch-up handles verification/review Evidence stages, not this earlier receipt-to-attempt gap.

## Dependencies

- RC-009 must be `DONE`.

## Allowed scope

- `src/automation/step-execution-service.ts`
- `src/automation/provider-v4-neutral-store.ts`
- `src/automation/store.ts`
- `src/automation/deterministic-recovery-catch-up.ts` only if local catch-up is the smallest correct route
- dedicated crash-boundary regression tests

## Forbidden scope

- Never treat UNKNOWN receipt as success/failure.
- No fabricated verification/review Evidence.
- No provider resend to repair an already-terminal local receipt.
- No destructive rewrite of existing Action/Attempt history.

## Write ownership

Only the minimum listed product files, one dedicated regression test, this Todo, and its report.

## Acceptance criteria

- Success and failure terminal receipts survive the crash boundary and deterministically settle the matching ExecutionAttempt/StepRuntime after restart.
- Local settlement validates exact ActionAttempt/request/project/step correlation.
- Provider may be unavailable during local repair.
- Repeated catch-up/reconcile is idempotent and creates no new Turn, receipt, Attempt, or Evidence.
- UNKNOWN/ambiguous receipt remains unresolved and governed by Recovery instead of being guessed.

## Required validation

Run success/failure crash-boundary tests with close/reopen of the real temporary SQLite Store and provider unavailable after restart.

## Blocker / Unblock condition

Blocker: overlapping execution-path fixes in RC-009 must land first.

Unblock condition: RC-009 is `DONE`.

## Attempt history

Fresh product-fix task from external investigation finding B07.
