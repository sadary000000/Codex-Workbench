# Current Workbench Checkpoint

Current durable resume index:

- durable checkpoint: `docs/workbench-map/V0_1_RECOVERY_CLOSURE_CHECKPOINT.md`
- scope contract: `docs/V0.1-MVP-SCOPE-FREEZE.md`
- current workstream: **v0.1 Recovery Closure**
- release integration base: `release/v0.1-integration` at `6897c29885bd9076f440ab20275f90b59348bde5`
- recovery implementation branch: `fix/v01-recovery-closure`
- exact current recovery product snapshot: `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- recovery integration PR: Draft PR #55 -> `release/v0.1-integration`
- CI carrier: Draft PR #56 -> `workbench/next`; CI carrier only, do not merge
- branch delta from integration base: 12 commits ahead, 0 behind; 9 changed files; +1229 / -25
- latest CI: run `33649460705` on exact snapshot `1e9d2ea15da176d3744c35bd833bfd4a29b56782`
- CI truth: `npm ci` PASS, Typecheck PASS, Unit/integration tests FAIL, Build SKIPPED
- release status: **NOT READY**; no Recovery-snapshot crash/restart E2E, Source Real E2E, Windows packaged E2E, or final regression PASS yet
- immediate blocking task: fix the current unit/integration regression without weakening Recovery Closure invariants, then rerun deterministic CI on one exact snapshot
- frozen continuation order after CI is green: crash/restart Recovery E2E -> authenticated Source Real E2E -> Windows packaged Real E2E -> final regression
- previous release checkpoint: `docs/workbench-map/V0_1_RELEASE_CANDIDATE_CHECKPOINT.md` is historical context only, not the current resume point

Do not replan the project or expand v0.1 scope. Do not merge PR #55, mark it ready, or reuse older pre-Recovery E2E evidence as proof for the current Recovery product snapshot until the current validation sequence is green.
