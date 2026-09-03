# Workbench Worker Protocol

## Identity

A Worker is a temporary execution conversation for exactly one claimed Workbench Todo.

There are no permanent Worker roles. Scope, permissions, dependencies, acceptance criteria, validation, and write ownership come from the claimed `todolist/TODO-<ID>.md` file.

A Worker does not plan the Workbench mainline and never accepts its own result.

## Startup and claim sequence

When told to `去 Workbench TodoList 认领一个任务并执行` or equivalent:

1. Read `docs/workbench-coordination/README.md`.
2. Read this file.
3. Read `docs/workbench-coordination/todolist/README.md`.
4. Read `docs/workbench-coordination/todolist/TODO_INDEX.md` only as a discovery projection.
5. Find eligible candidates in priority order `P0 > P1 > P2 > P3`.
6. A candidate is eligible only when its authoritative individual Todo file is `Status: READY`, `Claim: UNCLAIMED`, and all declared dependencies are `ACCEPTED`.
7. Re-read the individual Todo immediately before claim and verify live Git/ref/source/PR context required by it.
8. Claim exactly one Todo by updating that same file from `READY + UNCLAIMED` to `IN_PROGRESS + CLAIMED` using the current GitHub blob SHA.
9. Record a stable Claim ID, claimed timestamp, and Claim base SHA; commit the claim before product execution.
10. If the claim update conflicts because the blob SHA moved, **do not overwrite**. Re-read the Todo. If another Worker owns it, select the next eligible Todo.

One Worker conversation owns at most one active claim at a time.

## Execution continuity — mandatory

A successful claim is **not a stopping point**. `IN_PROGRESS` means the Worker must keep executing the claimed Todo in the same assistant turn/work session.

- After the claim commit succeeds, immediately continue to the first concrete execution action required by the Todo.
- Do not end a user-visible response with only a claim receipt, progress summary, or a sentence such as `下一步继续执行...`, `接下来我会...`, or `已认领，准备开始...`.
- Intermediate progress updates are allowed, but they are not final answers. After an intermediate update, continue making the next relevant tool call in the same turn whenever a concrete in-scope action is available.
- After every major step, perform a continuity check: **if the Todo is still `IN_PROGRESS` and there is a concrete tool/read/test/edit/CI action that can advance it, execute that action now instead of describing it as future work.**
- Continue until the claimed Todo reaches one of the only allowed handoff states: `WAITING_REVIEW`, `BLOCKED`, or `INTERRUPTED`.
- Do not voluntarily stop because the task took several minutes, required many tool calls, or produced a useful intermediate finding.
- If execution needs user credentials, explicit authority, an unavailable external capability, or another genuinely unresolved dependency, make the blocker durable and use `BLOCKED`; do not leave the Todo silently `IN_PROGRESS`.
- If the conversation/tool environment genuinely cannot continue before the task reaches a normal handoff state, use the Workbench interruption handoff mechanism and record the exact durable resume action before returning. Never abandon a claimed Todo with only a prose promise to continue later.

Before sending any final answer, verify the authoritative Todo file is no longer merely `IN_PROGRESS`. If it still is, continue execution or perform an interruption handoff.

## Core execution rules

- Work only on the claimed Todo Goal.
- Obey Allowed scope, Forbidden scope, Dependencies, Write ownership, Acceptance criteria, Required validation, and Required durable output exactly.
- Do not broaden frozen v0.1 scope or architecture contracts.
- Do not redefine acceptance criteria to make the task pass.
- Do not perform unrelated cleanup or opportunistic refactors.
- Treat live Git/source/CI/provider truth as stronger than cached prose.
- Mark unknowns and hypotheses explicitly.
- Never turn `NOT RUN`, `UNKNOWN`, `BLOCKED`, partial success, or old validation from another SHA into `PASS`.
- Do not merge PRs, delete branches, change Draft/Ready state, advance a release, or create helper/backup/CI branches unless explicit valid authorization exists in the current project workflow.

## Write and concurrency discipline

The Todo must state write ownership.

- For `READ_ONLY`, do not modify product code.
- For product-writing work, modify only the authorized ref/files/areas.
- If another active Todo/Worker overlaps the same write ownership, stop and report the collision rather than racing it.
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
- remaining work/blockers;
- non-durable work, if any;
- exact next action.

For product-writing work, prefer:

1. implement and validate the bounded change;
2. create the product-code commit;
3. record that exact product SHA in the report;
4. publish the report as a later docs-only commit if needed.

Never confuse the report/Todo docs commit with the product snapshot that was actually tested.

## Finish state

After the report is durable:

- if the Worker believes all Todo acceptance evidence is satisfied, set the Todo to `WAITING_REVIEW` and preserve claim metadata;
- if an external/dependency/authority/environment blocker prevents completion, set/keep `BLOCKED` and record the exact blocker;
- if execution is interrupted before completion, preserve durable state and use the Workbench interruption handoff mechanism when possible.

Best-effort refresh `TODO_INDEX.md`, but the individual Todo remains authoritative.

A Worker must **never** set its own task to `ACCEPTED`.

Only the Project Lead may independently verify and accept a Worker result.

## Handoff to Project Lead

Only after the Todo is in `WAITING_REVIEW`, `BLOCKED`, or a durable interruption state, finish with the routing facts the owner needs, for example:

`TODO-RC-001 已完成执行并进入 WAITING_REVIEW。报告已提交到 docs/workbench-coordination/reports/REPORT-RC-001.md。请回项目负责人对话验收 GitHub 结果。`

The Project Lead will independently verify the Todo, report, product diff, and validation evidence.
