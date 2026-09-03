# Workbench Task Board

This legacy board remains as a compatibility pointer. The active task queue is now:

`docs/workbench-coordination/todolist/`

Individual `todolist/TODO-*.md` files are authoritative for claim/status; `todolist/TODO_INDEX.md` is the discovery projection. Product/runtime/validation truth still comes from live Git/source/CI plus the current durable checkpoint.

## Project Lead

Status: `ACTIVE`

Fixed role definition: `docs/workbench-coordination/PROJECT_LEAD.md`

## Current mainline

Frozen workstream: **v0.1 Recovery Closure**. Follow `docs/workbench-map/CURRENT_CHECKPOINT.md` and live Git/CI.

## READY

- `RC-001` — P0 — read-only investigation to identify the exact reproducible Unit/integration failure on product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`.

## IN_PROGRESS

None.

## WAITING_REVIEW

None.

## BLOCKED

None.

## ACCEPTED / FOLLOW_UP_REQUIRED

None.

## Board rules

- Use the TodoList for all new claim/review/dispatch state.
- Worker reports live under `reports/REPORT-<same-id>.md`.
- Worker completion never implies Project Lead acceptance.
- Do not duplicate volatile branch/CI truth here beyond what a queued task needs.
