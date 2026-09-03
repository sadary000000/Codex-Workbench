# Workbench Recovery Closure Durable Checkpoint

Updated: 2026-09-03

Status: **CHECKPOINTED / IN PROGRESS / NOT COMPLETE**

This file remains the primary durable checkpoint for the active **v0.1 Recovery Closure** workstream. Its historical filename is retained so existing resume pointers remain stable.

Underlying stage checkpoint: `docs/workbench-map/V0_1_RECOVERY_CLOSURE_CHECKPOINT.md`

## Current objective and frozen scope

Continue only the already-approved v0.1 Recovery Closure:

- reuse existing `ActionIntent / ActionAttempt / ExecutionAttempt / RecoveryCandidate / SideEffectClass / Reconcile` truth;
- derive Recovery through the single backend Governance Projection;
- safe Retry creates a new Intent/Attempt and preserves failed history;
- uncertain provider/side-effect outcomes must Reconcile before any repeat;
- deterministic catch-up may consume only already-persisted durable truth/Evidence and must not fabricate Evidence;
- supported abnormal states must resolve to Normal, Recoverable, or Explicitly Blocked.

Core invariant:

`NormalActions.anyAllowed || RecoveryActions.anyAllowed || Recovery.status === BLOCKED`

Still out of scope: a second Recovery runtime/state machine, force-skip validation, AI-guessed database repair, generic repair DSL, blind resend of uncertain/NON_REPEATABLE side effects, background/infinite retry, or any broader v0.1 scope expansion.

## Live Git / PR truth at checkpoint time

- repository: `sadary000000/Codex-Workbench`
- integration/base branch: `release/v0.1-integration`
- integration base SHA: `6897c29885bd9076f440ab20275f90b59348bde5`
- active product branch: `fix/v01-recovery-closure`
- branch HEAD immediately before this docs-only checkpoint commit: `71f2a347d5cb82f76e385c4207ce23efc3fc4948`
- exact Recovery **product-code snapshot under validation**: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- product integration PR: #55 `fix/v01-recovery-closure -> release/v0.1-integration`
  - OPEN
  - DRAFT
  - mergeable at checkpoint time
  - NOT MERGED
- former CI carrier PR #56: CLOSED, NOT MERGED
- former `ci/v01-recovery-closure` branch is absent; do not recreate it
- current remote branches are exactly: `main`, `codex/workbench-v1`, `workbench/next`, `release/v0.1-integration`, `fix/v01-recovery-closure`
- exact-SHA CI should use `.github/workflows/ci.yml` `workflow_dispatch` with `ref` rather than a helper branch.

Documentation/coordination/cleanup commits after `1e9d2ea...` are **not** newer validated Recovery product snapshots.

## Durable implementation state

The cumulative Recovery Closure implementation remains the product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`.

No product-code fix was made after that snapshot during the latest investigation. The current branch contains later docs/coordination/cleanup commits only.

The implemented Recovery line includes the already-recorded bounded features from the underlying stage checkpoint: Retry/new-attempt recovery, provider request reattachment by durable correlation, deterministic local catch-up over persisted Evidence, governance projection, product-host integration, recovery-focused tests, and renderer exposure of Retry/Blocked actions.

## Validation / CI truth

Exact Recovery product snapshot: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`

GitHub Actions run: `33649460705`

### Attempt 1

Job `100312467323`:

- Checkout exact ref: PASS
- `npm ci`: PASS
- Typecheck: PASS
- Unit and integration tests: **FAIL**
- Build: **SKIPPED**
- job conclusion: **FAILURE**

### Attempt 2 (explicit rerun of the same job, same SHA)

Job `100525705853`:

- Checkout exact ref: PASS
- `npm ci`: PASS
- Typecheck: PASS
- Unit and integration tests: **FAIL**
- Build: **SKIPPED**
- job conclusion: **FAILURE**

The second failure on the exact same product SHA proves the current regression is reproducible; it must not be treated as a transient CI failure.

Still pending for the current Recovery line:

- deterministic CI with Typecheck + tests + Build all PASS on one exact product SHA;
- focused crash/restart Recovery E2E;
- authenticated Source Real E2E;
- Windows packaged Real E2E;
- final regression.

Therefore the release status remains **IN PROGRESS / NOT RELEASE READY**.

## Investigation progress and bounded hypotheses

Source inspection during the latest investigation established the following without changing product code:

1. `tests/v01-step-recovery-closure.test.ts` contains a restart catch-up case that persists verification Evidence, expects Governance catch-up to move the StepRuntime to `REVIEWING`, then persists review Evidence and expects a later Governance catch-up to reach `TERMINAL` with `terminalResult === "COMPLETED"`, while reusing the existing Evidence records.
2. The Retry/new-attempt implementation has a plausible stale-`terminalResult` risk: StepRuntime lifecycle transitions back into active verification/review states may preserve an older terminal result unless explicitly reset.
3. That stale-result risk is **not proven to be the CI root cause**. The restart catch-up test described above creates a completed ExecutionAttempt directly and does not traverse a failed Retry path, so the two paths must remain separated until the exact failing assertion is known.
4. The GitHub log surface available in the latest conversation did not reliably expose the assertion text. The rerun established reproducibility but did not by itself identify the exact failing assertion.

Treat stale `terminalResult` as an **unverified debugging lead**, not a fact. Do not patch around it until the exact failing test evidence correlates to that lifecycle path.

## Current blocker

The immediate blocker is the reproducible Unit/integration failure in run `33649460705`, latest job `100525705853`, on exact product snapshot `1e9d2ea...`.

No Recovery product patch has been made yet. The exact failing assertion(s) must be identified before changing product code, and Recovery invariants must not be weakened merely to make the suite green.

## Work not yet durable

- No product-code patch exists after `1e9d2ea...`.
- No post-fix exact-SHA CI exists.
- No delegated Worker Task has yet been accepted for the regression fix; `TASK_BOARD.md` was empty at the last coordination checkpoint.
- No current-snapshot crash/restart, Source Real, Windows packaged, or final-regression PASS exists.
- There is no known unsaved product-code edit to reconstruct from chat memory.

## Immediate resume sequence

Resume without replanning the project:

1. Read `HANDOFF.md`, `CURRENT_CHECKPOINT.md`, and this durable checkpoint.
2. Re-verify live `fix/v01-recovery-closure`, PR #55, branch list, exact product snapshot, and latest CI attempt; Git/CI truth overrides this document if anything moved.
3. Inspect the failure evidence for latest job `100525705853` (check-run annotations/full logs). If that surface still does not expose the assertion, reproduce the exact `1e9d2ea...` unit/integration suite in an environment that can show the raw test output before editing code.
4. Identify the exact failing test name(s), assertion(s), expected value(s), and actual value(s).
5. Compare that evidence against the existing Recovery invariant and the two distinct paths already inspected: Retry/new-attempt lifecycle and restart verification/review catch-up. Confirm or reject the stale-`terminalResult` hypothesis only from evidence.
6. As Project Lead, create the smallest bounded coordination Task for the regression fix (`TASK-RC-001` may be used if still unused) and dispatch it to one task-defined Worker; do not expand into a general refactor.
7. Worker makes the smallest in-scope fix and produces one exact new product commit; preserve failed Attempt history, Reconcile-before-repeat rules, and Evidence provenance.
8. Run deterministic CI on that exact product commit using exact-ref `workflow_dispatch`; do not recreate a CI carrier branch.
9. Only after Typecheck + Unit/integration + Build are all green on one exact SHA, continue the frozen sequence: `crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression`.

## Do-not-do constraints

- Do not replan or expand v0.1 scope.
- Do not create backup/work/staging/CI-helper branches.
- Do not recreate `ci/v01-recovery-closure`.
- Do not merge PR #55, mark it Ready, or announce release readiness before all Recovery gates pass.
- Do not use old pre-Recovery E2E/Windows artifacts as evidence for a new Recovery snapshot.
- Do not treat this docs-only checkpoint commit as the validated product SHA.
- Do not turn the stale-`terminalResult` lead into a fact without failing-test evidence.
- For uncertain provider/side-effect outcomes, Reconcile first; never authorize blind resend.
