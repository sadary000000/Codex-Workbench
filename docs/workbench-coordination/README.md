# Workbench Coordination

This directory is the coordination surface for running Codex Workbench with one replaceable **Project Lead conversation** and multiple short-lived **Worker conversations**.

The only fixed role is the Project Lead. Workers are temporary executors that claim one bounded Todo at a time.

## What this directory owns

This directory owns coordination records only:

- Project Lead operating protocol;
- GitHub-backed Todo queue;
- Worker claim/execution protocol;
- Worker result reports;
- fixed new-conversation bootstrap prompt for replacing the Project Lead chat.

It does **not** own product/runtime truth, workflow truth, Git truth, CI truth, release truth, or the v0.1 scope contract.

When coordination records disagree with current Git refs, CI, source, or the durable Workbench checkpoint, correct the coordination projection. Do not mutate product truth merely to make coordination records look consistent.

## Current coordination files

- `PROJECT_LEAD.md` — Project Lead startup, dispatch, review, dependency unlock, authority and rollover rules.
- `PROJECT_LEAD_NEW_CONVERSATION_PROMPT.md` — fixed bootstrap text for a replacement Project Lead conversation after context rollover.
- `WORKER_PROTOCOL.md` — rules every temporary Worker must follow.
- `todolist/README.md` — queue and atomic-claim protocol.
- `todolist/TODO_INDEX.md` — compact discovery projection.
- `todolist/TODO-<ID>.md` — authoritative coordination state for one bounded task.
- `reports/REPORT-<ID>.md` — durable Worker execution/result report.

`TASK_BOARD.md` and `tasks/TASK_TEMPLATE.md` are legacy compatibility material from the previous explicit Task-ID dispatch model. Do not create new work there.

## Source-of-truth order

For current project state, use:

1. current Git refs / source / GitHub Actions / external provider truth;
2. `docs/workbench-map/CURRENT_CHECKPOINT.md`;
3. the durable checkpoint and scope/architecture contracts it references;
4. individual `todolist/TODO-*.md` files for coordination state;
5. matching Worker reports and `TODO_INDEX.md` projections;
6. conversation memory.

A Todo may narrow execution but may never silently broaden or override frozen project scope.

## Normal flow

1. Project Lead restores current state from the Workbench handoff/checkpoint chain and live GitHub truth.
2. Project Lead reviews every relevant `WAITING_REVIEW` Todo against its Worker report, product commit/diff, and exact validation evidence.
3. Project Lead marks verified results `ACCEPTED`, records bounded follow-up when needed, and unlocks only dependencies that are now satisfied.
4. Project Lead writes the next smallest justified work items under `todolist/` as `READY` or `BLOCKED`.
5. User opens a normal new conversation and says: `去 Workbench TodoList 认领一个任务并执行。`
6. Worker reads the queue, atomically claims one eligible `READY + UNCLAIMED` Todo using its current blob SHA, and changes it to `IN_PROGRESS`.
7. Worker executes only that Todo, makes durable product changes/validation when authorized, writes `reports/REPORT-<ID>.md`, and changes the Todo to `WAITING_REVIEW` or `BLOCKED`.
8. Project Lead later re-reads GitHub and independently accepts/rejects/follows up the result.

The user is only the dispatcher between conversations. Do not require the user to paste full technical results when GitHub contains them.

## Concurrency rule

Parallelize independent read-only investigation freely when useful. Parallel product writes require explicit non-overlapping write ownership. Never let two Workers knowingly mutate the same branch/files concurrently.

The individual Todo file is the lightweight coordination lock. `TODO_INDEX.md` is discovery only and may lag.

Do not create validation/helper/backup branches merely to store evidence or enable concurrency.

## Project Lead conversation rollover

The Project Lead chat is intentionally replaceable. When its context becomes too long:

1. make current state durable through the normal checkpoint/handoff mechanism when needed;
2. open a new conversation;
3. paste the fixed prompt from `PROJECT_LEAD_NEW_CONVERSATION_PROMPT.md`;
4. let the new Project Lead restore GitHub/checkpoint/Todo truth and continue.

Do not ask the owner to reconstruct project history from memory.

## Git discipline

A Worker product commit and a later report/Todo/checkpoint documentation commit are different things. Always preserve the exact **product-code snapshot** that was actually tested.

A docs-only coordination commit must never be represented as a newly validated product snapshot.

Merge, branch deletion, Draft -> Ready, release advancement, scope changes, and other authority-sensitive operations require the normal project/owner authorization; Todo completion does not grant those permissions.