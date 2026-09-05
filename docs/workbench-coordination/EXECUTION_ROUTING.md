# Workbench Execution Requirements

Execution routing is advisory task metadata, not a task-state system.

Task state remains only:

- `TODO`
- `BLOCKED`
- `DONE`

Worker ownership remains only:

- `Assignee: 待接取`
- `Assignee: <worker-name>`

## Concrete requirements

When a Todo needs special capability, describe the concrete operation directly instead of introducing more status/profile enums.

Examples:

- needs usable raw GitHub Actions stdout/stderr;
- needs exact checkout of a specified SHA;
- needs shell + dependency installation + `npm test`;
- needs Windows-native package/runtime execution;
- needs authenticated provider/source access;
- needs owner approval or credentials;
- needs write access to specified branch/files.

## Pre-claim rule

Before claiming, a Worker may perform safe read-only checks to confirm it can realistically execute the Todo.

- For a normal `TODO`, claim only when the required execution path is usable.
- For a `BLOCKED` task, claim only when the Worker can realistically address the documented `Unblock condition`.
- If capability is missing, skip without modifying the Todo.

Do not create a long replacement prompt. The Todo itself carries exact SHAs, commands, acceptance details, evidence pointers, fallback routes, and safety constraints.

## Project Lead rule

When reviewing a blocked attempt:

- keep `Status: BLOCKED` while the blocker remains;
- record one concrete Unblock condition;
- preserve Attempt history;
- if another Worker may safely retry, release ownership with `Assignee: 待接取`;
- if the blocker is cleared, the executing Worker may return the task to `Status: TODO` and continue;
- if only owner/external action can unblock it, ask only for that concise action.

Execution requirements never change project scope, validation gates, side-effect safety, branch authority, or release authority.
