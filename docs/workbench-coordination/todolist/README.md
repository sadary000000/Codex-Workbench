# Workbench TodoList

This directory is the durable task queue for the Workbench Project Lead and temporary Worker conversations.

## Authority

- Each `TODO-*.md` file is authoritative for that task.
- `TODO_INDEX.md` is only a discovery projection and may briefly lag.
- Worker reports live at `docs/workbench-coordination/reports/REPORT-<ID>.md`.
- Git/source/CI plus the active durable checkpoint remain authoritative for product and validation truth.

## Simple task state

Use exactly three task statuses:

- `TODO` — not accepted yet and still needs work.
- `BLOCKED` — not accepted yet; a concrete blocker currently prevents completion.
- `DONE` — independently accepted by the Project Lead.

Do not introduce `READY`, `IN_PROGRESS`, `WAITING_REVIEW`, `ACCEPTED`, `FOLLOW_UP_REQUIRED`, or `INTERRUPTED` as task statuses.

## Assignee

Ownership is separate from task status:

- `Assignee: 待接取` — no Worker currently owns the task.
- `Assignee: <worker-name>` — that Worker conversation owns the current attempt or most recently submitted it for review.

The Worker claims a task by atomically replacing `待接取` with its Worker/conversation identifier using the current GitHub blob SHA. Claiming does not change `Status`.

If ChatGPT does not expose the real UI conversation title, the Worker must not pretend it can read it. Use a stable short Worker label for that conversation instead.

## Required header

Every Todo begins with:

```markdown
# TODO-<ID>

Status: `TODO | BLOCKED | DONE`
Assignee: `待接取 | <worker-name>`
Priority: `P0 | P1 | P2 | P3`
Latest report: `<none | docs/workbench-coordination/reports/REPORT-<ID>.md>`
```

Keep Goal, Repository context, Dependencies, Allowed scope, Forbidden scope, Write ownership, Execution requirements, Acceptance criteria, Required validation, Blocker/Unblock condition, and Attempt history below the header as needed.

## Normal flow

1. Project Lead creates a Todo with `Status: TODO`, `Assignee: 待接取`.
2. Worker atomically claims it by setting `Assignee: <worker-name>`.
3. Worker executes continuously and publishes the matching report.
4. Worker sets `Latest report` to the durable report path but does **not** set `DONE`.
5. Project Lead independently reviews the report and Git/CI evidence.
6. If accepted, Project Lead sets `Status: DONE` and preserves the completing Worker name.
7. If more work is required, Project Lead keeps/sets `Status: TODO`, records the prior attempt, and releases it with `Assignee: 待接取`.

No extra review state is needed.

## Blocked flow

A blocked task stays in this same TodoList.

- Worker that hits a verified blocker sets `Status: BLOCKED`, keeps its Worker name, publishes a report, and records one exact `Unblock condition`.
- Project Lead reviews the blocker.
- If another Worker may safely retry, Project Lead preserves the attempt history and releases it with `Assignee: 待接取` while keeping `Status: BLOCKED` until the blocker is actually cleared.
- A future Worker may claim a BLOCKED task only when its environment can realistically satisfy the documented Unblock condition / execution requirements.
- When that Worker actually clears the blocker, it may change the task back to `Status: TODO` while continuing toward completion.
- If only owner/external action can unblock it, leave it `BLOCKED` and ask only for the concise required action.

## Candidate selection

A Worker may consider a task only when:

- `Status` is `TODO` or `BLOCKED`;
- `Assignee` is `待接取`;
- declared dependency tasks are `DONE`;
- the Worker environment can execute the task requirements; for BLOCKED tasks it must also be able to address the documented Unblock condition.

Never claim `DONE`.

## Index

`TODO_INDEX.md` must contain exactly three sections: `TODO`, `BLOCKED`, `DONE`.

Use a compact table with:

`ID | Status | Assignee | Priority | Goal`

## Discipline

- One bounded outcome per Todo.
- Product-writing tasks require explicit non-overlapping ownership.
- Preserve prior attempts and evidence; do not erase a failed/blocked attempt.
- Do not create helper/backup/CI branches merely for task execution.
- Do not broaden frozen scope, weaken validation, merge PRs, mark Draft PRs Ready, delete active branches, or announce release readiness without explicit authority.
- For uncertain external side effects, Reconcile before any repeat.
