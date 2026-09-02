# Workbench Task Board

This is the current delegation index for the Project Lead. It is a coordination projection, not the Workbench product/workflow truth.

Current project state must be restored from `docs/workbench-map/CURRENT_CHECKPOINT.md`, its durable checkpoint, and live GitHub truth.

## Project Lead

Status: `ACTIVE`

Fixed role definition: `docs/workbench-coordination/PROJECT_LEAD.md`

## Current mainline

Workstream: follow `docs/workbench-map/CURRENT_CHECKPOINT.md`.

Do not duplicate fast-changing branch SHA / CI state here unless a delegated Task specifically depends on it. The Project Lead must verify live GitHub state before dispatch.

## READY

No delegated tasks yet.

## ASSIGNED / IN_PROGRESS

None.

## WAITING_REVIEW

None.

## BLOCKED

None.

## ACCEPTED

None.

## REJECTED / FOLLOW_UP_REQUIRED

None.

## Board rules

- The Project Lead owns board status changes.
- Each active item must point to exactly one `tasks/TASK-*.md` file.
- A Task ID is never reused for a different goal.
- Worker reports live under `reports/REPORT-<same-id>.md`.
- `COMPLETED` in a Worker report means ready for Project Lead review; it does not mean `ACCEPTED`.
- Keep detailed technical evidence in the Task/Report/GitHub, not in this board.
- Remove no historical accepted/rejected item merely to make the board shorter; archive later only under an explicit coordination maintenance change.
