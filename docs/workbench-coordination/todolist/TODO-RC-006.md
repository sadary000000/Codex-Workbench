# TODO-RC-006

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Re-establish a deterministic exact-SHA CI baseline after the two known test-contract defects are repaired, before changing Recovery runtime behavior.

## Dependencies

- RC-004 must be `DONE`.
- RC-005 must be `DONE`.

## Allowed scope

- Identify the exact branch product/test commit produced by accepted RC-004 and RC-005 work.
- Dispatch the existing `.github/workflows/ci.yml` exact-ref workflow route.
- Read CI jobs/logs/results and publish the exact result.

## Forbidden scope

- No product/source/test/workflow modification in this task.
- No reroute through helper/CI branches.
- No retry loop that hides a deterministic failure.
- Do not call a failing or skipped gate PASS.

## Write ownership

- `docs/workbench-coordination/todolist/TODO-RC-006.md`
- `docs/workbench-coordination/reports/REPORT-RC-006.md`

## Acceptance criteria

- Exact tested SHA is recorded.
- Typecheck result is recorded.
- Complete Unit/integration result is recorded, including any Recovery business-level failures now visible after fixture repair.
- Build result is recorded.
- If any gate fails, raw available evidence is captured and no release-ready claim is made.

## Required validation

Use the existing exact-ref `workflow_dispatch` route. One exact SHA must own the reported Typecheck / Unit-integration / Build result.

## Blocker / Unblock condition

Blocker: RC-004 and RC-005 are not yet independently accepted.

Unblock condition: both RC-004 and RC-005 are `DONE` on the active branch.

## Attempt history

Fresh validation-gate task created from the 2026-09-05 investigation routing.
