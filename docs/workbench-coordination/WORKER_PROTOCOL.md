# Workbench Worker Protocol

## Identity

A Worker is a temporary execution conversation for exactly one Workbench Task.

There are no permanent Worker roles in this coordination model. Your role, scope, permissions, and acceptance criteria come from the assigned `tasks/TASK-*.md` file.

## Startup sequence

When told to execute a Workbench Task:

1. Read `docs/workbench-coordination/README.md`.
2. Read this file.
3. Read the exact assigned `tasks/TASK-<id>.md`.
4. Read only the Workbench checkpoint/scope/source files referenced by that Task or required to verify current Git truth.
5. Query live GitHub state specified by the Task before making changes.
6. If the Task's base/ref assumptions are stale, do not guess. Record the mismatch and either safely reconcile within the Task rules or report `BLOCKED`.
7. Execute the Task directly. Do not replan the whole Workbench project.

## Core rules

- Work only on the assigned Task.
- Do not broaden the goal, frozen v0.1 scope, or architecture contract.
- Do not redefine acceptance criteria to make the Task pass.
- Do not perform unrelated cleanup or opportunistic refactors.
- Treat Git/source/CI/provider truth as stronger than cached prose.
- Mark unknowns and hypotheses explicitly.
- Never turn `NOT RUN`, `UNKNOWN`, `BLOCKED`, or partial success into `PASS`.
- Do not merge PRs, delete branches, change Draft/Ready state, or advance a release unless the Task explicitly contains valid authorization consistent with project rules.

## Write and concurrency discipline

The Task must state write ownership.

- If the Task is read-only, do not modify product code.
- If the Task authorizes product writes, modify only the allowed area/ref.
- Do not create extra branches unless the Task/current Git workflow requires and permits it.
- If another active Task appears to overlap your write area or branch, stop and report the collision rather than racing it.
- Preserve old failed/history evidence instead of rewriting history to make the current attempt look clean.

## Validation discipline

Run exactly the validation required by the Task plus any minimal checks necessary to prove your change did not break the touched contract.

Record:

- exact product-code commit SHA
- commands/checks actually run
- PASS/FAIL/NOT RUN for each required gate
- GitHub Actions run/job IDs when applicable
- environment/authentication blockers separately from product failures

Old validation on an older product SHA is context, not proof for the new SHA.

## Durable result protocol

Every Task must produce a matching report:

```text
docs/workbench-coordination/reports/REPORT-<same-task-id>.md
```

Use `reports/REPORT_TEMPLATE.md` unless the Task specifies a stricter format.

For product-writing Tasks, prefer this ordering:

1. make and validate the bounded product change
2. create the product-code commit
3. record that exact product commit SHA in the report
4. publish the report as a separate docs-only commit if needed

This keeps the tested product snapshot distinguishable from later coordination documentation commits.

Do not claim that the report commit itself is the validated product snapshot unless it actually contains the tested product tree and the evidence applies to it.

## Completion states

Report one of:

- `COMPLETED` — Task acceptance evidence is satisfied
- `BLOCKED` — an external/authority/dependency condition prevents completion
- `FAILED` — attempted result does not satisfy acceptance and no safe in-scope fix remains in this Worker run
- `INTERRUPTED` — conversation/tool execution must stop before the Task is complete

A Worker does not mark its own Task `ACCEPTED`; only the Project Lead does that after independent verification.

## Interruption

If execution must stop before completion, preserve the current durable state before losing the conversation when possible. Record:

- last durable commit/ref
- completed steps
- failing/in-progress step
- confirmed facts versus hypotheses
- non-durable work, if any
- exact first resume action

Use the project's interruption handoff mechanism when available. Never reconstruct unsaved code from memory and pretend it is durable.

## Handoff to the Project Lead

After publishing the report, tell the user only what is needed to route the result back to the mainline, for example:

```text
TASK-RC-001 report is published. Tell the Project Lead that TASK-RC-001 is ready for review.
```

The Project Lead is responsible for independently verifying and accepting/rejecting the result.
