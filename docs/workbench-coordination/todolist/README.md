# Workbench TodoList

This directory is the durable task queue used by the Workbench Project Lead and temporary Worker conversations.

## Authority

- Each `TODO-*.md` file is authoritative for that task's status, claim, execution requirements, and blocker routing.
- `TODO_INDEX.md` is a discovery projection and may briefly lag individual Todo files.
- Worker reports live at `docs/workbench-coordination/reports/REPORT-<ID>.md`.
- Git/source/CI and the active Workbench checkpoint remain authoritative for product and validation truth; Todo files only coordinate bounded work.

## Status flow

Normal flow:

`READY -> IN_PROGRESS -> WAITING_REVIEW -> ACCEPTED`

Other states:

- `BLOCKED` — execution cannot currently continue because of a verified dependency, environment/capability mismatch, authority requirement, write collision, external condition, or missing evidence.
- `FOLLOW_UP_REQUIRED` — Project Lead review found that a different bounded goal is required; create a new Todo ID rather than silently changing the old goal.

Only the Project Lead may mark a Worker result `ACCEPTED` or requeue a previously blocked attempt.

## Claim protocol

A Worker must atomically claim one `READY` + `UNCLAIMED` Todo using the live file/blob state before doing execution work. Never silently steal or reset an `IN_PROGRESS` claim.

Before claiming, the Worker must also satisfy the Todo's declared **Execution requirements**. Capability checks may use safe read-only probes. If the current environment does not satisfy a task's required capability, skip that task without claiming it and try another eligible Todo.

## Execution requirements

Every Todo must state the capabilities needed to execute it safely. Use capability language rather than assuming a named product/environment.

Examples:

- read-only GitHub API access;
- raw GitHub Actions job-log access that exposes test stdout/stderr;
- exact Git checkout of a specific SHA;
- ability to install dependencies and run `npm test`;
- authenticated provider access;
- Windows packaging environment;
- write access to a specific branch/files.

For simple tasks, write `none beyond normal GitHub coordination access`.

## Fallback routes

A Todo should list ordered safe fallback routes when one execution path can legitimately fail without making the goal impossible.

A Worker must exhaust all in-scope fallback routes that its environment can execute before declaring the task blocked. Do not invent out-of-scope workarounds.

Example:

1. obtain the raw assertion from the existing GitHub Actions job log;
2. if the log surface cannot expose it, reproduce `npm test` from the exact product SHA in an environment with checkout/dependency execution access.

## Blocker classification

A blocked Worker report and Todo must classify the blocker as one of:

- `ENVIRONMENT_MISMATCH` — the task goal is still valid, but this Worker environment lacks a required capability;
- `EXTERNAL_DEPENDENCY` — progress waits on an external system/event/input that another Worker cannot currently solve;
- `OWNER_DECISION_REQUIRED` — explicit product/scope/authority choice is required from the owner;
- `WRITE_COLLISION` — another active Worker owns overlapping write scope;
- `TASK_DEFINITION_GAP` — the current Todo cannot be completed without changing its goal/scope/acceptance contract;
- `INTERRUPTED` — execution stopped unexpectedly but durable resume state exists;
- `OTHER_VERIFIED_BLOCKER` — only when none of the above fits; explain precisely.

Do not classify a mere hypothesis as a blocker.

## Blocked-attempt record

Before a claimed Todo becomes `BLOCKED`, preserve in the Todo/report:

- blocker classification;
- claim ID and report path;
- routes actually attempted and their outcomes;
- exact missing capability/dependency/authority;
- evidence already obtained;
- exact unblock condition;
- whether retrying the **same goal** in another environment is side-effect safe;
- recommended execution requirements for a safe retry.

Keep prior attempt history durable. Never erase a failed/blocked claim to make a retry look like a first attempt.

## Project Lead blocker routing

After independently verifying a blocked result, the Project Lead chooses exactly one route:

1. **Requeue same Todo** — only when the goal/acceptance contract is unchanged, the blocker is environment/capability-specific or an interruption, and retry is side-effect safe. Append the prior attempt to `Attempt history`, add/refine `Execution requirements` and `Fallback routes`, clear the active claim fields, then set `READY + UNCLAIMED`.
2. **Keep BLOCKED** — for unresolved external dependencies, authority/owner decisions, unsafe uncertain side effects, or conditions another Worker cannot solve yet. Record the exact unblock condition.
3. **FOLLOW_UP_REQUIRED** — when a different bounded goal is needed. Create a new Todo with a new ID; do not mutate the original goal into a different task.
4. **ACCEPTED + next Todo** — when an investigation actually satisfied its acceptance criteria and the discovered product fix is a distinct next task.

For uncertain external side effects, never requeue blind execution. Reconcile first.

When a blocked Todo is safely requeued, the owner should not need a custom prompt. A suitable new Worker should still be started with only:

`去 Workbench TodoList 认领一个任务并执行。`

The requeued Todo itself must contain everything the Worker needs.

## Required Todo sections

New or requeued Todo items should include:

- Goal
- Repository context
- Dependencies
- Allowed scope
- Forbidden scope
- Write ownership
- Execution requirements
- Fallback routes
- Acceptance criteria
- Required validation
- Required durable output
- Attempt history
- Blocker / retry policy when relevant

## Queue discipline

- One bounded outcome per Todo.
- Dependencies must be accepted before a dependent Todo becomes `READY`.
- Product-writing tasks must have explicit non-overlapping ownership.
- A Worker must not claim a Todo whose execution requirements its current environment cannot satisfy.
- A Project Lead may requeue a blocked Todo only after verifying the blocker and preserving the previous attempt history.
- Do not create helper/backup/CI branches merely for task execution.
- Do not broaden frozen v0.1 scope, weaken validation, merge PRs, mark Draft PRs Ready, delete active branches, or announce release readiness without explicit authority.
