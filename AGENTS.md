# Codex-Workbench repository instructions

## Repository test bootstrap

When the user asks Codex to test, validate, verify, audit, benchmark, or review this repository — including a minimal request such as "test this repository" — use the repository-owned test control plane below instead of inventing an ad-hoc test plan.

1. Record the bootstrap checkout commit with `git rev-parse HEAD`. That commit is the control-plane commit for the run.
2. Read `docs/testing/ACTIVE_TEST.json` first.
3. Read `docs/testing/DEFERRED_TESTS.json` so pending non-blocking work is visible, but do not auto-run deferred tests unless the user asks for deferred/backlog testing or a deferred entry is explicitly activated.
4. Read the complete `docs/testing/CODEX_TEST_RUNBOOK.md`.
5. Read the complete `docs/testing/CODEX_AGENT_PLAN.md`.
6. Read `docs/testing/TEST_RESULT_SCHEMA.json` before producing the final result.
7. Snapshot the protocol files from the recorded control-plane commit into external evidence before target execution. After that snapshot, never switch to a newer remote copy of the protocol during the same run.
8. Treat the exact target commit in `ACTIVE_TEST.json` as immutable test truth. The branch name is a locator and freshness signal, not a substitute for the commit SHA.
9. Preserve the user's current worktree. Never use `git reset --hard`, `git clean`, checkout-overwrite, or another destructive command to prepare a test. Create an isolated detached worktree for the exact target commit as required by the Runbook.
10. Do not merge, push, force-push, delete branches, alter repository settings, or modify product code while executing the repository test protocol unless the user separately and explicitly authorizes that action.
11. Use the agent topology, dependency barriers, parallel waves, resource-isolation rules, freshness checks, and retry policy defined in `CODEX_AGENT_PLAN.md`; do not redesign them during execution.
12. If the active-test pointer is missing, invalid, inaccessible, or internally inconsistent, stop with `BLOCKED`. If a blocking target moves before the run starts, stop with `ACTIVE_TEST_STALE`. If it moves after the target is pinned, finish the exact-SHA run but mark the mainline gate stale rather than pretending the result applies to the newer head.
13. Store test evidence outside the source worktree and return the final result in the repository-defined schema.
14. A result is scoped to the tested exact commit. A historical or deferred PASS never silently grants PASS to a newer commit.

The testing instructions above apply only when the task is repository testing/validation/audit/benchmarking. For normal implementation work, follow the user's task and the repository's ordinary architecture and workflow documentation.