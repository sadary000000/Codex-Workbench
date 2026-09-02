# v0.1 Recovery Closure Checkpoint

Generated at: 2026-09-03 00:37 UTC+8

Status: **IN PROGRESS / NOT RELEASE READY**

## 1. Frozen scope

This checkpoint covers only the already-approved **v0.1 Recovery Closure**:

> Reuse the existing `ActionIntent / ActionAttempt / ExecutionAttempt / RecoveryCandidate / SideEffectClass / Reconcile` truth model; derive recovery through the single backend Governance Projection; complete safe Retry/new-attempt handling and deterministic catch-up from existing durable truth; and ensure supported abnormal states resolve to Normal, Recoverable, or Explicitly Blocked instead of a dead state.

Still out of scope: a second recovery runtime/state machine, force-skip validation, fabricated Evidence, generic repair DSL, AI-guessed database repairs, blind retry of uncertain side effects, retry schedulers, and larger post-v0.1 Automation expansion.

## 2. Current Git refs

- release integration base: `release/v0.1-integration`
- base commit: `6897c29885bd9076f440ab20275f90b59348bde5`
- recovery implementation branch: `fix/v01-recovery-closure`
- current recovery **product-code snapshot**: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- recovery integration PR: Draft PR #55 `Fix v0.1 recovery closure and crash catch-up`
- PR #55 target: `release/v0.1-integration`
- CI carrier: Draft PR #56 `CI only: validate v0.1 recovery closure`; do not merge this carrier into `workbench/next`

At product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`, the Recovery implementation is **12 commits ahead / 0 behind** relative to `release/v0.1-integration`, with **9 Recovery implementation/test files changed, +1229 / -25**.

The live `fix/v01-recovery-closure` branch HEAD can be newer than that product-code snapshot because checkpoint/handoff documentation is intentionally committed afterward. New sessions must verify live refs and distinguish docs-only descendants from the exact code SHA that owns a validation result.

## 3. Implemented so far

The product snapshot contains the bounded Recovery Closure implementation work:

1. **Recovery governance is derived from existing workflow truth.** Recovery remains an extension of Governance Projection rather than a second persisted recovery state machine.
2. **Safe Retry creates new history instead of rewriting old history.** The recovery path creates a new attempt/intent lineage while preserving failed or uncertain prior attempts and respecting side-effect safety.
3. **Reconcile remains first for uncertain provider outcomes.** Missing Native provider request identity can be recovered by correlation before reconcile; ambiguous or unsafe cases are not blindly re-dispatched.
4. **Deterministic catch-up is local-only.** Runtime catch-up consumes already-persisted durable truth/evidence and does not call the model/provider or fabricate verification/review Evidence.
5. **Governance/renderer recovery actions are exposed through the backend-projected contract.** The latest product-code commit exposes Retry and Explicitly Blocked recovery handling in the governance UI rather than inventing eligibility in the renderer.
6. **Focused recovery coverage was added.** `tests/v01-step-recovery-closure.test.ts` covers the Recovery Closure path and crash/restart-oriented cases introduced by this work.

Recovery implementation/test file delta at the product snapshot:

- `src/automation/deterministic-recovery-catch-up.ts` — added
- `src/automation/recovering-governance-service.ts` — added
- `src/automation/step-recovery-policy.ts` — added
- `src/automation/step-execution-service.ts` — modified
- `src/automation/provider-binding-port.ts` — modified
- `src/main/automation-provider-host.ts` — modified
- `src/shared/automation-governance-types.ts` — modified
- `src/renderer/automation-governance-actions.ts` — modified
- `tests/v01-step-recovery-closure.test.ts` — added

## 4. Current validation truth

Latest CI validation is against the exact recovery product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782` through CI carrier PR #56.

GitHub Actions run: `33649460705`

- checkout exact ref: PASS
- `npm ci`: PASS
- Typecheck: **PASS**
- Unit and integration tests: **FAIL**
- Build: **SKIPPED because tests failed**

Therefore this product snapshot is **not** a releasable candidate and must not be represented as green.

The current blocking category is the unit/integration regression after the latest recovery/UI exposure work. Until that suite is green, no claim should be made that Build, crash/restart E2E, Source Real E2E, Windows packaged E2E, or final regression has passed for this recovery snapshot.

## 5. Release gates not yet completed for this snapshot

The following gates remain pending for the Recovery Closure snapshot:

1. fix the current unit/integration regression on `fix/v01-recovery-closure`
2. rerun CI and require Typecheck + Unit/integration tests + Build PASS on one exact product snapshot
3. run focused crash/restart Recovery Closure E2E on that same snapshot
4. run authenticated Source Real E2E on that same snapshot
5. run Windows packaged Real E2E on that same snapshot
6. run final regression on that same snapshot
7. only after all gates are green, integrate through the existing v0.1 release route

Do not skip directly to packaging or reuse old E2E evidence from pre-Recovery snapshots as proof for the new product snapshot.

## 6. Immediate resume sequence

When resuming work, do **not** replan the project or expand v0.1 scope.

Resume exactly here:

1. read `docs/workbench-map/HANDOFF.md` and `docs/workbench-map/CURRENT_CHECKPOINT.md`
2. verify the live `fix/v01-recovery-closure` ref and separate docs-only commits from the exact product-code snapshot being validated
3. inspect CI run `33649460705`, especially the Unit and integration tests failure on product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
4. make the smallest bounded fix needed to restore the test contract without weakening Recovery Closure invariants
5. rerun CI on the exact resulting product commit
6. once deterministic CI is green, continue the frozen order: crash/restart E2E -> Source Real E2E -> Windows packaged E2E -> final regression

The core invariant remains:

`NormalActions.anyAllowed || RecoveryActions.anyAllowed || Recovery.status === BLOCKED`

A supported current Step must never end with all normal actions unavailable, all recovery actions unavailable, and no explicit blocked reason.

## 7. Historical release context

`docs/workbench-map/V0_1_RELEASE_CANDIDATE_CHECKPOINT.md` is still useful as the pre-Recovery release history, but it is no longer the current resume point. Recovery Closure was inserted before the remaining v0.1 Real E2E / Windows packaged E2E / final regression gates because strict validation without a legal recovery exit produced dead-state risk.

Do not merge PR #55, mark it ready, or advance the release candidate until the Recovery Closure validation sequence above is green.
