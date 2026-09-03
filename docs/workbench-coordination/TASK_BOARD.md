# Workbench Task Board

This file is retained only as a legacy compatibility pointer.

The active task queue is:

`docs/workbench-coordination/todolist/`

Use:

- individual `todolist/TODO-*.md` files as authoritative task records;
- `todolist/TODO_INDEX.md` as the discovery projection;
- `reports/REPORT-*.md` as Worker durable results;
- live Git/source/CI plus the current durable checkpoint as product/validation truth.

The active Todo model uses only:

- `Status: TODO | BLOCKED | DONE`
- `Assignee: 待接取 | <worker-name>`

Do not maintain READY / IN_PROGRESS / WAITING_REVIEW / ACCEPTED / FOLLOW_UP_REQUIRED sections in this legacy file.
