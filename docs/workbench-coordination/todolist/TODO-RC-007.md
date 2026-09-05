# TODO-RC-007

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Close the Recovery liveness bug where a provider result is successfully reconciled but an ExecutionAttempt already in `RECOVERY_REQUIRED` never settles to the recovered terminal truth.

## Evidence

External investigation finding B02 reproduced lost-submit-ack recovery with persisted correlation. Provider receipt / ActionAttempt / ActionIntent settle, but `settleObservation()` advances the ExecutionAttempt only when its current lifecycle is `RUNNING`; the exact code path leaves `RECOVERY_REQUIRED` unchanged. The execution state machine also has no terminal exit from `RECOVERY_REQUIRED`.

## Dependencies

- RC-006 must be `DONE` so the repaired tests establish the new deterministic baseline first.

## Allowed scope

- `src/automation/step-execution-service.ts`
- `src/automation/state-machine.ts` only if required by the smallest valid lifecycle correction
- narrowly related Store transition code if required
- a new dedicated regression test file for recovered ExecutionAttempt settlement

## Forbidden scope

- No second Recovery runtime/state machine.
- No blind resend after unknown external outcome.
- No deletion/rewriting of failed prior Attempt history.
- No fabricated Evidence.

## Write ownership

Product files above plus one uniquely named new regression test and this Todo/report only.

## Acceptance criteria

- Start from the real unknown-submit path that reaches `UNCERTAIN/RECOVERY_REQUIRED`, not a hand-constructed RUNNING Attempt.
- Reattach/reconcile an existing Native request by durable correlation without starting a duplicate Turn.
- Recovered COMPLETED truth settles the ExecutionAttempt and StepRuntime into the correct next verification state.
- Recovered FAILED truth settles into the correct failed/recovery-governed state.
- Repeating Reconcile is idempotent and does not create a new Native Turn, receipt, or Attempt.
- `Reconcile before repeat` remains enforced for uncertain side effects.

## Required validation

Run the dedicated regression tests plus the repaired Recovery Closure test file. Record Native start-count/idempotency assertions.

## Blocker / Unblock condition

Blocker: deterministic baseline after test-contract repair is not yet established.

Unblock condition: RC-006 is `DONE`.

## Attempt history

Fresh product-fix task from external investigation finding B02.
