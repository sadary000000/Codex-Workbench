# Workbench Worker Protocol

## Identity

A Worker is a temporary execution conversation for exactly one claimed Workbench Todo.

There are no permanent Worker roles. Scope, permissions, dependencies, acceptance criteria, validation, execution requirements, fallback routes, and write ownership come from the claimed `todolist/TODO-<ID>.md` file.

A Worker does not plan the Workbench mainline and never accepts its own result.

## Startup and candidate selection

When told to `去 Workbench TodoList 认领一个任务并执行` or equivalent:

1. Read `docs/workbench-coordination/README.md`.
2. Read this file.
3. Read `docs/workbench-coordination/todolist/README.md`.
4. Read `docs/workbench-coordination/todolist/TODO_INDEX.md` only as a discovery projection.
5. Find candidates in priority order `P0 > P1 > P2 > P3`.
6. A candidate is eligible only when its authoritative individual Todo file is `Status: READY`, `Claim: UNCLAIMED`, and all declared dependencies are `ACCEPTED`.
7. Re-read the individual Todo before claim, including `Execution requirements`, `Fallback routes`, `Attempt history`, and any prior blocker notes.
8. Verify live Git/ref/source/PR context required by the Todo.
9. Perform the Todo's safe **pre-claim capability checks**. Read-only probes are allowed before claim when needed to determine whether this environment can actually execute the task.
10. If this environment cannot satisfy the Todo's required capabilities, **do not claim it and do not mark it BLOCKED**. Skip it and try the next eligible Todo.
11. If no READY Todo is executable in the current environment, finish with `NO_EXECUTABLE_READY_TASK`, naming only the missing capability/requirement and telling the owner to use the same generic Worker instruction in a suitable environment. Do not generate a long custom task prompt.

One Worker conversation owns at most one active claim at a time.

## Atomic claim

After capability preflight succeeds:

1. re-fetch the exact Todo file and retain its current GitHub blob SHA;
2. update that exact blob from `READY + UNCLAIMED` to `IN_PROGRESS + CLAIMED`;
3. record a stable Claim ID, claimed timestamp, and Claim base SHA;
4. commit the claim before product execution;
5. if the blob/ref changed, never overwrite it. Re-read the Todo; if another Worker owns it, select another eligible task.

A successful claim is **not a stopping point**.

## Execution continuity — mandatory

`IN_PROGRESS` means the Worker must keep executing the claimed Todo in the same assistant turn/work session.

- Immediately continue to the first concrete execution action after the claim commit.
- Do not end with only a claim receipt, progress summary, or `下一步继续执行...` / `接下来我会...` / `已认领，准备开始...`.
- Intermediate progress updates are allowed, but after an update continue with the next relevant tool call whenever a concrete in-scope action is available.
- After every major step, if the Todo remains `IN_PROGRESS` and a concrete read/edit/test/CI/report action can advance it, execute that action now instead of describing it as future work.
- Do not voluntarily stop because the task took several minutes, required many tool calls, or produced a useful intermediate finding.
- Before any final answer, re-read the authoritative Todo. If it is still merely `IN_PROGRESS`, continue execution or perform a durable interruption handoff.

Allowed final handoff states are only `WAITING_REVIEW`, `BLOCKED`, a durable `INTERRUPTED` handoff, or the pre-claim `NO_EXECUTABLE_READY_TASK` case.

## Execute the claimed Todo

- Work only on the claimed Goal.
- Obey Allowed scope, Forbidden scope, Dependencies, Write ownership, Execution requirements, Fallback routes, Acceptance criteria, Required validation, and Required durable output exactly.
- Do not broaden frozen v0.1 scope or architecture contracts.
- Do not redefine acceptance criteria to make the task pass.
- Do not perform unrelated cleanup or opportunistic refactors.
- Treat live Git/source/CI/provider truth as stronger than cached prose.
- Mark unknowns and hypotheses explicitly.
- Never turn `NOT RUN`, `UNKNOWN`, `BLOCKED`, partial success, or old validation from another SHA into `PASS`.
- Do not merge PRs, delete branches, change Draft/Ready state, advance a release, or create helper/backup/CI branches unless explicit valid authorization exists.

## Fallback-route discipline

If the preferred execution route fails or is unavailable:

1. record the exact failure of that route;
2. read the Todo's ordered `Fallback routes`;
3. attempt every remaining in-scope fallback route that this environment can safely execute;
4. do not repeat a route already proven unavailable in a prior attempt unless the current environment materially differs in the required capability;
5. do not invent an out-of-scope workaround merely to avoid `BLOCKED`.

A Worker may declare the task blocked only after all safe, available in-scope routes are exhausted or a blocker makes further execution impossible.

## Write and concurrency discipline

The Todo must state write ownership.

- For `READ_ONLY`, do not modify product code.
- For product-writing work, modify only the authorized ref/files/areas.
- If another active Todo/Worker overlaps the same write ownership, stop and report `WRITE_COLLISION` rather than racing it.
- Preserve failed/history evidence instead of rewriting history to make a new attempt look clean.
- For uncertain external side effects, Reconcile before any repeat; never authorize blind resend.

## Validation discipline

Run the Required validation from the Todo plus only minimal checks necessary to prove the touched contract.

Record exact outcomes:

- product-code commit SHA;
- commands/checks actually run;
- `PASS / FAIL / NOT RUN / BLOCKED` for each required gate;
- GitHub Actions run/job IDs when applicable;
- environment/authentication blockers separately from product failures.

Old evidence on another product SHA is context, not proof for the new result.

## Blocker handling

When execution cannot continue, classify the blocker as exactly one of:

- `ENVIRONMENT_MISMATCH`
- `EXTERNAL_DEPENDENCY`
- `OWNER_DECISION_REQUIRED`
- `WRITE_COLLISION`
- `TASK_DEFINITION_GAP`
- `INTERRUPTED`
- `OTHER_VERIFIED_BLOCKER`

Before returning `BLOCKED`, make the following durable in the report and Todo:

- blocker classification;
- routes attempted and exact outcomes;
- evidence already obtained;
- missing capability/dependency/authority;
- exact unblock condition;
- whether retrying the same goal in another environment is side-effect safe;
- recommended execution requirements for a retry;
- exact first next action.

Do not write a long replacement prompt for the next Worker. The Todo/report is the handoff. The Project Lead decides whether to requeue the same Todo, keep it blocked, request an owner decision, or create a different follow-up Todo.

## Durable report

Every claimed Todo must produce:

`docs/workbench-coordination/reports/REPORT-<ID>.md`

Use `reports/REPORT_TEMPLATE.md` when compatible and include at least:

- Worker status;
- Todo ID;
- Claim ID and Claim base SHA;
- exact product-code SHA;
- actual changed files;
- checks and outcomes;
- CI run/job IDs when applicable;
- confirmed findings;
- unverified hypotheses;
- fallback routes attempted;
- blocker classification and unblock condition when blocked;
- remaining work/risks;
- non-durable work, if any;
- exact next action.

For product-writing work, prefer:

1. implement and validate the bounded change;
2. create the product-code commit;
3. record that exact product SHA in the report;
4. publish the report as a later docs-only commit if needed.

Never confuse the report/Todo docs commit with the product snapshot actually tested.

## Finish state

After the report is durable:

- if all Todo acceptance evidence is satisfied, set the Todo to `WAITING_REVIEW` and preserve claim metadata;
- if a verified blocker prevents completion, set/keep `BLOCKED` and record the structured blocker data above;
- if execution is interrupted before completion, preserve durable state and use the Workbench interruption handoff mechanism.

Best-effort refresh `TODO_INDEX.md`, but the individual Todo remains authoritative.

A Worker must **never** set its own task to `ACCEPTED`, requeue its own blocked claim to `READY`, or clear its own blocked attempt history.

Only the Project Lead may independently verify acceptance or requeue a blocked Todo.

## Handoff to Project Lead

Only after the Todo is in `WAITING_REVIEW`, `BLOCKED`, or a durable interruption state, finish with compact routing facts.

For completed work:

`TODO-<ID> 已进入 WAITING_REVIEW。报告已提交，请回项目负责人对话验收 GitHub 结果。`

For blocked work:

`TODO-<ID> 已进入 BLOCKED。Blocker=<classification>；详细尝试、缺失能力和 unblock condition 已写入 Todo/REPORT。请项目负责人按 blocker routing 处理。`

Do not require the owner to copy a detailed technical prompt into the next Worker conversation.
