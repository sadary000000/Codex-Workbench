# TODO-RC-009

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Preserve definitive pre-dispatch truth for `TURN_BUSY` so a request that was never sent does not enter unknown-side-effect Recovery and an unresolvable Reconcile loop.

## Evidence

External investigation finding B04 shows `NativeThreadRuntime.startTurnAccepted()` throws `TURN_BUSY` before `dispatchStarted` and before `client.request("turn/start", ...)`, while `isDefinitivePreDispatchError()` does not classify `TURN_BUSY`; Step execution therefore records unknown submit and `RECOVERY_REQUIRED` despite zero external requests.

## Dependencies

- RC-007 must be `DONE`.
- RC-008 must be `DONE`.

These dependencies serialize overlapping Recovery/Native execution changes before this classification fix.

## Allowed scope

- `src/automation/step-execution-service.ts`
- narrow Native provider/runtime error typing needed to carry reliable pre-dispatch provenance
- dedicated TURN_BUSY regression tests

## Forbidden scope

- Do not classify transport timeout, accepted-request loss, or genuinely uncertain external outcomes as definitive failure.
- No automatic background retry.
- No blind resend.

## Write ownership

Only the smallest execution/provider provenance files needed, one dedicated test, this Todo, and its report.

## Acceptance criteria

- A real pre-dispatch TURN_BUSY produces zero provider `turn/start` requests and is stored/returned as definitive not-dispatched failure rather than unknown external outcome.
- Once the Thread is ready, the normal governed new-attempt path can be used safely.
- An accepted request with lost acknowledgement remains unknown and still requires Reconcile before any repeat.
- No existing uncertain-side-effect safety is weakened.

## Required validation

Run paired regressions for (1) TURN_BUSY before dispatch and (2) accepted/lost-ack uncertainty, asserting provider request counts and persisted outcome certainty.

## Blocker / Unblock condition

Blocker: RC-007 and RC-008 touch adjacent execution/recovery surfaces and must be accepted first.

Unblock condition: RC-007 and RC-008 are both `DONE`.

## Attempt history

Fresh product-fix task from external investigation finding B04.
