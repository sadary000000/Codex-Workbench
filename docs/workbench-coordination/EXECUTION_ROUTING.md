# Workbench Worker Execution Routing

This file defines the small set of execution profiles used by the Project Lead and Worker Skills. The owner should route a conversation to an appropriate environment, but should not copy the Todo's technical instructions into chat.

## Profiles

- `ANY` — no special environment beyond the normal connected GitHub/task tools required by the Todo.
- `GITHUB_EVIDENCE` — requires GitHub evidence access beyond metadata, such as usable raw Actions stdout/stderr or equivalent exact CI evidence.
- `CODE_WORKSPACE` — requires a real repository workspace with exact-SHA checkout plus shell/dependency/test execution. Prefer Codex or an equivalent code workspace when available.
- `WINDOWS_WORKSPACE` — requires Windows-native build/package/runtime execution.
- `AUTHENTICATED_PROVIDER` — requires an authenticated provider/source session or credentials that the Todo explicitly needs.
- `OWNER_ACTION` — cannot be completed autonomously by a Worker; requires an owner decision, approval, credential provision, or other explicit human action.

A Todo may list one preferred profile and one or more compatible alternate profiles. Capabilities, not labels, are authoritative: a Worker must prove the required operation is actually usable before claiming.

## Todo routing fields

For new or requeued work, the Project Lead should include:

```markdown
## Execution routing
- preferred profile: `ANY | GITHUB_EVIDENCE | CODE_WORKSPACE | WINDOWS_WORKSPACE | AUTHENTICATED_PROVIDER | OWNER_ACTION`
- compatible profiles: `<list or none>`
- required capabilities: `<concrete operations>`
- pre-claim proof: `<safe checks that prove capability>`
- owner routing hint: `<one short environment hint; never a technical task prompt>`
```

Keep detailed commands, exact SHAs, job IDs, acceptance evidence, fallback routes, and safety constraints in the Todo itself.

## Project Lead routing rules

- `ENVIRONMENT_MISMATCH`: if the same goal remains correct and retry is safe, preserve attempt history, refine Execution routing, clear the active claim, and requeue the same Todo as `READY + UNCLAIMED`.
- If the Todo requires repository checkout plus commands/tests, prefer `CODE_WORKSPACE` rather than repeatedly dispatching ordinary GitHub-only Worker conversations.
- If Windows-native packaging/execution is required, route to `WINDOWS_WORKSPACE`.
- If live authenticated provider access is required, use `AUTHENTICATED_PROVIDER` and keep the task blocked until such an environment actually exists.
- If explicit owner authority/input is required, use `OWNER_ACTION`; keep the Todo blocked and ask the owner one concise action/decision question.
- `EXTERNAL_DEPENDENCY`, unsafe uncertain side effects, or no plausible capable environment remain `BLOCKED`; do not churn Workers.

When reporting READY work, the Project Lead may show compact routing such as:

`RC-001 -> CODE_WORKSPACE`

The owner then opens that environment and still uses the same generic Worker command:

`去 Workbench TodoList 认领一个任务并执行。`

## Worker routing rules

Before claim:

1. Read the Todo's Execution routing, Execution requirements, Fallback routes, and Attempt history.
2. Determine the current environment's usable capabilities by safe preflight; do not infer capability from product/tool names alone.
3. Claim only when at least one compatible route can actually be executed.
4. If the environment is incompatible, skip the Todo without modifying it.
5. If no READY Todo is executable, return `NO_EXECUTABLE_READY_TASK` plus only the required profile and a short routing hint.

Examples:

- `NO_EXECUTABLE_READY_TASK — RC-001 requires CODE_WORKSPACE. Open Codex or an equivalent repository workspace and use the same Worker command.`
- `NO_EXECUTABLE_READY_TASK — current READY work requires WINDOWS_WORKSPACE.`

Do not produce a long replacement prompt. The Todo is the prompt.

## Safety

Execution routing never changes project scope or authority. It must not be used to bypass merge/release approval, authentication boundaries, side-effect reconciliation, validation gates, write ownership, or the Todo's Allowed/Forbidden scope.