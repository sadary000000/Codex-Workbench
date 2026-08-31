# Current Workbench Checkpoint

Current durable resume index:

- durable checkpoint: `docs/workbench-map/V0_1_RELEASE_CANDIDATE_CHECKPOINT.md`
- scope contract: `docs/V0.1-MVP-SCOPE-FREEZE.md`
- current release candidate: Draft PR #50, branch `release/v0.1-integration`
- exact current product snapshot: `5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`
- frozen product snapshot branch: `test/v0.1-release-candidate-snapshot`
- workspace-write integration: PASS, commit `5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`
- deterministic full gate: run `33365713285`, job `99405819227`, PASS
- gate contents: `npm ci`, Typecheck, focused workspace-write regression, all repository tests, and Build
- current Source Real E2E attempt: `ENVIRONMENT_BLOCKED`, run `33367529964`, job `99411188941`; `OPENAI_API_KEY` was empty and Codex was not logged in
- Windows package static candidate: PASS, run `33367825291`, job `99412083132`, artifact `codex-workbench-v0.1-windows-5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`
- immediate blocking gates: provide authenticated Codex credentials, rerun Source Real E2E, then Windows packaged Real E2E on the same snapshot, then final regression
- scope-freeze origin: PR #49 `docs/v0.1-mvp-scope-freeze`

The ordinary PR workflow attached to the bot-created product commit reported `action_required` without starting jobs. This is not a test failure; the product tree was verified by the dedicated workspace-write runner before it created the commit.

Historical Real Source and packaged E2E evidence applies only to older product commits and must not be used as the current release gate.

Do not add v0.1 scope. Do not merge, delete branches, force-push, close PRs, or mark the Draft PR ready until the current Source Real E2E, Windows packaged E2E, and final regression all pass.
