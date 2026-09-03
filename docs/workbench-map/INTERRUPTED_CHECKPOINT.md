# Workbench Interrupted Checkpoint

Generated: 2026-09-03 (UTC+8)

Status: **INTERRUPTED / IN PROGRESS / NOT COMPLETE**

Resume mode: `INTERRUPTED`

Underlying durable checkpoint: `docs/workbench-map/V0_1_RECOVERY_CLOSURE_CHECKPOINT.md`

## Status

The repository coordination/branch-cleanup work in this conversation is durable, but the product mainline remains the frozen **v0.1 Recovery Closure** and is still blocked by the existing unit/integration regression on the last validated Recovery product snapshot.

No product-code fix was made after the failing Recovery CI snapshot. Do not treat later documentation, coordination, or one-time branch-cleanup commits as a newly validated product snapshot.

## Current objective and frozen scope

Continue only the already-approved v0.1 Recovery Closure:

- reuse existing `ActionIntent / ActionAttempt / ExecutionAttempt / RecoveryCandidate / SideEffectClass / Reconcile` truth;
- derive Recovery through the single backend Governance Projection;
- safe Retry creates new Intent/Attempt history and preserves failed history;
- uncertain provider/side-effect outcome must Reconcile before any repeat;
- deterministic catch-up may consume only existing durable truth/Evidence and must not fabricate Evidence;
- supported abnormal states must resolve to Normal, Recoverable, or Explicitly Blocked.

Core invariant:

`NormalActions.anyAllowed || RecoveryActions.anyAllowed || Recovery.status === BLOCKED`

Still out of scope: a second Recovery runtime/state machine, force-skip validation, AI-guessed database repair, generic repair DSL, blind resend of uncertain/NON_REPEATABLE side effects, background/infinite retry, or broader v0.1 scope expansion.

## Git refs and product snapshot

- integration/base branch: `release/v0.1-integration`
- integration base SHA: `6897c29885bd9076f440ab20275f90b59348bde5`
- active implementation branch: `fix/v01-recovery-closure`
- branch HEAD immediately before this interruption handoff docs commit: `d56bf7c7ebbdb76ccc7c9fbfa81b58a7ed7c9502`
- last validated Recovery **product-code snapshot**: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- product integration PR: #55 `fix/v01-recovery-closure -> release/v0.1-integration`
  - state: OPEN
  - draft: YES
  - mergeable at checkpoint time: YES
  - not merged
- former CI carrier PR #56: CLOSED, NOT MERGED
- former `ci/v01-recovery-closure` branch: deleted during branch cleanup
- current remote branches after cleanup: `main`, `codex/workbench-v1`, `workbench/next`, `release/v0.1-integration`, `fix/v01-recovery-closure`
- current `.github/workflows/ci.yml` supports `workflow_dispatch` with an optional exact `ref`, so a CI carrier branch is no longer required for exact-SHA verification.

Historical test-result branch evidence was preserved before cleanup with tag:

`archive/codex-test-results-20260903` -> `f5afa66b7313b35afa818bd3c0f89616c711e78a`

## Durable work completed before interruption

1. The bounded Recovery Closure implementation remains durable at product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`; see the underlying Recovery checkpoint for its exact implementation file set and semantics.
2. New lightweight multi-conversation coordination protocol was committed at `10d493a53c318e64679da4223d85354b5254d1bd` (`docs: add lightweight Workbench coordination protocol`), including:
   - `docs/workbench-coordination/README.md`
   - `PROJECT_LEAD.md`
   - `WORKER_PROTOCOL.md`
   - `TASK_BOARD.md`
   - Task and Report templates.
   The only fixed role is Project Lead; Workers are dynamic and task-defined.
3. `TASK_BOARD.md` currently has Project Lead `ACTIVE` and no delegated tasks in READY / IN_PROGRESS / WAITING_REVIEW / BLOCKED / ACCEPTED.
4. Remote branch cleanup was completed. The one-time cleanup workflow run `33697961829` completed successfully, historical test-result evidence was archived by tag, obsolete branches were removed, and the temporary cleanup workflow self-removed. Current remote branch count is five.
5. Final cleanup maintenance commit before this handoff is `d56bf7c7ebbdb76ccc7c9fbfa81b58a7ed7c9502` (`chore: remove one-time branch cleanup workflow`). This is repository-maintenance history, not a new Recovery product validation result.

## Validation / CI truth

Latest Recovery product validation remains GitHub Actions CI run `33649460705` on exact product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`, job `100312467323`:

- Checkout exact ref: PASS
- `npm ci`: PASS
- Typecheck: PASS
- Unit and integration tests: **FAIL**
- Build: **SKIPPED** because tests failed

Run conclusion: **FAILURE**.

No newer product-code snapshot has replaced `1e9d2ea...`, and no newer deterministic CI result proves the Recovery product green.

Still pending for the current Recovery line:

- deterministic CI with Typecheck + tests + Build all PASS on one exact product SHA;
- focused crash/restart Recovery E2E;
- authenticated Source Real E2E;
- Windows packaged Real E2E;
- final regression.

The successful branch-cleanup workflow is maintenance evidence only and is **not** product-validation evidence.

## Current blocker or failure

The immediate blocker is the unit/integration regression in CI run `33649460705`, job `100312467323`.

The exact failing assertion/log must be inspected before changing product code. Do not weaken Recovery invariants merely to make the suite green.

## Partial diagnosis / unverified hypotheses

**UNVERIFIED HYPOTHESIS from the prior working conversation:** the Retry/new-attempt path may leave a stale StepRuntime `terminalResult=FAILED` when a new attempt becomes current and lifecycle moves back into RUNNING/VERIFYING. This was identified as a possible narrow debugging lead, not as a proven root cause.

Before patching, confirm or reject this hypothesis against the exact failing CI logs and current source. Do not encode it as fact merely because it appears in this interruption checkpoint.

## Work not yet durable

- No Recovery product-code patch has been made after `1e9d2ea...`.
- No CI rerun proving a fixed product snapshot exists.
- No delegated Worker Task has yet been created for the failing regression; the Task Board remains empty.
- No crash/restart, Source Real, Windows packaged, or final-regression result exists for a post-fix Recovery snapshot.

There is no known unsaved product-code edit that should be reconstructed from conversation memory.

## Exact resume action

On resume, perform this sequence without replanning the whole project:

1. Read `HANDOFF.md`, `CURRENT_CHECKPOINT.md`, and this interruption checkpoint.
2. Re-verify live `fix/v01-recovery-closure`, PR #55, and current branch list; Git/CI truth overrides this projection if anything moved.
3. Fetch the full logs for CI run `33649460705`, job `100312467323`, and identify the exact failing unit/integration assertion(s).
4. Check the failure against the existing Recovery invariant and, only if relevant, test the stale-`terminalResult` hypothesis above.
5. As Project Lead, create the smallest bounded coordination Task for the regression fix (first task may use `TASK-RC-001` if still unused) and dispatch it to one Worker, rather than turning the Project Lead conversation into a large implementation worker.
6. Worker must make the smallest in-scope fix and validate one exact product commit.
7. Run CI via exact-ref `workflow_dispatch`; do **not** recreate a CI carrier branch.
8. After deterministic CI is green, continue the frozen sequence: crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression.

## Do-not-do constraints

- Do not replan or expand v0.1 scope.
- Do not create backup/work/staging/CI-helper branches; the repository was intentionally reduced to the five current branches.
- Do not recreate `ci/v01-recovery-closure`; use exact-ref workflow dispatch.
- Do not merge PR #55, mark it Ready, or announce release readiness before all Recovery gates pass.
- Do not use old pre-Recovery E2E/Windows artifacts as evidence for a new Recovery snapshot.
- Do not treat `d56bf7c...` or this handoff commit as the validated product SHA.
- Do not turn the unverified `terminalResult` hypothesis into a fact without log/source evidence.
- For uncertain provider/side-effect outcomes, Reconcile first; never authorize blind resend.
