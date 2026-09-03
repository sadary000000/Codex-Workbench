# Workbench TodoList

This directory is the durable task queue used by the Workbench Project Lead and temporary Worker conversations.

## Authority

- Each `TODO-*.md` file is authoritative for that task's status and claim.
- `TODO_INDEX.md` is a discovery projection and may briefly lag individual Todo files.
- Worker reports live at `docs/workbench-coordination/reports/REPORT-<ID>.md`.
- Git/source/CI and the active Workbench checkpoint remain authoritative for product and validation truth; Todo files only coordinate bounded work.

## Status flow

`READY -> IN_PROGRESS -> WAITING_REVIEW -> ACCEPTED`

Other states:

- `BLOCKED` — a dependency, environment, or authority prevents execution.
- `FOLLOW_UP_REQUIRED` — Project Lead review found a bounded correction that requires a new Todo ID.

Only the Project Lead may mark a Worker result `ACCEPTED` after independently verifying the report, commit/diff when applicable, exact product snapshot, CI, acceptance criteria, and required validation.

## Claim protocol

A Worker must atomically claim one `READY` + `UNCLAIMED` Todo using the live file/blob state before doing execution work. Never silently steal or reset an `IN_PROGRESS` claim.

## Queue discipline

- One bounded outcome per Todo.
- Dependencies must be accepted before a dependent Todo becomes `READY`.
- Product-writing tasks must have explicit non-overlapping ownership.
- Do not create helper/backup/CI branches merely for task execution.
- Do not broaden frozen v0.1 scope, weaken validation, merge PRs, mark Draft PRs Ready, delete active branches, or announce release readiness without explicit authority.
