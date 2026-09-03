# Current Workbench Checkpoint

Resume mode: **INTERRUPTED**

Current durable resume index:

- primary durable checkpoint: `docs/workbench-map/INTERRUPTED_CHECKPOINT.md`
- underlying stage checkpoint: `docs/workbench-map/V0_1_RECOVERY_CLOSURE_CHECKPOINT.md`
- scope contract: `docs/V0.1-MVP-SCOPE-FREEZE.md`
- current workstream: **v0.1 Recovery Closure**
- release integration base: `release/v0.1-integration` at `6897c29885bd9076f440ab20275f90b59348bde5`
- active implementation branch: `fix/v01-recovery-closure`
- branch HEAD immediately before the interruption-handoff documentation commits: `d56bf7c7ebbdb76ccc7c9fbfa81b58a7ed7c9502`
- last validated Recovery **product-code snapshot**: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- product integration PR: Draft PR #55 -> `release/v0.1-integration`; OPEN, not merged
- former CI carrier PR #56: CLOSED, NOT MERGED; `ci/v01-recovery-closure` has been deleted
- exact-SHA CI should now use `.github/workflows/ci.yml` `workflow_dispatch` with `ref`; do not recreate a CI carrier branch
- latest product CI: run `33649460705`, job `100312467323`, on exact product snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- CI truth: checkout PASS, `npm ci` PASS, Typecheck PASS, Unit/integration tests **FAIL**, Build **SKIPPED**
- release status: **IN PROGRESS / NOT RELEASE READY**
- current blocker: exact unit/integration failure from run `33649460705` has not yet been fixed
- exact next action: fetch job `100312467323` full logs, identify the failing assertion, then Project Lead creates the smallest bounded Worker Task for the regression fix
- after deterministic CI is green, frozen continuation order remains: crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression

Coordination state:

- coordination root: `docs/workbench-coordination/`
- fixed Project Lead role is active
- lightweight coordination protocol landed at `10d493a53c318e64679da4223d85354b5254d1bd`
- `TASK_BOARD.md` currently has no delegated tasks
- use dynamic task-defined Workers; do not create permanent Backend/Tester/Architect roles by default

Repository cleanup state:

- remote branches intentionally reduced to exactly: `main`, `codex/workbench-v1`, `workbench/next`, `release/v0.1-integration`, `fix/v01-recovery-closure`
- historical `codex/test-results` evidence is preserved at tag `archive/codex-test-results-20260903` -> `f5afa66b7313b35afa818bd3c0f89616c711e78a`
- successful one-time branch-cleanup run: `33697961829`
- cleanup/coordination/docs commits after `1e9d2ea...` are not newer validated Recovery product snapshots

Do not replan the project or expand v0.1 scope. Do not merge PR #55, mark it ready, recreate helper/CI branches, or reuse older pre-Recovery E2E evidence as proof for the current Recovery product snapshot. Read `INTERRUPTED_CHECKPOINT.md` first for the exact resume sequence and the explicitly unverified debugging hypothesis.
