# TODO-RC-012

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Run deterministic exact-SHA CI after the bounded Recovery runtime fixes and establish whether the Recovery Closure line is eligible to proceed to crash/restart E2E.

## Dependencies

- RC-007 must be `DONE`.
- RC-008 must be `DONE`.
- RC-009 must be `DONE`.
- RC-010 must be `DONE`.
- RC-011 must be `DONE`.

## Allowed scope

- Use the existing exact-ref CI `workflow_dispatch` route.
- Read Typecheck, complete Unit/integration, and Build results for one exact post-fix product SHA.
- Publish exact CI evidence.

## Forbidden scope

- No product/source/test/workflow edits in this task.
- No helper/CI branch.
- No release-ready or E2E PASS claim from historical evidence.

## Write ownership

- `docs/workbench-coordination/todolist/TODO-RC-012.md`
- `docs/workbench-coordination/reports/REPORT-RC-012.md`

## Acceptance criteria

- One exact product SHA is recorded.
- Typecheck PASS.
- Complete Unit/integration PASS.
- Build PASS.
- If any gate fails, task remains unfinished and the exact failure is routed to the smallest follow-up Todo.

## Required validation

GitHub Actions exact-ref CI only. Historical run `33649460705` is not sufficient for this gate.

## Blocker / Unblock condition

Blocker: bounded Recovery product fixes are not yet independently accepted.

Unblock condition: RC-007 through RC-011 are all `DONE`.

## Attempt history

Fresh post-fix CI gate task created from the 2026-09-05 investigation routing.
