# Workbench Todo Index

Updated: 2026-09-03

This file is a discovery projection. Re-read the individual Todo before claiming or reviewing it.

Task status has only three values: `TODO`, `BLOCKED`, `DONE`.

`Assignee` is separate from task status:

- `待接取` — no Worker currently owns the task
- `<worker-name>` — that Worker conversation owns or most recently submitted the current attempt

## TODO

None.

## BLOCKED

| ID | Status | Assignee | Priority | Goal |
| --- | --- | --- | --- | --- |
| `RC-001` | `BLOCKED` | `待接取` | P0 | Obtain the exact failing Unit/integration test/assertion evidence for Recovery product snapshot `1e9d2ea...` without modifying product code. |

## DONE

None.

## Current queue rationale

`RC-001` is still unfinished, so it remains in the TodoList. It is marked `BLOCKED` because the previous Worker environment could neither obtain non-empty raw Actions test output nor perform exact-SHA local reproduction.

It is `待接取` because no Worker currently owns it. A future Worker may claim it only if its environment can satisfy the concrete Unblock condition documented in `TODO-RC-001.md`.

No product-fix Todo is queued until the exact failing assertion/expected/actual evidence exists.
