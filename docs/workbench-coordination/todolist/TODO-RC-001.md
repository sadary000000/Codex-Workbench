# TODO-RC-001

Status: `BLOCKED`
Priority: `P0`
Claim: `CLAIMED`
Claim ID: `RC-001-20260903T185700+0800`
Claimed at: `2026-09-03T18:57:00+08:00`
Claim base SHA: `4886b3068013606f440268f6dd5ee14dc4659533`

## Goal

Identify the exact reproducible Unit/integration regression on Recovery product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`, including failing test name(s), assertion(s), expected value(s), actual value(s), and evidence sufficient for the Project Lead to define the smallest subsequent product-fix Todo. Do not change product code.

## Repository context

- repository: `sadary000000/Codex-Workbench`
- active branch/ref: verify live `fix/v01-recovery-closure`; current branch HEAD at dispatch time is docs-only `efbea37764877ea1d7c40bd88f7af1dc4a21addc`
- integration/base: `release/v0.1-integration` at `6897c29885bd9076f440ab20275f90b59348bde5`
- product snapshot: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- product PR: Draft PR #55, open and not merged at dispatch time
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
  - `docs/workbench-coordination/todolist/TODO-RC-001.md` for claim/status metadata
  - `docs/workbench-coordination/reports/REPORT-RC-001.md` for the durable investigation report

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
- `docs/workbench-coordination/reports/REPORT-RC-001.md`
- update this Todo to `WAITING_REVIEW` only after the report durably satisfies the acceptance criteria
- if the exact assertion cannot be obtained because of a concrete environment/tool blocker, record that blocker and evidence in the report and set/leave the task `BLOCKED` rather than pretending completion

## Notes

Do not run or advance crash/restart Recovery E2E, Source Real E2E, Windows packaged E2E, or final regression in this task. After Project Lead accepts this investigation, it will create the smallest product-fix Todo based on the proven failure evidence.

## Worker blocker

- Durable report: `docs/workbench-coordination/reports/REPORT-RC-001.md`
- Exact product SHA and reproducible CI failure are verified, but available GitHub log/check surfaces did not expose the raw failing assertion, expected value, or actual value from job `100525705853`.
- Exact-SHA local reproduction could not be established because the Worker execution environment could not retrieve GitHub source due its network/DNS restriction.
- No product/source/test/workflow change was made.
- The stale-StepRuntime-`terminalResult` lead remains `UNRELATED/INSUFFICIENT_EVIDENCE` for defining the CI root cause until raw failing-test evidence is available.
