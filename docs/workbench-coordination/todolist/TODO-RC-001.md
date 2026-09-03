# TODO-RC-001

Status: `READY`
Priority: `P0`
Claim: `UNCLAIMED`
Claim ID: `null`
Claimed at: `null`
Claim base SHA: `null`

## Goal

Identify the exact reproducible Unit/integration regression on Recovery product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`, including failing test name(s), assertion(s), expected value(s), actual value(s), and evidence sufficient for the Project Lead to define the smallest subsequent product-fix Todo. Do not change product code.

## Repository context

- repository: `sadary000000/Codex-Workbench`
- active branch/ref: verify live `fix/v01-recovery-closure`; latest Project Lead observed branch HEAD was docs-only `d9f68e17e814733e3528eb0852a1f0ba676cf608`
- integration/base: `release/v0.1-integration` at `6897c29885bd9076f440ab20275f90b59348bde5`
- product snapshot: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- product PR: Draft PR #55, open and not merged at latest Project Lead review
- known CI: run `33649460705`; attempt 1 job `100312467323` FAIL; attempt 2 job `100525705853` FAIL; both fail at Unit/integration tests after Typecheck PASS, with Build skipped

## Dependencies

- none

## Allowed scope

- Read GitHub Actions job/check-run/log evidence for run `33649460705`, prioritizing latest job `100525705853`.
- If GitHub log surfaces do not expose the assertion, reproduce the exact unit/integration suite from a clean checkout of product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782` in an environment that can show raw test output.
- Inspect only the source/tests needed to explain the observed failure and identify the narrow correction target.
- Compare the evidence against the existing Recovery invariants and the previously noted stale-StepRuntime-`terminalResult` debugging lead, but treat that lead as unverified until the failure evidence proves or rejects it.

## Forbidden scope

- no product/source/test/workflow modifications
- no speculative fix or refactor
- no weakening Recovery invariants or validation expectations
- no unrelated cleanup or scope expansion
- no merge / Draft->Ready / branch deletion
- no helper/backup/CI branch
- no reuse of historical pre-Recovery E2E evidence as proof for this snapshot
- no claim that stale `terminalResult` is the root cause without direct evidence

## Write ownership

- product/source/workflow files: `READ_ONLY`
- coordination writes allowed only to:
  - `docs/workbench-coordination/todolist/TODO-RC-001.md` for claim/status metadata and preserved attempt history
  - `docs/workbench-coordination/reports/REPORT-RC-001.md` for the durable investigation report; preserve prior-attempt evidence when updating it

## Execution requirements

- required capabilities: **at least one evidence route must be proven usable before claim**:
  1. raw GitHub Actions job-log access that returns non-empty stdout/stderr for job `100525705853` (or the same run/attempt) and can expose Node test-runner failure text; or
  2. exact repository checkout of SHA `1e9d2ea15da176d3744c35bd833bfd4a29b56782` plus Node 22 / npm, dependency-install access (or an equivalent clean dependency state), and the ability to run `npm test` and capture raw output.
- pre-claim checks:
  - Route 1: perform a safe read-only log probe and confirm the returned content includes actual command/test stdout rather than only job metadata or an empty payload; or
  - Route 2: prove the exact SHA can be checked out/read locally, confirm Node 22-compatible execution, and prove dependency/test execution is realistically available before claiming.
- if neither pre-claim check succeeds, **do not claim this Todo**; skip it and return `NO_EXECUTABLE_READY_TASK` if no other eligible Todo exists.

## Fallback routes

1. Obtain the raw failing assertion from existing GitHub Actions run `33649460705`, prioritizing rerun job `100525705853`.
2. If the raw log route is unavailable but Route 2 capability was preflighted successfully, reproduce the exact suite on SHA `1e9d2ea15da176d3744c35bd833bfd4a29b56782` with the repository's CI-equivalent command path (`npm ci`, `npm run typecheck` as context, then `npm test`) and capture the failing test/assertion output.
3. Do not invent a third speculative route. If every preflighted in-scope route unexpectedly becomes unavailable after claim, record the exact failure and follow the Worker blocker protocol.

## Acceptance criteria

- Identify every failing test needed to explain the Unit/integration job failure, with exact test name/file where available.
- Record the failing assertion or equivalent failure condition, including expected and actual values/messages.
- Record the exact evidence source: GitHub run/job/log/check annotation or exact local command on SHA `1e9d2ea...`.
- Provide an evidence-backed explanation of the failing lifecycle/path and the smallest likely correction area; distinguish proven facts from hypotheses.
- Explicitly classify the stale-StepRuntime-`terminalResult` lead as `CONFIRMED`, `REJECTED`, or `UNRELATED/INSUFFICIENT_EVIDENCE`, with rationale.
- Make zero product/source/test/workflow changes.

## Required validation

- Verify the reproduced/read source snapshot is exactly `1e9d2ea15da176d3744c35bd833bfd4a29b56782` before drawing conclusions.
- Preserve the exact test command or GitHub job/run identifiers used to obtain the failure.
- Capture enough raw failure detail in the report for another Worker to implement a bounded correction without guessing.
- Verify there is no product-code diff produced by this task.

## Required durable output

- no product commit is expected or authorized
- update `docs/workbench-coordination/reports/REPORT-RC-001.md`; preserve the first blocked attempt and add the new attempt/result rather than erasing prior evidence
- update this Todo to `WAITING_REVIEW` only after the report durably satisfies the acceptance criteria
- if a verified blocker still prevents completion after all safe available in-scope routes are exhausted, record the structured blocker data required by Worker protocol and set/leave the task `BLOCKED`

## Attempt history

- Attempt 1 — Claim ID `RC-001-20260903T185700+0800`, Claim base SHA `4886b3068013606f440268f6dd5ee14dc4659533`, report `docs/workbench-coordination/reports/REPORT-RC-001.md`.
  - Worker result: `BLOCKED`.
  - Project Lead classification: `ENVIRONMENT_MISMATCH`.
  - Route attempted: available GitHub job/check/log surfaces confirmed the Unit/integration failure but did not expose raw failing assertion / expected / actual values; Project Lead re-probe of run logs returned an empty content payload.
  - Route attempted: exact-SHA local reproduction could not be established in that Worker environment because repository retrieval was blocked by its GitHub network/DNS environment.
  - Evidence preserved: product SHA `1e9d2ea15da176d3744c35bd833bfd4a29b56782`; CI run `33649460705`; jobs `100312467323` and `100525705853`; Recovery test surface inspection; no product/source/test/workflow changes.
  - Stale `StepRuntime.terminalResult` lead: `UNRELATED/INSUFFICIENT_EVIDENCE` until raw failure evidence proves otherwise.
  - Same-goal retry is side-effect safe because this Todo is read-only investigation and authorizes no product or external side-effect execution.

## Blocker / retry policy

- safe same-goal requeue: `yes`
- prior blocker classification: `ENVIRONMENT_MISMATCH`
- requeue rationale: the Goal and Acceptance criteria remain correct; the prior failure was capability/environment-specific, not a product-side external dependency or unsafe side effect; another Worker may legitimately succeed if it proves one required evidence route before claim.
- unblock condition: a Worker environment proves either non-empty raw Actions stdout/stderr access for the failing job or exact-SHA checkout + dependency/test execution capability, then obtains the exact failing assertion evidence.
- routes that should not be repeated unchanged: do not claim based only on generic GitHub metadata/check access; do not claim in an environment that cannot retrieve the exact source snapshot or run the suite.
- exact first next action: a new Worker performs the pre-claim capability checks above; only a Worker that passes at least one may claim and continue the investigation.

## Historical Worker blocker

- Durable report: `docs/workbench-coordination/reports/REPORT-RC-001.md`
- Exact product SHA and reproducible CI failure were verified, but the first Worker environment could not obtain raw assertion evidence.
- No product/source/test/workflow change was made.

## Project Lead review — 2026-09-03

Original verdict: **BLOCKED CONFIRMED / NOT ACCEPTED**.

Independent review findings:

- The exact Recovery product snapshot remained `1e9d2ea15da176d3744c35bd833bfd4a29b56782`; CI run `33649460705` failed at Unit/integration on both job `100312467323` and rerun job `100525705853`, with Typecheck PASS and Build SKIPPED.
- `REPORT-RC-001.md` is durable. The Worker did not modify product/source/test/workflow files.
- The task's core Acceptance Criteria were not satisfied: exact failing test/assertion plus expected/actual values were unavailable, so no evidence-backed product correction target could be accepted.
- The stale-StepRuntime-`terminalResult` lead remained `UNRELATED/INSUFFICIENT_EVIDENCE`; it was not authorized as a root-cause claim.

## Project Lead blocker routing — 2026-09-03 21:06 +08:00

Route: **Requeue the same Todo**.

- Classification: `ENVIRONMENT_MISMATCH`.
- Live PR #55 remained Draft/Open with head `d9f68e17e814733e3528eb0852a1f0ba676cf608` and base `release/v0.1-integration` at `6897c29885bd9076f440ab20275f90b59348bde5`.
- Live CI run `33649460705` remained failed on exact product SHA `1e9d2ea15da176d3744c35bd833bfd4a29b56782`; rerun job `100525705853` still showed Typecheck PASS, Unit/integration FAIL, Build SKIPPED.
- Project Lead re-probed the run logs endpoint and received an empty content payload, independently confirming the current GitHub tool surface does not provide the raw assertion.
- Because the investigation is read-only and the Goal/Acceptance criteria are unchanged, retrying in a Worker environment with the required evidence capability is safe.
- No product-fix Todo is created yet; doing so before the exact assertion is known would be speculative.

## Notes

Do not run or advance crash/restart Recovery E2E, Source Real E2E, Windows packaged E2E, or final regression in this task. After Project Lead accepts this investigation, it will create the smallest product-fix Todo based on the proven failure evidence.
