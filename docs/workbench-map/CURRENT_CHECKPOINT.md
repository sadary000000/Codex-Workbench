# Current Workbench Checkpoint

Current durable resume index:

- durable checkpoint: `docs/workbench-map/V0_1_RELEASE_CANDIDATE_CHECKPOINT.md`
- scope contract: `docs/V0.1-MVP-SCOPE-FREEZE.md`
- current release candidate: Draft PR #50 `release/v0.1-integration`
- exact current product implementation snapshot: `64a2d810244b9e8c9b3871c576c772b517922df0`
- frozen product snapshot branch: `test/v0.1-release-candidate-snapshot`
- deterministic product CI: run `33289482948`, job `99198461570`, all gates PASS
- independent Codex control-plane CI: run `33289580204`, job `99198727063`, all deterministic gates PASS
- package static contract CI: run `33289669604`, job `99198967921`, all deterministic gates PASS
- historical Real Source + Windows packaged E2E evidence is tracked for old commit `0c6871f83d8d3a92ec2a369d40df025e1aaecc8a` only and is not the current release gate because `src/main/automation-execution-facade.ts` changed afterward
- immediate current gates: Source Real E2E on exact snapshot `64a2d810...`, then Windows packaged E2E on the same snapshot, then final regression
- scope-freeze origin: PR #49 `docs/v0.1-mvp-scope-freeze`

The release branch may be ahead of the product snapshot with test/control-plane/checkpoint-only commits. Git refs and a compare against `64a2d810...` are authoritative before treating any newer head as the same product implementation.

Do not merge, delete branches, force-push, close PRs, or mark the Draft PR ready without explicit approval.
