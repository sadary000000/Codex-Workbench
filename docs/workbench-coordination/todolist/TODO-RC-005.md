# TODO-RC-005

Status: `TODO`
Assignee: `worker-904a`
Priority: `P0`
Latest report: `docs/workbench-coordination/reports/REPORT-RC-005.md`

## Goal

Repair the Native executor target UI regression test so it validates the current Execute/Retry confirmation and exact-target safety contract instead of matching an obsolete source literal.

## Evidence

The sixth reproducible full-suite failure is `tests/automation-native-executor-target-ui.test.ts`. The test expects a literal `Execute Step ${step.stepKey}...`, while live product code intentionally computes `verb = retrying ? "Retry" : "Execute"` and interpolates `${verb}` into the confirmation. Exact target preflight and `NATIVE_EXECUTOR_TARGET_CHANGED` blocking remain present in product code.

## Dependencies

None. May run in parallel with RC-004.

## Allowed scope

- Modify `tests/automation-native-executor-target-ui.test.ts` and test-only helpers.
- Prefer behavior-oriented assertions for Execute and Retry confirmation/preflight semantics.
- Read renderer code to preserve the exact Native target safety contract.

## Forbidden scope

- No renderer/product behavior changes merely to satisfy the old regex.
- No removal of explicit confirmation, exact-target preflight, or identity-change blocking.
- No assertion weakening to an arbitrary string match.

## Write ownership

- `tests/automation-native-executor-target-ui.test.ts`
- `docs/workbench-coordination/todolist/TODO-RC-005.md`
- `docs/workbench-coordination/reports/REPORT-RC-005.md`

## Acceptance criteria

- Fresh Execute confirmation is still proven to name the exact selected Native Thread.
- Retry confirmation is proven to use Retry semantics while preserving failed-attempt history messaging.
- Cancellation does not dispatch.
- Target identity change before dispatch still blocks with `NATIVE_EXECUTOR_TARGET_CHANGED`.
- Stable target dispatches exactly once.
- Product renderer code is unchanged unless a separate behavior bug is proven and routed to a different Todo.

## Required validation

- Run `node --experimental-strip-types --test tests/automation-native-executor-target-ui.test.ts`.
- Record exact result in the report.

## Blocker / Unblock condition

None known.

## Attempt history

Fresh task created from external investigation finding B10.
