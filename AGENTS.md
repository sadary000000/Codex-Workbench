# Codex-Workbench repository instructions

## Repository test bootstrap

When the user asks Codex to test, validate, verify, audit, benchmark, review, or add regression coverage for this repository — including a minimal request such as "test this repository" — use the repository-owned test control plane below instead of inventing an ad-hoc test plan.

1. Record the bootstrap checkout commit with `git rev-parse HEAD`. That commit is the control-plane commit for the run.
2. Read `docs/testing/ACTIVE_TEST.json` first.
3. Read `docs/testing/DEFERRED_TESTS.json` so non-blocking work is visible. Do not auto-run deferred tests unless requested or explicitly activated.
4. Read the complete `docs/testing/CODEX_TEST_RUNBOOK.md`.
5. Read the complete `docs/testing/CODEX_AGENT_PLAN.md`.
6. Read the result contract selected by the test definition. For the active repository validation profile this is `docs/testing/TEST_RESULT_SCHEMA.json`. Always also read the universal publication contracts:
   - `docs/testing/TEST_RESULTS_POLICY.json`
   - `docs/testing/TEST_RESULT_MANIFEST_SCHEMA.json`
7. Snapshot the protocol files from the recorded control-plane commit into external evidence before target execution. After that snapshot, never switch to a newer remote copy of the protocol during the same run.
8. Treat the exact target commit selected by the frozen test definition as immutable test truth. A branch is only a locator/freshness signal.
9. Preserve the user's current worktree. Never use `git reset --hard`, `git clean`, checkout-overwrite, or another destructive preparation step. Use isolated detached worktrees as required by the Runbook.
10. During product/test execution, do not merge, push, force-push, delete branches, alter repository settings, or modify product code/tests to obtain a result.
11. Use the agent topology, barriers, parallel waves, resource-isolation rules, freshness checks, and retry policy defined by the selected test protocol. Do not redesign them mid-run.
12. Every run must resolve exactly one authoritative test definition by `testId` from the frozen control plane: either the complete `ACTIVE_TEST.json` object or exactly one entry in `DEFERRED_TESTS.json.tests`. Zero or multiple matches are `BLOCKED`.
13. A test project is keyed by stable `testId`. One test project may have many runs, but every run belongs to exactly one test project. `testId` must match the frozen definition, result payload, publication manifest, and `test-results/<testId>/` path.
14. A run is keyed by `runId`. `runId` must match the result payload, publication manifest, and `test-results/<testId>/runs/<runId>/` path. Older run directories are immutable.
15. Store full/raw execution evidence outside the source worktree. Produce the test-specific schema-compliant `result.json` and the universal publication `manifest.json` only after independent review has frozen the verdict.
16. **Post-run publication is the only standing remote-write exception for repository testing.** After the validation protocol and independent review are complete, publish the frozen structured result package according to `TEST_RESULTS_POLICY.json` to branch `codex/test-results`. This is a distinct publication phase; it does not authorize writes during validation.
17. Result publication may write only `test-results/` on `codex/test-results`, must be fast-forward only, and must never overwrite or delete an existing run. Never force-push. Never publish source-code changes with a result.
18. If another result publisher advances `codex/test-results`, fetch the new head and re-apply only the same new run package on top according to the bounded publication retry rule. Do not rerun product tests merely because the result branch moved.
19. If the active-test pointer is missing, invalid, inaccessible, or internally inconsistent, stop with `BLOCKED`. If a blocking target moves before the run starts, stop with `ACTIVE_TEST_STALE`. If it moves after target pinning, finish the exact-SHA run but mark the mainline gate stale.
20. A historical/deferred PASS applies only to the exact tested commit. It never silently grants PASS to a newer commit.
21. When explicitly asked to run a deferred/backlog test, select exactly one entry from the **frozen** `DEFERRED_TESTS.json`. Require `status=ready` and a 40-character `executionTarget.commit`. If `protocol.source=execution-target`, load and freeze that protocol from the exact execution-target commit.
22. A deferred `executionTarget.branch` is a locator, not a current-gate promise. Forward validation of newer code requires a versioned rebind to a new exact target.

The testing instructions above apply only to repository testing/validation/audit/benchmarking. For normal implementation work, follow the user's task and the repository's ordinary architecture and workflow documentation.
