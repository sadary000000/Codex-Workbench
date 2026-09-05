# Workbench Todo Index

Updated: 2026-09-05

This file is a discovery projection. Re-read the individual Todo before claiming or reviewing it.

Task status has only three values: `TODO`, `BLOCKED`, `DONE`.

## TODO

| ID | Status | Assignee | Priority | Goal |
| --- | --- | --- | --- | --- |
| RC-004 | TODO | worker-v6 | P0 | Repair Recovery Closure fixture validity so five recovery tests reach their business assertions. |
| RC-005 | TODO | 待接取 | P0 | Repair Native executor target UI test to validate current Execute/Retry safety behavior. |

## BLOCKED

| ID | Status | Assignee | Priority | Goal |
| --- | --- | --- | --- | --- |
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

A 2026-09-05 external Pro investigation over the archived coordination HEAD reproduced the full suite twice as `718 total / 712 pass / 6 fail`. Live Git compare proved every commit from validated product snapshot `1e9d2ea...` to coordination HEAD `aeabb459...` changed only documentation/coordination files, so the tested source/test files were content-equivalent to the historical exact product snapshot.

RC-004 is currently claimed by `worker-v6` and has no submitted report yet, so it is not reviewable. RC-005 Attempt 1 by `worker-904a` was independently reviewed and **not accepted**: its patch correctly updated obsolete source-regex assertions without changing product renderer code, but the required focused Node test was NOT RUN and the patch did not prove cancellation causes zero dispatches or that a stable target dispatches exactly once. RC-005 is therefore released as `TODO / 待接取` for another bounded attempt.

The RC-005 Worker also wrote its original report commit to the repository default branch instead of the active task branch. Project Lead restored the same report text to the active branch solely as durable review evidence; the active Todo now clears `Latest report` for the next attempt. The stray default-branch report is not acceptance evidence for the active queue.

RC-006 remains blocked until both RC-004 and RC-005 are independently accepted as DONE. Then the planned route remains: exact-SHA CI rebaseline -> RC-007/RC-008 -> serialized RC-009/RC-010/RC-011 -> RC-012 deterministic CI -> frozen downstream E2E gates.

RC-002/RC-003 remain BLOCKED only for exact historical provenance and do not gate the bounded repair route. Investigation findings B05/B06/B08 remain outside the active Recovery Closure queue pending contract/scope justification.

Release status remains **IN PROGRESS / NOT RELEASE READY**.
