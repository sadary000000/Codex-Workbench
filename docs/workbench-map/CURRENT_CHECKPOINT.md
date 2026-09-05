# Current Workbench Checkpoint

Updated: 2026-09-05

Current durable resume index:

- primary durable checkpoint: `docs/workbench-map/INTERRUPTED_CHECKPOINT.md`
- underlying stage checkpoint: `docs/workbench-map/V0_1_RECOVERY_CLOSURE_CHECKPOINT.md`
- scope contract: `docs/V0.1-MVP-SCOPE-FREEZE.md`
- current workstream: **v0.1 Recovery Closure**
- release integration base: `release/v0.1-integration` at `6897c29885bd9076f440ab20275f90b59348bde5`
- active product branch: `fix/v01-recovery-closure`
- product integration PR: Draft PR #55 -> `release/v0.1-integration`; OPEN, NOT MERGED
- exact Recovery product-code snapshot whose historical CI is under investigation: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- historical failing CI: run `33649460705`; Typecheck PASS, Unit/integration FAIL, Build SKIPPED; same failure stage on two attempts
- former CI carrier PR #56 remains CLOSED / NOT MERGED; `ci/v01-recovery-closure` must not be recreated
- release status: **IN PROGRESS / NOT RELEASE READY**

## New investigation evidence — 2026-09-05

The owner supplied an external Pro code-level investigation against an archive of coordination HEAD `aeabb4593bb7aee1a747ac463ea52e404de19513`.

Observed in that investigation:

- Node `22.16.0`, npm `10.9.2`;
- full suite reproduced twice as **718 total / 712 PASS / 6 FAIL**, same failures both times;
- five failures are Recovery Closure tests blocked during fixture setup by an invalid Plan/Stage reference; after only that blocker was removed in an external diagnostic copy, one remaining Recovery test fixture failure was invalid empty Evidence correlation;
- the sixth failure is the Native executor target UI source-regex assertion expecting the old literal Execute confirmation while product code now interpolates Execute/Retry via `${verb}`;
- independent diagnostics also reported Recovery runtime defects B02/B03/B04/B07/B09; stale StepRuntime `terminalResult` is now confirmed as a real bug but **not** the direct explanation for the original six failures;
- a positive-control test using valid service-created verification/review Evidence completed deterministic VERIFYING -> REVIEWING -> TERMINAL catch-up without duplicate Evidence.

The Project Lead independently verified live Git/source facts relevant to routing:

- compare `1e9d2ea... -> aeabb459...` is 41 commits ahead / 0 behind and changes only documentation/coordination files, so product and test files used by the Pro archive are unchanged from the historical product snapshot;
- exact-SHA source shows the Plan fixture points `currentStageId` at a Stage created only afterward;
- exact-SHA source shows the catch-up fixture inserts Evidence with empty correlation;
- exact-SHA UI test expects the old literal Execute source string while renderer code uses `${verb}` with the exact-target preflight still present;
- exact-SHA execution code settles terminal observation only when ExecutionAttempt is RUNNING, while the ExecutionAttempt state machine has no terminal exit from RECOVERY_REQUIRED;
- Native runtime code throws TURN_BUSY before dispatch and the current definitive-pre-dispatch classifier does not include that error;
- current runtime capability treats RECOVERY_REQUIRED as globally unavailable before provider Reconcile can read an existing Turn;
- `createExecutionAttempt()` binds a new Attempt by spreading the old StepRuntime without clearing terminalResult.

The Pro archive had no `.git` and is not raw GitHub Actions stdout, so RC-002/RC-003 exact-provenance criteria are not represented as DONE. Their evidence purpose is no longer blocking because source equivalence plus reproducible local failures is sufficient to plan bounded repairs.

## Current Todo route

Immediately claimable in parallel:

1. `RC-004` — repair Recovery Closure fixture validity without weakening validation.
2. `RC-005` — repair the Native executor target UI test contract without changing safe product behavior.

Then:

3. `RC-006` — exact-SHA CI rebaseline after RC-004/005 are accepted.
4. `RC-007` + `RC-008` — parallel bounded Recovery runtime fixes after the rebaseline.
5. `RC-009` -> `RC-010` -> `RC-011` — serialized overlapping execution/Store fixes.
6. `RC-012` — exact-SHA deterministic Typecheck + Unit/integration + Build gate.
7. Only after RC-012 passes: `crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression`.

Do not replan or expand v0.1 scope. Do not merge PR #55, mark it Ready, recreate helper/CI branches, weaken Recovery invariants, fabricate Evidence, or retry uncertain external side effects before Reconcile.
