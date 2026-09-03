# Workbench Todo Index

Updated: 2026-09-04

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
| RC-002 | BLOCKED | 待接取 | P0 | Recover exact raw CI failing-test/assertion evidence for product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`. |
| RC-003 | BLOCKED | 待接取 | P0 | Reproduce the exact-SHA Unit/integration failure in a clean dependency-ready environment and capture the failing assertion locally. |

## DONE

None.

## Current queue rationale

The fresh queue exposes two independent P0 evidence-producing routes for the same reproducible Unit/integration failure: CI-side raw failure recovery (`RC-002`) and clean exact-SHA local reproduction (`RC-003`). Both are currently BLOCKED under the known Project Lead environment, but a Worker may claim either task if its environment can realistically satisfy that task's documented unblock condition. They may run in parallel and neither depends on the other.

No speculative product-fix Todo is created until at least one route produces the exact failing test/assertion evidence. Crash/restart Recovery E2E, authenticated Source Real E2E, Windows packaged Real E2E, and final regression remain downstream validation gates rather than currently executable Todos. The active v0.1 Recovery Closure remains in progress and is not release-ready.
