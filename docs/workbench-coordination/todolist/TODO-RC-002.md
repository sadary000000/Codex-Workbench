# TODO-RC-002

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Recover the exact Unit/integration failure evidence for product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782` from GitHub Actions, so the Project Lead can define the smallest evidence-backed product correction instead of guessing.

## Repository context

- Repository: `sadary000000/Codex-Workbench`
- Active branch / PR head: `fix/v01-recovery-closure` / PR #55
- Product snapshot under validation: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- Failing CI run: `33649460705`
- Reproducible failed Unit/integration jobs: `100312467323` and `100525705853`
- Exact CI test command: `npm test`
- Package test command: `node --experimental-strip-types --test "tests/**/*.test.ts"`

## Dependencies

None. This is one of two independent evidence-producing routes and may run in parallel with `RC-003`.

## Allowed scope

- Read GitHub Actions run/job/check/log/artifact surfaces for the exact product snapshot and failing run/jobs above.
- Use an alternate read-only CI surface if it can expose the raw Node test output; record provenance exactly.
- Inspect repository source/tests only as needed to map an observed assertion or stack trace to a file/location.
- Write only this Todo's claim/status metadata and `docs/workbench-coordination/reports/REPORT-RC-002.md`.

## Forbidden scope

- No product/source/test/workflow edits.
- No workflow rewrite or CI weakening.
- No speculative product fix or guessed root cause.
- No helper/backup/CI branch creation.
- Do not resurrect or copy old `RC-001` task/claim/report state.
- Do not merge PR #55, mark it Ready, or broaden frozen v0.1 scope.

## Write ownership

- `docs/workbench-coordination/todolist/TODO-RC-002.md`
- `docs/workbench-coordination/reports/REPORT-RC-002.md`

All product/source/test/workflow files are read-only for this Todo.

## Execution requirements

A Worker may claim this BLOCKED Todo only if its environment has a GitHub Actions/log surface that can realistically satisfy the Unblock condition below. Repeating the same empty/incomplete log query surface without a materially different capability is not execution.

## Acceptance criteria

- Identify the exact failing test name(s) for the reproducible Unit/integration failure on `1e9d2ea15da176d3744c35bd833bfd4a29b56782`.
- Capture the exact assertion/failure message and expected/actual values when emitted by Node's test output.
- Capture enough stack/file/test context to locate the smallest candidate correction area.
- Tie the evidence to run `33649460705` and the exact job/attempt that emitted it; if another CI surface is used, record its provenance.
- Explicitly separate observed evidence from inference. Do not promote a hypothesis to root cause without the failing assertion evidence.
- Make no product/source/test/workflow change.

## Required validation

- Re-read PR #55 / branch head and confirm that the product code snapshot being investigated remains `1e9d2ea15da176d3744c35bd833bfd4a29b56782` or document any newer product-code commit before proceeding.
- Verify the captured output is non-empty raw failure output for the exact product snapshot, not only a job conclusion/step summary.
- Report the exact source of every captured failure excerpt or structured assertion field.

## Blocker / Unblock condition

Blocker: the currently available GitHub connector log surface has repeatedly failed to expose usable raw Node assertion output for job `100525705853` even though the Unit/integration step is reproducibly failing.

Unblock condition: a Worker has a materially different GitHub Actions/log/API surface that can retrieve non-empty raw `npm test` failure output for the exact run/job (or equivalent exact-SHA CI evidence) without modifying product code, tests, or workflow behavior.

## Attempt history

Fresh task created after the prior Todo queue was intentionally cleared. No `RC-001` claim/report/attempt state is inherited.
