# TODO-RC-005

Status: `TODO`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

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

## Project Lead review — 2026-09-05

Verdict: **Needs more work; task is released for another attempt.**

Independent review findings:

- Worker patch `7378f36ec51850848783d4e36a3e1c29682b211d` changes only `tests/automation-native-executor-target-ui.test.ts`; no renderer/product behavior was changed.
- The patch correctly removes the obsolete literal `Execute Step ...` source regex and adds source-level checks for the Execute/Retry verb, exact Native Thread text, confirmation gate, failed-Attempt history wording, preflight, and `NATIVE_EXECUTOR_TARGET_CHANGED`.
- However the current test remains source-regex inspection. It does **not** prove two explicit acceptance criteria: cancellation produces zero dispatches, and a stable target produces exactly one dispatch.
- The Worker report records the required focused Node test as **NOT RUN**, so Required validation is not satisfied.
- The Worker originally created `REPORT-RC-005.md` on the repository default branch `codex/workbench-v1` (commit `3fc929477b0218bcbfbe932a1fa4cb9293aee5b3`) instead of the active task branch. Project Lead restored that exact report text to the active branch for durable review evidence; this does not convert NOT RUN into PASS.

Next attempt must add/adjust test-only coverage that actually proves cancellation/no-dispatch and stable-target/single-dispatch behavior, run the required focused test, and publish the report on `fix/v01-recovery-closure`.

## Attempt history

- Attempt 1 — `worker-904a`
  - claim commit: `b37c8846a3e07773702520dcfd15be2b21dd2020`
  - test patch: `7378f36ec51850848783d4e36a3e1c29682b211d`
  - Todo report pointer commit: `5c3e8446b2b05e524d8566e427c98dc3dd6dbb3e`
  - original report commit was accidentally written to default branch: `3fc929477b0218bcbfbe932a1fa4cb9293aee5b3`
  - Project Lead verdict: not accepted; required validation NOT RUN and behavior-level cancellation/single-dispatch acceptance not proven.

Fresh task originally created from external investigation finding B10.
