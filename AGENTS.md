# Codex-Workbench repository instructions

## Repository test bootstrap

When the user asks Codex to test, validate, verify, audit, benchmark, or review this repository — including a minimal request such as "test this repository" — use the repository-owned test control plane below instead of inventing an ad-hoc test plan.

1. Read `docs/testing/ACTIVE_TEST.json` first.
2. Read the complete `docs/testing/CODEX_TEST_RUNBOOK.md`.
3. Read the complete `docs/testing/CODEX_AGENT_PLAN.md`.
4. Read `docs/testing/TEST_RESULT_SCHEMA.json` before producing the final result.
5. Treat the exact target commit in `ACTIVE_TEST.json` as immutable test truth. The branch name is a locator, not a substitute for the commit SHA.
6. Preserve the user's current worktree. Never use `git reset --hard`, `git clean`, checkout-overwrite, or another destructive command to prepare a test. Create an isolated detached worktree for the exact target commit as required by the Runbook.
7. Do not merge, push, force-push, delete branches, alter repository settings, or modify product code while executing the repository test protocol unless the user separately and explicitly authorizes that action.
8. Use the agent topology, dependency barriers, parallel waves, resource-isolation rules, and retry policy defined in `CODEX_AGENT_PLAN.md`; do not redesign them during execution.
9. If the active-test pointer is missing, invalid, stale, inaccessible, or internally inconsistent, stop with `BLOCKED`. Do not guess a branch, SHA, test command, or replacement protocol.
10. Store test evidence outside the source worktree and return the final result in the repository-defined schema.

The testing instructions above apply only when the task is repository testing/validation/audit/benchmarking. For normal implementation work, follow the user's task and the repository's ordinary architecture and workflow documentation.