# TODO-RC-001

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P0`
Latest report: `none`

## Goal

Identify the exact reproducible Unit/integration regression on Recovery product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`, including failing test name(s), assertion(s), expected value(s), actual value(s), and evidence sufficient for the Project Lead to define the smallest subsequent product-fix Todo. Do not change product code.

## Repository context

- repository: `sadary000000/Codex-Workbench`
- active branch/ref: verify live `fix/v01-recovery-closure`
- integration/base: `release/v0.1-integration` at `6897c29885bd9076f440ab20275f90b59348bde5`
- product snapshot: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- product PR: Draft PR #55, open and not merged at last Project Lead review
- known CI: run `33649460705`; jobs `100312467323` and `100525705853` both failed at Unit/integration after Typecheck PASS; Build skipped

## Dependencies

- none

## Allowed scope

- Read GitHub Actions job/check/log evidence for run `33649460705`, prioritizing job `100525705853`.
- If that log surface cannot expose the assertion, reproduce the exact unit/integration suite from product SHA `1e9d2ea15da176d3744c35bd833bfd4a29b56782` in an environment that can show raw test output.
- Inspect only source/tests needed to explain the observed failure and identify the narrow correction target.
- Compare evidence against Recovery invariants and the previously noted stale-StepRuntime-`terminalResult` lead, but keep that lead unverified until direct failure evidence confirms or rejects it.

## Forbidden scope

- no product/source/test/workflow modifications
- no speculative fix or refactor
- no weakening Recovery invariants or validation
- no unrelated cleanup or scope expansion
- no merge / Draft->Ready / branch deletion
- no helper/backup/CI branch
- no use of old pre-Recovery evidence as proof for this snapshot

## Write ownership

- product/source/workflow files: `READ_ONLY`
- coordination writes allowed only to this Todo and `docs/workbench-coordination/reports/REPORT-RC-001.md`

## Execution requirements

At least one evidence route must be actually usable before a Worker claims this BLOCKED task:

1. raw GitHub Actions log access that returns non-empty test stdout/stderr for job `100525705853` or equivalent; or
2. exact repository checkout of SHA `1e9d2ea15da176d3744c35bd833bfd4a29b56782` plus Node/npm/dependency access and the ability to run `npm test` with raw output.

A Worker that cannot satisfy either route must leave `Assignee: 待接取` and skip the task.

## Fallback routes

1. Obtain the raw failing assertion from existing GitHub Actions evidence.
2. Otherwise reproduce `npm test` from the exact product SHA in a usable repository workspace.
3. Do not invent a speculative third route.

## Acceptance criteria

- Identify the failing test/file needed to explain the Unit/integration job failure.
- Record the failing assertion or equivalent failure condition, including expected and actual values/messages.
- Record the exact evidence source.
- Provide an evidence-backed explanation of the failing lifecycle/path and smallest likely correction area.
- Classify the stale-StepRuntime-`terminalResult` lead as `CONFIRMED`, `REJECTED`, or `UNRELATED/INSUFFICIENT_EVIDENCE` with rationale.
- Make zero product/source/test/workflow changes.

## Required validation

- Verify the evidence/source snapshot is exactly `1e9d2ea15da176d3744c35bd833bfd4a29b56782`.
- Preserve exact commands or GitHub run/job identifiers used.
- Capture enough raw failure detail for a later product-fix Worker to act without guessing.
- Verify no product-code diff is produced by this task.

## Required durable output

- no product commit expected or authorized
- `docs/workbench-coordination/reports/REPORT-RC-001.md`
- Worker that completes the investigation must set `Latest report` to that path, keep its Assignee name, and leave `Status: TODO` for Project Lead review
- only the Project Lead may set `Status: DONE`

## Blocker

The previous ChatGPT Worker environment could not obtain the raw failing assertion from the available GitHub log surface and could not perform exact-SHA local reproduction because repository retrieval failed in that environment.

## Unblock condition

A Worker environment can actually execute either:

- non-empty raw Actions stdout/stderr retrieval for the failing job; or
- exact-SHA checkout + dependency/test execution for `npm test`.

This read-only investigation is safe to retry in another capable Worker environment.

## Attempt history

### Attempt 1 — `worker` / prior claim `RC-001-20260903T185700+0800`

- Durable report: `docs/workbench-coordination/reports/REPORT-RC-001.md`
- Result: BLOCKED by execution environment.
- Verified product SHA: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`.
- Verified CI: run `33649460705`; jobs `100312467323` and `100525705853` failed at Unit/integration.
- Raw assertion/expected/actual remained unavailable.
- Exact-SHA local reproduction was unavailable in that Worker environment because repository retrieval/network DNS failed.
- No product/source/test/workflow changes were made.
- Stale `StepRuntime.terminalResult` lead remained `UNRELATED/INSUFFICIENT_EVIDENCE`.

### Project Lead review

- Prior attempt was not accepted because the core evidence criterion was not met.
- The task Goal remains valid.
- The task is intentionally kept in the TodoList as `BLOCKED + 待接取`, not converted into another state or separate queue.
- A capable future Worker may claim it by replacing `待接取` with its Worker/conversation identifier and then executing the documented unblock route.

## Notes

Do not run or advance crash/restart Recovery E2E, Source Real E2E, Windows packaged E2E, or final regression in this task. A product-fix Todo must not be created until the exact failing evidence is obtained.
