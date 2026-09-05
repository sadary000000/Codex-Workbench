# TODO-RC-002

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P2`
Latest report: `none`

## Goal

Recover exact raw GitHub Actions failure output for the historical exact product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782` and run `33649460705`.

## Repository context

- Repository: `sadary000000/Codex-Workbench`
- Active branch / PR: `fix/v01-recovery-closure` / Draft PR #55
- Historical failing run: `33649460705`
- Failed jobs: `100312467323`, `100525705853`
- Exact product snapshot: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`

## Dependencies

None.

## Routing update — 2026-09-05

A user-provided Pro investigation over the archived current branch source reproduced the full test suite twice as `718 total / 712 pass / 6 fail` and identified concrete failure locations. Live Git compare from `1e9d2ea...` to coordination HEAD `aeabb459...` shows only documentation/coordination files changed, so the relevant source/test content is unchanged from the exact product snapshot.

That evidence is sufficient to unblock bounded repair work, but it does **not** satisfy this Todo's exact-source requirement for raw GitHub Actions stdout/stderr. Therefore this Todo remains BLOCKED, is no longer on the current critical path, and is lowered to P2 for provenance/cross-check only.

## Allowed scope

- Read GitHub Actions run/job/check/log/artifact surfaces for the exact run/jobs above.
- Use an alternate read-only CI surface if it exposes the raw Node test output.
- Inspect source/tests only to map observed failure output.
- Write only this Todo and `docs/workbench-coordination/reports/REPORT-RC-002.md`.

## Forbidden scope

- No product/source/test/workflow edits.
- No speculative product fix.
- No helper/backup/CI branches.
- Do not merge PR #55 or mark it Ready.

## Execution requirements

A Worker may claim this BLOCKED Todo only if it has a materially different CI/log capability that can retrieve non-empty raw failure output from the exact run/job.

## Acceptance criteria

- Capture exact failing test names, assertion/failure text, expected/actual when emitted, and stack/file context.
- Tie every excerpt to run `33649460705` and the exact job/attempt.
- Separate observed CI evidence from inference.
- Make zero product/source/test/workflow changes.

## Blocker / Unblock condition

Blocker: the available GitHub connector surface still has not exposed usable raw Node assertion output for job `100525705853`.

Unblock condition: a Worker can retrieve non-empty raw `npm test` failure output for the exact run/job without changing product code, tests, or workflow behavior.

## Attempt history

- Fresh task created after the prior queue reset.
- 2026-09-05 Project Lead routing update: external local reproduction produced sufficient failure evidence for repair planning, but exact CI-log provenance remains unmet; task retained as P2 BLOCKED cross-check only.
