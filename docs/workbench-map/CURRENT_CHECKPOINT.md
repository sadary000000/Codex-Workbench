# Current Workbench Checkpoint

Current durable resume index:

- primary durable checkpoint: `docs/workbench-map/INTERRUPTED_CHECKPOINT.md`
- underlying stage checkpoint: `docs/workbench-map/V0_1_RECOVERY_CLOSURE_CHECKPOINT.md`
- scope contract: `docs/V0.1-MVP-SCOPE-FREEZE.md`
- current workstream: **v0.1 Recovery Closure**
- release integration base: `release/v0.1-integration` at `6897c29885bd9076f440ab20275f90b59348bde5`
- active product branch: `fix/v01-recovery-closure`
- branch HEAD immediately before the latest docs-only checkpoint: `71f2a347d5cb82f76e385c4207ce23efc3fc4948`
- exact Recovery **product-code snapshot under validation**: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- product integration PR: Draft PR #55 -> `release/v0.1-integration`; OPEN, mergeable at checkpoint time, NOT MERGED
- former CI carrier PR #56: CLOSED, NOT MERGED; `ci/v01-recovery-closure` is absent and must not be recreated
- exact-SHA CI route: `.github/workflows/ci.yml` `workflow_dispatch` with `ref`
- latest validation: run `33649460705`, rerun attempt 2 job `100525705853`, exact SHA `1e9d2ea...`
- CI truth: checkout PASS, `npm ci` PASS, Typecheck PASS, Unit/integration tests **FAIL**, Build **SKIPPED**
- the same Unit/integration stage failed on attempt 1 (`100312467323`) and attempt 2 (`100525705853`), so the regression is reproducible
- release status: **IN PROGRESS / NOT RELEASE READY**
- immediate blocker: exact failing unit/integration assertion(s) still need to be extracted/reproduced before any product-code patch
- bounded debugging lead: stale StepRuntime `terminalResult` on Retry/new-attempt is plausible but **unverified** and does not yet explain the separate restart catch-up test path
- next action: identify the exact failing assertion from job `100525705853` (or exact-SHA local reproduction), then create the smallest bounded Worker Task for the regression fix
- after deterministic CI is green, continue only: `crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression`

Current remote branches remain exactly: `main`, `codex/workbench-v1`, `workbench/next`, `release/v0.1-integration`, `fix/v01-recovery-closure`.

Do not replan or expand v0.1 scope. Do not merge PR #55, mark it ready, recreate helper/CI branches, weaken Recovery invariants, or reuse older pre-Recovery E2E evidence as proof for the current Recovery product snapshot. Read the primary durable checkpoint for the exact `Immediate resume sequence`.
