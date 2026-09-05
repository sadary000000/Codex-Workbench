# TODO-RC-003

Status: `BLOCKED`
Assignee: `待接取`
Priority: `P2`
Latest report: `none`

## Goal

Independently reproduce the Unit/integration failure from an exact Git checkout of product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782` and capture the raw failing assertions locally.

## Repository context

- Repository: `sadary000000/Codex-Workbench`
- Active branch / PR: `fix/v01-recovery-closure` / Draft PR #55
- Exact product snapshot: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- CI runtime: Node 22
- Exact suite command: `npm test`

## Dependencies

None.

## Routing update — 2026-09-05

A user-provided Pro investigation ran the archived coordination HEAD source with Node `22.16.0` and reproduced the same full-suite shape twice: `718 total / 712 pass / 6 fail`. The archive contained no `.git`, so it cannot satisfy this Todo's exact-checkout proof. Live Git compare separately proves that all 41 commits from product SHA `1e9d2ea...` to coordination HEAD `aeabb459...` changed only documentation/coordination files; relevant product/test files are identical.

This external reproduction now provides enough bounded evidence to start repair tasks, but this Todo's exact Git checkout acceptance remains unmet. It is therefore retained as P2 BLOCKED cross-check work and is no longer on the current critical path.

## Allowed scope

- Obtain a clean checkout of exact commit `1e9d2ea15da176d3744c35bd833bfd4a29b56782`.
- Use CI-equivalent dependencies/runtime and run the complete `npm test` suite without filtering.
- Read source/tests/configuration to interpret observed failures.
- Write only this Todo and `docs/workbench-coordination/reports/REPORT-RC-003.md`.

## Forbidden scope

- No product/source/test/workflow edits.
- No test skips, narrowing, snapshot update, or validation weakening.
- No helper/backup/CI branches.
- Do not merge PR #55 or mark it Ready.

## Execution requirements

A Worker may claim this BLOCKED Todo only if it can access the repository at the exact SHA and run the real suite with dependency/runtime access.

## Acceptance criteria

- Prove exact SHA before execution with `git rev-parse HEAD` or equivalent trustworthy evidence.
- Record Node/runtime and exact command/exit result.
- Capture exact failing test names, assertion text, expected/actual, and stack/file context.
- Make zero product/source/test/workflow changes.

## Blocker / Unblock condition

Blocker: prior Worker environments could not establish an exact-SHA dependency-ready checkout because repository access was blocked by network/DNS restrictions; the new Pro archive reproduction lacks Git identity proof.

Unblock condition: a Worker can cleanly check out `1e9d2ea...` and run the complete suite.

## Attempt history

- Fresh task created after the prior queue reset.
- 2026-09-05 Project Lead routing update: source-equivalent Pro reproduction exists, but exact checkout proof remains unmet; task retained as P2 BLOCKED cross-check only.
