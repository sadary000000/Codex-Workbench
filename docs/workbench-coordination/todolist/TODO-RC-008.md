# TODO-RC-008

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Allow safe read-only Reconcile of an already-started Native Turn when completion notification/transport failure puts the Native runtime in `RECOVERY_REQUIRED`, without making new submission operations available.

## Evidence

External investigation finding B03 reproduced a completed Turn that remained readable after notification timeout. `runtimeCapability()` currently marks every attached runtime in `RECOVERY_REQUIRED` as unavailable, and Native provider `reconcile()` rejects on that capability before `reconcileTurn()` can read the known Turn.

## Dependencies

- RC-006 must be `DONE`.

## Allowed scope

- `src/main/native-provider-runtime-adapter.ts`
- `src/codex/automation/native-provider-port.ts`
- `src/automation/provider-policy-authority.ts` only if operation-scoped authorization requires it
- dedicated regression tests for read-only recovery capability

## Forbidden scope

- Do not globally mark `RECOVERY_REQUIRED` as safe for new PROMPT/RETRY/SIDE_EFFECT submissions.
- Do not bypass provider authorization or correlation validation.
- Do not create an alternate Native runtime.

## Write ownership

Only the listed product files, one uniquely named regression test, this Todo, and its report.

## Acceptance criteria

- After completion-notification timeout, an existing Turn that can still be read may be Reconciled through the normal provider path.
- The same state still blocks unsafe new submissions unless the runtime is actually ready for them.
- Truly unreadable/disconnected targets remain safely blocked.
- Reconcile does not start a second Native Turn.
- Existing authorization/proof and target identity checks remain effective.

## Required validation

Use a real NativeThreadRuntime-style regression with timeout followed by readable completed Turn; assert read count/progress and Native start count.

## Blocker / Unblock condition

Blocker: deterministic baseline after test-contract repair is not yet established.

Unblock condition: RC-006 is `DONE`.

## Attempt history

Fresh product-fix task from external investigation finding B03.
