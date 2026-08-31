# Codex Workbench v0.1 Release Candidate Checkpoint

Checkpoint date: **2026-08-31**  
Status: **DETERMINISTIC CLOSURE PASS - CURRENT SNAPSHOT AWAITS REAL SOURCE AND WINDOWS PACKAGED E2E**

## 1. Authoritative release truth

- Repository: `sadary000000/Codex-Workbench`
- Release candidate: Draft PR #50, `release/v0.1-integration` -> `workbench/next`
- Exact current product snapshot: `5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`
- Snapshot branch: `test/v0.1-release-candidate-snapshot`
- Snapshot branch points exactly to the commit above.
- Scope contract: `docs/V0.1-MVP-SCOPE-FREEZE.md`
- Active deterministic protocol: `docs/testing/ACTIVE_TEST.json`

The prior `64a2d810...` snapshot is retired. It predates later Requirement, Planner, Native recovery, UI, and workspace-write production changes and is not a valid v0.1 release target.

## 2. Frozen v0.1 scope

v0.1 contains:

1. normal Codex-native conversation and coding behavior;
2. Product Project management and restart persistence;
3. usable Conversation Map and Project Map;
4. one understandable Automation path from Requirement through Plan, Execute, Verify, Review/Gate, Advance, and Complete;
5. explicitly user-confirmed, current-workspace-bounded Native file writes for RECONCILABLE Automation Steps;
6. a runnable Windows package and real packaged end-to-end validation.

Manual governance clicks remain acceptable. Attention Center, continuous autonomous execution, automatic Replan UX, standalone Workflow Map, parallel scheduling, expanded provider UI, cloud/team features, updater productization, and other nonessential systems remain deferred.

## 3. Workspace-write closure

Commit `5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf` adds the reviewed v0.1 Native workspace-write contract.

Safety invariants:

- ordinary Native execution remains Codex-owned;
- PURE Steps remain read-only;
- workspace write is available only to `STEP_EXECUTION` with side-effect class `RECONCILABLE`;
- the exact persisted ActionIntent must carry `workspaceWrite=true` and `sideEffectApproval=USER_CONFIRMED`;
- missing confirmation fails before execution records or Native dispatch;
- IDEMPOTENT and NON_REPEATABLE writable Steps remain unsupported in v0.1;
- network access and data egress remain disabled;
- writable roots are constrained to the current Native Thread workspace;
- Planner and Requirement RECONCILABLE requests are never upgraded to workspace-write authority.

## 4. Deterministic evidence

Workspace-write integration workflow:

- run: `33365713285`
- job: `99405819227`
- result: PASS
- dependency install: PASS
- Typecheck: PASS
- focused workspace-write tests: PASS
- full repository tests: PASS
- Build: PASS
- verified commit produced by the workflow: `5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`

The ordinary pull-request workflow for the bot-created commit produced `action_required` with zero jobs. This is an Actions event-authority condition, not a failing test. The dedicated runner verified the exact resulting product/source-and-test tree before committing it.

## 5. Current release-route status

- Integration: **PASS**
- Minimal UI cleanup and Chinese Automation UI: **PASS**
- Requirement/Planner/Native recovery hardening: **PASS deterministic**
- User-confirmed bounded workspace-write: **PASS deterministic**
- Exact product snapshot frozen: **PASS**
- Full deterministic gate: **PASS**
- Current Source Real E2E: **ENVIRONMENT_BLOCKED** (run `33367529964`; runner had no Codex credentials)
- Windows package build/static contract: **PASS** (run `33367825291`; exact-snapshot artifact produced)
- Current Windows packaged Real E2E: **REQUIRED after authenticated Source pass**
- Concrete bug fixes: **only if a real gate exposes a defect**
- Final regression: **required after both real gates and any fixes**
- User trial handoff and v0.1 publication: **pending**

## 6. Latest external gate attempts

Source Real E2E attempt:

- exact product snapshot: `5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`
- workflow run: `33367529964`
- job: `99411188941`
- result: `ENVIRONMENT_BLOCKED`
- `OPENAI_API_KEY_PRESENT=false`
- `codex login status`: `Not logged in`
- harness result: `FAIL` at the first Native Turn with `NATIVE_TURN_TERMINAL_FAILURE:failed`
- classification: no product defect established; rerun requires a valid authenticated Codex runtime

Windows static package candidate:

- workflow run: `33367825291`
- job: `99412083132`
- result: PASS
- exact product snapshot packaged: `5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`
- artifact: `codex-workbench-v0.1-windows-5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`
- workspace-write packaged module and durable user-confirmation markers: PASS
- this is a package build/static-contract result, not packaged `PASS_REAL`

## 6. Required real gates

On a real host with a working, authenticated Codex runtime, check out exactly:

```
5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf
```

Run:

```bash
npm run test:real:v0.1
```

Required evidence:

- `dist/e2e/v01-real-e2e.json`
- result `PASS_REAL`
- exact tested commit `5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`

After Source passes, on a real Windows host run:

```bash
npm run test:real:v0.1:package
```

Required evidence:

- `dist/e2e/v01-package-e2e.json`
- package result `PACKAGE PASS`
- runtime result `PASS_REAL`
- exact tested commit `5fdba2688cdf4b2c4488166ddf0ccb2577e17fcf`

The acceptance path must cover Product Project, Native conversation/read, Maps, AutomationProject association, Requirement confirmation, Planner, PURE and user-confirmed workspace-write execution as applicable, reconciliation, verification, review/gate, completion, and close/reopen persistence.

## 8. Failure and snapshot policy

If a real gate fails:

1. fix only the concrete frozen-acceptance defect;
2. add a focused deterministic regression;
3. rerun dependency install, Typecheck, full tests, and Build;
4. create a new exact product snapshot if production code changed;
5. rerun the affected real gates on that new snapshot;
6. never reuse evidence from an older implementation commit.

## 9. Final regression and publication

After both current real gates pass:

1. rerun the full deterministic gate on the exact tested snapshot;
2. update Source and package evidence files with immutable exact-commit provenance;
3. update this checkpoint and `CURRENT_CHECKPOINT.md`;
4. perform the Windows user-trial handoff;
5. only after explicit approval, mark PR #50 ready, consolidate the stacked Draft PR chain, merge, tag, and create the v0.1 release.

This environment can maintain the repository and inspect GitHub Actions, but it cannot manufacture a truthful authenticated Windows desktop `PASS_REAL`. The real gates require an actual authenticated Codex runtime and Windows package host.
