# Workbench Todo Index

Updated: 2026-09-05

This file is a discovery projection. Re-read the individual Todo before claiming or reviewing it.

Task status has only three values: `TODO`, `BLOCKED`, `DONE`.

## TODO

| ID | Status | Assignee | Priority | Goal |
| --- | --- | --- | --- | --- |
| RC-004 | TODO | 待接取 | P0 | Repair Recovery Closure fixture validity so five recovery tests reach their business assertions. |
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

A 2026-09-05 external Pro investigation over the archived coordination HEAD reproduced the full suite twice as `718 total / 712 pass / 6 fail`. Live Git compare proves every commit from validated product snapshot `1e9d2ea...` to coordination HEAD `aeabb459...` changes only documentation/coordination files, so the tested source/test files are content-equivalent to the historical exact product snapshot.

The six original failures now have two bounded test-contract explanations: B01 accounts for five Recovery Closure tests that fail during fixture setup before business assertions; B10 accounts for the separate Native executor target UI source-regex failure. RC-004 and RC-005 are therefore the only immediately claimable P0 tasks and may run in parallel.

After both are accepted, RC-006 re-establishes exact-SHA CI truth before product Recovery changes. Then RC-007 and RC-008 may run in parallel on non-overlapping primary ownership; RC-009, RC-010, and RC-011 serialize overlapping execution/Store changes. RC-012 is the post-fix deterministic CI gate. Only after RC-012 passes may the Project Lead create/unlock the frozen downstream sequence: crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression.

RC-002/RC-003 remain BLOCKED only for exact historical provenance; they no longer gate repair work because the new reproduction plus live source equivalence supplies enough bounded evidence to proceed. Investigation findings B05 (Retry policy semantic ambiguity), B06 (second Plan promotion), and B08 (same-process multi-Store audit race) are not inserted into the active Recovery Closure queue now: B05 needs a clear contract decision; B06 is not proven required by the frozen v0.1 Recovery gate; B08 is conditional and not proven on the standard single-Store product path. They remain evidence to revisit only if the frozen acceptance path or a later owner decision requires them.

Release status remains **IN PROGRESS / NOT RELEASE READY**.
