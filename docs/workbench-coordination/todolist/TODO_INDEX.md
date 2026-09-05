# Workbench Todo Index

Updated: 2026-09-05

This file is a discovery projection. Re-read the individual Todo before assigning or reviewing it.

Task status has only three values: `TODO`, `BLOCKED`, `DONE`.

The owner currently assigns work manually. Do not treat an unassigned Todo as permission for a Worker to self-claim work.

## TODO

| ID | Status | Assignee | Priority | Goal |
| --- | --- | --- | --- | --- |
| RC-005 | TODO | 待接取 | P0 | Repair Native executor target UI test to validate current Execute/Retry safety behavior. |

## BLOCKED

| ID | Status | Assignee | Priority | Goal |
| --- | --- | --- | --- | --- |
| RC-004 | BLOCKED | manual-chatgpt | P0 | Repair Recovery Closure fixture validity so five recovery tests reach their business assertions; implementation is committed, focused validation is still required. |
| RC-006 | BLOCKED | 待接取 | P0 | Re-establish exact-SHA CI baseline after RC-004/005 test-contract repair. |
| RC-007 | BLOCKED | 待接取 | P0 | Settle RECOVERY_REQUIRED ExecutionAttempt after provider truth is successfully reconciled. |
| RC-008 | BLOCKED | 待接取 | P0 | Permit safe read-only Reconcile when Native runtime is RECOVERY_REQUIRED but the existing Turn is readable. |
| RC-009 | BLOCKED | 待接取 | P0 | Preserve definitive pre-dispatch TURN_BUSY truth instead of recording unknown side effect. |
| RC-010 | BLOCKED | 待接取 | P0 | Close terminal-receipt to ExecutionAttempt crash window with deterministic local settlement. |
| RC-012 | BLOCKED | 待接取 | P0 | Run deterministic post-fix exact-SHA Typecheck + Unit/integration + Build CI gate. |
| RC-011 | BLOCKED | 待接取 | P1 | Clear stale StepRuntime terminalResult for new/non-terminal Attempts while preserving old history. |
| RC-002 | BLOCKED | 待接取 | P2 | Recover exact raw GitHub Actions failure output for historical run `33649460705`. |
| RC-003 | BLOCKED | 待接取 | P2 | Reproduce historical failure from an exact Git checkout of `1e9d2ea...` for provenance cross-check. |

## DONE

None.

## Current queue rationale

The owner has discontinued automatic Worker self-claim assignment; Todo files now remain the durable task/progress/acceptance record while the owner manually chooses who executes each task.

RC-004 was directly assigned to the current ChatGPT conversation. Implementation commit `992f22a24ad8c6a4e479812fb8c850e8ac6d4669` changes only `tests/v01-step-recovery-closure.test.ts` and repairs both known fixture-contract blockers: the invalid initial `currentStageId` foreign-key reference and the empty verification Evidence correlation. The owner-supplied Pro evidence had already shown that fixing the first blocker alone moves the focused file from 0/5 to 4/5 PASS, with the sole remaining failure being `EVIDENCE_CORRELATION_INVALID`; valid-Evidence catch-up also has a passing positive control.

RC-004 is nevertheless BLOCKED rather than DONE because its required focused Node 22 command has not actually executed against the patched commit. The current execution container has no Workbench checkout and cannot resolve `github.com`; the CI workflow does not auto-run on `fix/v01-recovery-closure`, and the available GitHub connector cannot create a new workflow-dispatch run. The exact unblock condition is recorded in the individual Todo and report. No validation PASS is fabricated.

RC-005 remains TODO after its first attempt was rejected: the required focused Node test was NOT RUN and behavior-level cancellation/no-dispatch plus stable-target/single-dispatch acceptance were not proven.

RC-006 remains blocked until RC-004 and RC-005 are independently accepted as DONE. Then the planned Recovery Closure route remains: exact-SHA CI rebaseline -> RC-007/RC-008 -> serialized RC-009/RC-010/RC-011 -> RC-012 deterministic CI -> frozen downstream E2E gates.

RC-002/RC-003 remain BLOCKED only for exact historical provenance and do not gate the bounded repair route. Investigation findings B05/B06/B08 remain outside the active Recovery Closure queue pending contract/scope justification.

Release status remains **IN PROGRESS / NOT RELEASE READY**.
