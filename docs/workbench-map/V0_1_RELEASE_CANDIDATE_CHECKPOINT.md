# Codex Workbench v0.1 Release Candidate Checkpoint

Checkpoint date: **2026-08-30**
Status: **DETERMINISTIC CLOSURE PASS — CURRENT PRODUCT SNAPSHOT AWAITS REAL SOURCE + PACKAGED E2E RE-RUN**

Git refs, PR metadata, and repository contents are authoritative. This checkpoint preserves the frozen v0.1 scope and records the exact current product snapshot separately from later test/control-plane/documentation commits.

## 1. Repository truth

- Repository: `sadary000000/Codex-Workbench`
- Current release candidate: Draft PR #50, branch `release/v0.1-integration`, base `workbench/next`
- Current exact product implementation snapshot: `64a2d810244b9e8c9b3871c576c772b517922df0`
- Frozen product test branch: `test/v0.1-release-candidate-snapshot`
- The snapshot branch currently points exactly to `64a2d810244b9e8c9b3871c576c772b517922df0`.
- The release branch is allowed to be ahead of that snapshot with test/control-plane/checkpoint-only commits. Before treating any later release-branch head as the same product snapshot, compare it against `64a2d810...` and confirm there is no production/runtime delta.
- Scope-freeze origin remains PR #49 `docs/v0.1-mvp-scope-freeze`.
- No merge, branch deletion, force-push, PR close, or ready-for-review transition is authorized by this checkpoint.

## 2. Frozen v0.1 scope

Read `docs/V0.1-MVP-SCOPE-FREEZE.md` before changing product scope.

v0.1 requires only:

1. normal Codex-native conversation/coding;
2. Product Project management and restart persistence;
3. usable basic Conversation Map / Project Map;
4. an understandable Automation path: `goal -> Requirement -> Plan -> Execute -> Reconcile if needed -> Verify -> Review/Gate -> Advance -> Complete`;
5. a runnable Windows package and packaged end-to-end validation.

Manual clicks between Automation governance stages remain acceptable.

Deferred remain fully autonomous continuous execution, Attention Center, user-facing Requirement Change/automatic Replan UX, standalone Workflow Map, parallel scheduling, generalized hardware/deployment/GUI adapters, expanded multi-provider UI, cloud/team, enterprise permissions, advanced backup UI, updater productization, and other systems not required by the frozen acceptance path.

Scope rule: if a proposed change is not needed to make the frozen acceptance path complete, understandable, reliable, or packageable, defer it.

## 3. Frozen architecture invariants

- Native Thread/Turn/Item is Codex Runtime Truth.
- Workbench does not own a second Native transcript/context manager/sandbox/tool executor/subagent runtime.
- Ordinary Native execution reuses Codex-native runtime behavior.
- Product Project and AutomationProject are distinct identities with explicit association.
- RequirementVersion / PlanVersion and governance remain Workbench workflow truth.
- Map is projection/governance, not Runtime Truth.
- Unknown external-provider side effect requires reconciliation of the exact request identity; never blind resend.
- Optional Workbench features must not contaminate ordinary Native Codex context unless explicitly activated.

## 4. Integrated release path already closed deterministically

The release candidate already contains and has deterministic regression coverage for:

- coherent PR #50 integration;
- minimal Automation Workflow UI cleanup;
- real Electron/CDP v0.1 E2E harness;
- Native target canonicalization (`native-thread-v1:*`);
- conservative first-Requirement PolicyVersion bootstrap;
- Requirement and Planner provider-binding ownership fixes;
- provider-neutral Requirement carrier decoding only at the executable provider boundary;
- explicit Conversation Map and Project Map enable/usability assertions in Real E2E;
- Windows Codex resolution that survives E2E-isolated `APPDATA` while retaining strict binary SHA provenance;
- Planner production prompt/InputRef composition;
- AutomationProject lifecycle projection through planning/ready/running;
- Planner reconcile projection to `READY` after `PLAN_READY`;
- Planner ephemeral InputRef retention across non-terminal recovery/retry and release after terminal outcome;
- validation of the exact active `CONFIRMED` Requirement before project lifecycle advances to planning.

The focused Planner recovery regression is `tests/v01-planner-facade-recovery.test.ts`.

## 5. Current exact product snapshot and deterministic evidence

Exact product snapshot:

- `64a2d810244b9e8c9b3871c576c772b517922df0`
- commit message: `Test: complete confirmed Requirement planner fixture`
- snapshot branch: `test/v0.1-release-candidate-snapshot`

Deterministic CI for that exact snapshot:

- workflow run: `33289482948`
- job: `99198461570`
- `npm ci`: PASS
- Typecheck: PASS
- full repository tests: PASS
- Build: PASS

A later compare from `64a2d810...` to release head `5c16c6d1ea4065f5beb7ec1e7bd57932050eb1f9` showed only these files changed:

- `docs/testing/ACTIVE_TEST.json`
- `docs/testing/DEFERRED_TESTS.json`
- `tests/codex-test-bootstrap-contract.test.ts`
- `tests/official-cli-contract.test.ts`

No production/runtime file changed in that range.

## 6. Independent Codex test control plane

The active blocking exact-head validation is now bound to the stable product snapshot rather than the moving release branch:

- active test id: `v01-release-candidate-exact-head-validation-v1`
- profile: `repository-exact-head-validation`
- branch: `test/v0.1-release-candidate-snapshot`
- exact commit: `64a2d810244b9e8c9b3871c576c772b517922df0`
- result scope: exact tested commit

Control-plane commit:

- `37bb16a1953bb9d5dc15b7e5409eb16d4943f17e`
- CI run `33289580204`
- job `99198727063`
- dependency install / Typecheck / full tests / Build: PASS

`docs/testing/DEFERRED_TESTS.json` is synchronized with the PR #46/#47 Native A/B protocol v1.2 debt:

- resolved Case 1 is warmup-only and must not be rerun as a formal trial;
- unresolved formal debt remains `AB-READ-002-package-contract` and `AB-READ-003-source-contract`;
- external `usageLimitExceeded` / workspace-capacity exhaustion is pause/checkpoint, not a semantic failure;
- historical published evidence remains immutable.

The repository exact-head Codex runbook is a deterministic correctness/architecture gate. It is not a substitute for the real authenticated Codex Source E2E or Windows packaged E2E gates below.

## 7. Windows package static contract

Packaging remains:

- `npm run package:win`
- packaged acceptance: `npm run test:real:v0.1:package`

`scripts/package-win.mjs` assembles:

- `dist/package/Codex Workbench V1.exe`
- `dist/package/resources/app` with compiled runtime payload and minimal package manifest;
- `dist/package/Codex Workbench CLI Runtime.exe`;
- `dist/package/Codex Workbench CLI.exe` compiled with Windows `csc.exe`;
- removal of Electron `resources/default_app.asar`.

`tests/official-cli-contract.test.ts` now deterministically locks the GUI executable, CLI wrapper/runtime separation, official CLI routing to the GUI host, and `resources/app` assembly contract. No packaging runtime behavior was changed for this test closure.

Package-contract test commit:

- `5c16c6d1ea4065f5beb7ec1e7bd57932050eb1f9`
- CI run `33289669604`
- job `99198967921`
- dependency install / Typecheck / full tests / Build: PASS

## 8. Historical Real E2E evidence and current gate validity

Tracked historical evidence exists and is valid for exact implementation commit `0c6871f83d8d3a92ec2a369d40df025e1aaecc8a` only:

- `docs/V0_1_REAL_SOURCE_E2E_EVIDENCE.json`: `PASS_REAL`
- `docs/V0_1_REAL_PACKAGE_E2E_EVIDENCE.json`: `PACKAGE PASS` + `PASS_REAL`

Those runs completed the frozen acceptance path through restart/persistence on a real authenticated Codex/Windows host.

However, after `0c6871f...`, `src/main/automation-execution-facade.ts` changed in the actual Planner/Automation lifecycle acceptance path. A compare from `0c6871f...` to the current release line shows that this Facade file is the only production/runtime file changed after the historical Real E2E, while the remaining changes are evidence/control-plane/checkpoint/tests.

Therefore the historical `PASS_REAL` evidence MUST NOT be presented as satisfying the current `64a2d810...` product snapshot. It remains useful historical evidence that the package/harness/runtime path worked before the Facade hardening.

## 9. Current release-route status

- Integration: **PASS**
- Minimal UI cleanup: **PASS**
- Native/provider/policy/map/Windows resolver blocker cleanup: **PASS**
- Planner Facade/lifecycle recovery hardening: **PASS deterministic**
- Exact product snapshot frozen: **PASS** (`64a2d810...`)
- Independent Codex control plane rebound: **PASS deterministic**
- Windows package static contract: **PASS deterministic**
- Historical Source Real E2E on `0c6871f...`: **PASS_REAL, historical only**
- Historical Windows packaged E2E on `0c6871f...`: **PASS_REAL, historical only**
- Current Source Real E2E on `64a2d810...`: **RE-RUN REQUIRED**
- Current Windows packaged E2E on `64a2d810...`: **RE-RUN REQUIRED after Source pass**
- Concrete bugfixes: **only if those gates expose an acceptance defect**
- Final regression: **after final real-gate result / any concrete fix**
- User trial handoff: **after current packaged E2E pass and final regression**

## 10. Real E2E commands and evidence

On a real host with a working/authenticated Codex runtime, check out or detach exactly at `64a2d810244b9e8c9b3871c576c772b517922df0` and run:

```bash
npm run test:real:v0.1
```

Expected local evidence:

- `dist/e2e/v01-real-e2e.json`
- result `PASS_REAL`

Then on real Windows:

```bash
npm run test:real:v0.1:package
```

Expected local evidence:

- `dist/e2e/v01-package-e2e.json`
- package `PACKAGE PASS`
- result `PASS_REAL`

If either fails, fix only the concrete frozen-acceptance defect, add a focused deterministic regression, rerun deterministic CI and the affected Real E2E, then create/rebind a new exact product snapshot if production code changed.

This ChatGPT execution environment does not provide a real authenticated Windows Codex desktop host, so it cannot truthfully manufacture those two current `PASS_REAL` results.

## 11. Immediate resume sequence

1. Read `docs/workbench-map/CURRENT_CHECKPOINT.md`, this file, and `docs/V0.1-MVP-SCOPE-FREEZE.md` from PR #50.
2. Verify PR #50 state/head and the snapshot ref `test/v0.1-release-candidate-snapshot`.
3. Treat `64a2d810244b9e8c9b3871c576c772b517922df0` as the exact current product implementation unless a later compare proves a production/runtime delta.
4. Do not reopen historical K1-K8 implementation sequencing.
5. Do not repeat already-passed formal Native A/B Case 1.
6. Immediate external release gate: run `npm run test:real:v0.1` on exact snapshot `64a2d810...` with a real authenticated Codex runtime.
7. If Source passes, run `npm run test:real:v0.1:package` on exact snapshot `64a2d810...` on Windows.
8. If a real gate fails, make only concrete acceptance-path fixes and add focused regression coverage; no speculative scope expansion.
9. After both current Real E2E gates pass, run final deterministic regression and update this checkpoint/evidence to the exact tested product snapshot.
10. Keep unresolved A/B v1.2 debt on its frozen execution target unless release-candidate validation explicitly resumes it.
11. Do not merge PRs, delete branches, force-push, close PRs, or mark Draft PRs ready without explicit user approval.
