# Workbench Coordination

This directory is the coordination surface for running Codex Workbench with one long-lived **Project Lead conversation** and multiple short-lived **Worker conversations**.

It is deliberately small. The only fixed role is the Project Lead. Workers are temporary executors defined by a specific task, not permanent sub-roles.

## What this directory owns

This directory owns coordination records only:

- Project Lead responsibilities and operating protocol
- the current delegated task board
- bounded task definitions
- worker result reports

It does **not** own product/runtime truth, workflow truth, Git truth, CI truth, release truth, or the v0.1 scope contract.

When coordination records disagree with current Git refs, CI, source, or the durable Workbench checkpoint, correct the coordination records. Do not mutate product truth merely to make this directory look consistent.

## Fixed role

There is exactly one fixed role:

- `PROJECT_LEAD.md` — the mainline planner/coordinator/reviewer

All other conversations are dynamic Workers governed by:

- `WORKER_PROTOCOL.md`
- one concrete file under `tasks/`

Do not create permanent Backend/Tester/Architect/Release roles unless repeated real usage later proves a stable role is necessary.

## Coordination files

- `PROJECT_LEAD.md` — Project Lead duties, startup sequence, delegation and review rules
- `WORKER_PROTOCOL.md` — rules every temporary Worker must follow
- `TASK_BOARD.md` — current coordination index; it is not a substitute for the durable project checkpoint
- `tasks/TASK_TEMPLATE.md` — template for a bounded delegated task
- `reports/REPORT_TEMPLATE.md` — template for a Worker result report

Concrete work uses matching IDs, for example:

```text
tasks/TASK-RC-001.md
reports/REPORT-RC-001.md
```

## Source-of-truth order

For current project state, use this order:

1. current Git refs / source / GitHub Actions and other live external truth
2. `docs/workbench-map/CURRENT_CHECKPOINT.md`
3. the durable checkpoint referenced by `CURRENT_CHECKPOINT.md`
4. frozen scope/architecture contracts referenced by those documents
5. this coordination directory
6. conversation memory

A Task may narrow work but may never silently broaden or override the frozen project scope.

## Normal flow

1. Project Lead restores current state from the Workbench handoff/checkpoint chain and live GitHub truth.
2. Project Lead decides whether the next work should stay on the mainline conversation or be delegated.
3. For delegated work, Project Lead creates one bounded `TASK-*.md` and registers it in `TASK_BOARD.md`.
4. User opens a Worker conversation and tells it to execute that Task ID.
5. Worker reads `WORKER_PROTOCOL.md`, the exact Task, and only the referenced project materials needed for the task.
6. Worker executes the task and makes durable GitHub changes when the Task authorizes writes.
7. Worker writes `reports/REPORT-<same-id>.md` with exact commits/tests/CI and remaining uncertainty.
8. User tells the Project Lead that the Task is finished or blocked.
9. Project Lead independently verifies the report against GitHub and marks the Task accepted, rejected, blocked, or needing follow-up.
10. Project Lead decides the next task from verified project state.

The user is only the dispatcher between conversations. Do not require the user to copy the full technical result back when GitHub contains the durable result.

## Concurrency rule

Parallelize read-only investigation freely when useful. Parallel write tasks require explicit non-overlapping ownership or an approved branch strategy. Never let two Workers unknowingly mutate the same product branch/files at the same time.

Do not create validation/helper branches merely to store evidence. Follow the repository's current Git workflow and the active checkpoint.

## Git discipline

A Worker code commit and a later report/checkpoint documentation commit are different things. Always preserve the exact **product-code snapshot** that was actually tested. A docs-only coordination commit must never be represented as a newly validated product snapshot.

Merge, branch deletion, Draft -> Ready, release advancement, and other authority-sensitive operations require the same authorization rules as the main project workflow; Task completion does not grant those permissions.
