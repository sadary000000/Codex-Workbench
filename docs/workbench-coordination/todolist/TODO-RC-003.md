# TODO-RC-003

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Independently reproduce the Unit/integration failure on a clean checkout of exact product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782` and capture the failing test/assertion locally, without changing product code or tests.

## Repository context

- Repository: `sadary000000/Codex-Workbench`
- Active branch / PR head: `fix/v01-recovery-closure` / PR #55
- Product snapshot under validation: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- Matching CI run: `33649460705`
- Matching reproducible failed jobs: `100312467323` and `100525705853`
- CI runtime: Node 22
- Exact CI test command: `npm test`
- Package test command: `node --experimental-strip-types --test "tests/**/*.test.ts"`

## Dependencies

None. This is one of two independent evidence-producing routes and may run in parallel with `RC-002`.

## Allowed scope

- Obtain a clean local/workspace checkout of exact commit `1e9d2ea15da176d3744c35bd833bfd4a29b56782`.
- Install/use dependencies in a way equivalent to the existing CI contract and run the exact `npm test` command.
- Read source/tests/configuration to interpret the observed local failure.
- Write only this Todo's claim/status metadata and `docs/workbench-coordination/reports/REPORT-RC-003.md`.

## Forbidden scope

- No product/source/test/workflow edits.
- No test rewrite, skip, filtering, snapshot update, or validation weakening.
- No speculative product fix or guessed root cause before the actual failing assertion is captured.
- No helper/backup/CI branch creation.
- Do not resurrect or copy old `RC-001` task/claim/report state.
- Do not merge PR #55, mark it Ready, or broaden frozen v0.1 scope.

## Write ownership

- `docs/workbench-coordination/todolist/TODO-RC-003.md`
- `docs/workbench-coordination/reports/REPORT-RC-003.md`

All product/source/test/workflow files are read-only for this Todo.

## Execution requirements

A Worker may claim this BLOCKED Todo only if its execution environment can access the repository at the exact SHA and has dependency/runtime access sufficient to run the real test suite. Merely reusing an environment that cannot fetch/checkout the repository does not satisfy the unblock condition.

## Acceptance criteria

- Prove the working tree/check-out is exact commit `1e9d2ea15da176d3744c35bd833bfd4a29b56782` before test execution.
- Record the relevant runtime/environment, including Node version; use Node 22 when available to match CI.
- Run the exact `npm test` command without narrowing or modifying the suite.
- Capture the exact failing test name(s), assertion/failure message, expected/actual values when emitted, and sufficient stack/file context.
- State whether the local failure shape is consistent with CI's reproducible Unit/integration failure.
- Explicitly separate observed evidence from inference and make no product/source/test/workflow change.

## Required validation

- Record an exact-SHA proof (`git rev-parse HEAD` or equivalent trustworthy checkout evidence).
- Record the exact command and exit result.
- Preserve the raw relevant failure excerpt in the report, subject to normal report size bounds.
- If setup cannot reach test execution, document the exact external failure and do not claim a product root cause.

## Blocker / Unblock condition

Blocker: the previously available execution environment could not establish a clean exact-SHA checkout / dependency-ready workspace because repository access was blocked by network/DNS restrictions.

Unblock condition: a Worker has a materially capable execution environment with repository access and dependency availability sufficient to check out `1e9d2ea15da176d3744c35bd833bfd4a29b56782` cleanly and run the exact `npm test` suite.

## Attempt history

Fresh task created after the prior Todo queue was intentionally cleared. No `RC-001` claim/report/attempt state is inherited.
