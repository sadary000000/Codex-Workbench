# Codex Workbench v0.1 Release Candidate Checkpoint

Checkpoint date: **2026-08-30**
Status: **ACTIVE RESUME INDEX — REAL SOURCE E2E IS THE NEXT GATE**

Git refs, PR metadata, and repository contents are authoritative. This checkpoint advances the durable resume route from the original PR #49 scope-freeze handoff to the current integrated release candidate. The frozen v0.1 scope itself is unchanged.

## 1. Repository truth

- Repository: `sadary000000/Codex-Workbench`
- Default/stable branch: `codex/workbench-v1`
- Current release candidate: PR #50, `release/v0.1-integration`
- PR #50 base: `workbench/next`
- PR #50 base SHA at this checkpoint: `ab4423930f8cc633aee0edb21a1172bf59754991`
- PR #50 exact candidate head **before this checkpoint update**: `7ebba91723ad00c966e179420400f6b47cd3a978`
- PR #50 state: Draft / open / unmerged / mergeable
- Product-line origin remains PR #48, `feature/automation-project-create-associate`, exact historical endpoint `68faf1ce38c1bd39aadcad3ed3d6382fd3d8a599`
- Scope-freeze origin remains PR #49, `docs/v0.1-mvp-scope-freeze`
- No merge, branch deletion, force-push, PR close, or ready-for-review transition is authorized by this checkpoint.

## 2. Frozen v0.1 scope remains authoritative

Read `docs/V0.1-MVP-SCOPE-FREEZE.md` before changing product scope.

v0.1 still requires only:

1. normal Codex-native conversation/coding behavior;
2. Product Project management and restart persistence;
3. usable basic Conversation Map / Project Map;
4. one understandable Automation path from goal -> Requirement -> Plan -> Execute -> Reconcile if needed -> Verify -> Review/Gate -> Advance -> Complete;
5. a real runnable Windows package and packaged end-to-end validation.

Manual user clicks between Automation governance stages remain acceptable.

Deferred beyond v0.1 remain fully autonomous continuous execution, Attention Center, user-facing Requirement Change/automatic Replan UX, standalone Workflow Map, parallel scheduling, generalized hardware/deployment/GUI adapters, expanded multi-provider UI, cloud/team features, enterprise permissions, advanced backup UI, updater productization, and other large systems not required by the frozen acceptance path.

Scope-control rule: if a proposed change is not required to make the frozen acceptance path complete, understandable, reliable, or packageable, defer it.

## 3. Architecture invariants remain frozen

- Native Thread/Turn/Item is Codex Runtime Truth.
- Workbench does not own a second Native transcript.
- Workbench does not implement a second Native context manager, sandbox, tool executor, or subagent runtime.
- Ordinary Native execution reuses Codex-native runtime/harness behavior.
- Product Project and AutomationProject remain distinct identities with explicit association.
- unlink association != delete AutomationProject.
- RequirementVersion / PlanVersion and governance state remain Workbench workflow truth.
- Map remains projection/governance increment, not Runtime Truth.
- unknown external-provider side effect -> reconcile exact request identity; never blind resend.
- optional Workbench features must not contaminate ordinary Native Codex context unless explicitly activated.

## 4. Integration stage — complete

PR #50 was created as the coherent v0.1 candidate instead of merging or rewriting the historical stacked PRs.

The integration-only delta after PR #49 synchronized stable repository-test bootstrap/control files into the candidate without changing product runtime behavior. Initial candidate commit:

- `59294a785f111517bb5af488b8896697679d0fc3`
- message: `Release: synchronize stable test bootstrap into v0.1 candidate`

CI run `33263782548`, job `99130093172`, passed checkout exact ref, `npm ci`, Typecheck, full repository tests, and Build.

Integration is therefore closed unless Real E2E exposes a concrete integration defect.

## 5. Minimal UI cleanup — complete

Static acceptance-path review found one concrete understandability defect: the shared Automation launcher still described itself as a read-only `Governance Inspector` even though Requirement/Planner and mutating Governance Actions had subsequently been attached to the same surface.

The candidate now uses presentation-only v0.1 workflow guidance:

- launcher title: `Automation Workflow`
- `状态 / 证据`
- `1 · Requirement / Plan`
- `2 · Execute / Review / Complete`
- bounded flow guidance: Requirement/Plan -> Execute -> Reconcile if needed -> Verify -> Review -> Gate -> Advance -> Complete

The cleanup does not add a renderer lifecycle state machine, does not change backend action legality, and does not change Native runtime/provider semantics.

Candidate head after this cleanup was `eddb0964d20c1cf3e3ae0c2c5bc565e54326b788`. CI run `33263890236`, job `99130374937`, passed dependency install, Typecheck, full repository tests, and Build.

## 6. Real E2E harness — ready

The repository has one current frozen-v0.1 E2E harness:

- `scripts/v01-real-e2e.mjs`
- focused contract: `tests/v01-real-e2e-harness.test.ts`
- source command: `npm run test:real:v0.1`
- packaged command: `npm run test:real:v0.1:package`

The harness deliberately does **not** reuse historical AUT-2/AUT-3/K1-D stage-gate environment hooks as the product path. It launches the real Electron application, connects to the real renderer through Chromium DevTools Protocol, and invokes the existing `window.codexWorkbenchV1` preload API. This preserves the renderer-owned USER confirmation boundary instead of exposing Requirement confirmation through the generic Automation Control Plane.

The source and packaged modes drive the same acceptance sequence:

1. launch Workbench with isolated app data;
2. create a real temporary local Git repository and Product Project;
3. create a Native Thread;
4. run a normal read-only Codex Turn against the fixture `package.json`;
5. explicitly enable Conversation Map and Project Map and require each result to be `available=true`, `enabled=true`, with a non-null persisted map projection;
6. create and associate an AutomationProject;
7. start Requirement alignment on the exact Native Thread;
8. answer any returned Requirement questions through the USER renderer API;
9. confirm the exact RequirementVersion + payload SHA-256;
10. run Planner on the exact Native Thread;
11. execute the current PURE/read-only Step, reconcile if required;
12. run deterministic HASH_MATCH verification;
13. approve Step Review;
14. PASS Stage Gate and advance until plan completion-ready;
15. complete the AutomationProject;
16. close and relaunch Workbench;
17. confirm Product Project, Native Thread binding/resume, Automation association, completed workflow state, and Project Map governance references survive restart.

The current Native Automation execution slice is intentionally PURE/read-only. The E2E fixture therefore uses a read-only package inspection Step and the already-implemented HASH_MATCH verifier path. Frozen expected final Step marker:

- result: `V01_AUTOMATION_E2E_OK`
- SHA-256: `c24dfa0cb5e7111c0237b6a7df34feb3a8ebff68cd1c8aa4060d189fe9fd1474`

The harness is test infrastructure only. It does not add product runtime capability.

## 7. Pre-Real-E2E acceptance blockers closed on PR #50

Static production-path review before the first real-model run found and closed the following concrete defects. These are bug fixes inside the frozen acceptance path, not new v0.1 product scope.

### 7.1 Native target canonicalization

Renderer-facing Automation actions naturally supply the raw Native Thread runtime id, while the Native provider contract accepts the versioned `native-thread-v1:<encoded-id>` target.

`AutomationExecutionFacade` now canonicalizes raw Native Thread ids at the main-process new-work boundary for Requirement, Planner, and Step execution. Already-versioned Native targets are idempotent and non-Native provider targets are unchanged.

This keeps Runtime Truth in the renderer/native runtime while provider encoding remains a composition concern.

### 7.2 Conservative policy bootstrap for a fresh AutomationProject

A newly-created AutomationProject intentionally begins without a PolicyVersion, but executable Requirement dispatch requires a pinned policy.

Before the first new Requirement session is persisted, `AutomationExecutionFacade` now creates one project PolicyVersion from the existing product hard constraints only when the project has no policy truth. Existing policy is never replaced, contradictory partial policy state fails closed, and the default remains `allowDataEgress=false` / `allowSideEffects=false`.

The policy model still permits ordinary bounded `PROMPT` operations; the disabled flags deny their corresponding `DATA_EGRESS` / `SIDE_EFFECT` operations rather than incorrectly blocking the v0.1 PURE/read-only Native path.

### 7.3 Provider ownership migration for Requirement and Planner

`PersistedProviderBindingPort` is the durable owner of `ActionAttempt.executorRef` for executable provider work. Legacy Requirement and Planner code still pre-filled that field with service-local labels (`automation.requirement-provider` / `automation.planner-provider`), which conflicted with the versioned provider-binding guard before any external side effect.

Requirement initial dispatch plus Planner initial dispatch and explicit retry no longer preclaim that ownership. The strict provider-binding guard remains unchanged. Production-composed regressions exercise the real binding decorator rather than separate mocks.

Step execution was inspected and did not have the same legacy ownership conflict.

### 7.4 Frozen workflow carrier does not leak into the Native provider

Provider-aware Requirement persistence intentionally encodes provider-neutral scope/target identities into versioned `automation-workflow-provider-ref-v1:*` envelopes stored in the frozen v4 ExternalRef carrier slots.

The frozen Requirement state machine subsequently reuses those carrier values in Action ledger/recovery truth. Passing them directly to the Native provider would violate the Native provider-owned target contract.

`ProviderAwareRequirementAutomationService` now wraps its executable provider with a compatibility boundary that:

- keeps the workflow carrier intact above the provider boundary;
- decodes `SCOPE` / `TARGET` only when crossing into the executable provider;
- supplies the real `native-thread-v1:*` target/scope to Native execution;
- restores the workflow carrier on accepted observations so upper Action/recovery identity checks remain exact;
- preserves legacy non-neutral v4 refs unchanged;
- preserves optional provider recovery/read/wait/cancel capabilities rather than inventing a second runtime path.

The provider binding guard and recovery rules were not weakened.

Candidate head `2e02ecebb52c3dcc29c9111c5d9dfd1eb1a738cd` passed CI run `33280925188`, job `99175840727`: `npm ci`, Typecheck, all 659 repository tests, and Build.

### 7.5 Map acceptance is now usability, not API existence

A fresh Conversation Map can legitimately report `available=true` while `enabled=false` and `map=null`. The first E2E harness only read Map status, which could therefore pass without proving a usable Map.

The harness now invokes the real renderer/preload `enableMap` and `enableProjectMap` paths and requires both Maps to be available, enabled, and backed by non-null projections. The focused harness contract requires those production calls and assertions.

Exact pre-checkpoint candidate head `7ebba91723ad00c966e179420400f6b47cd3a978` passed CI run `33281010714`, job `99176064512`: `npm ci`, Typecheck, all 659 repository tests, and Build.

At this checkpoint there is no known deterministic acceptance-path blocker remaining. This does **not** claim a real-model E2E PASS.

## 8. Native runtime / safety compatibility check

The shared Native Automation provider continues to reuse the already-attached Workbench Native runtime. It does not create/resume/fork a second runtime trunk.

For Automation turns the shared adapter uses the existing `startTurnAccepted` with:

- `approvalPolicy: "never"`
- read-only sandbox policy

The Native runtime capability used by v0.1 supports `PROMPT`, `RETRY`, and `VERIFY`, with data egress and side effects disabled. This is compatible with the frozen PURE/read-only fixture and the current policy bootstrap.

## 9. Windows package state

The existing package entry remains:

- `npm run package:win`

It builds the application and creates the Windows package under `dist/package`, including `Codex Workbench V1.exe` and the official Workbench CLI executable. Packaging requires a real Windows environment with `csc.exe` available.

The packaged acceptance command is:

- `npm run test:real:v0.1:package`

This first runs the existing Windows packaging path, then runs the same v0.1 E2E harness against `dist/package/Codex Workbench V1.exe`.

No packaged-E2E PASS is claimed yet.

## 10. Current release-route status

- Integration: **deterministic gate PASS**
- Minimal UI Cleanup: **deterministic gate PASS**
- Acceptance-path static blocker cleanup: **deterministic gate PASS**
- Real Source E2E: **harness ready; actual real-model execution pending**
- Windows Packaged E2E: **command ready; execution pending after Source Real E2E**
- Bug Fix: only for concrete defects found by Real/packaged E2E
- Final Regression: pending
- v0.1 release: pending

Do not reopen historical K1-K8 implementation sequencing. Historical AUT/K1 real gates remain evidence/history, not the current release route.

## 11. Test-debt policy

The incremental test-debt policy remains unchanged:

- published historical evidence is immutable / append-only;
- already-passed formal model cases are retired from future formal trial queues;
- unresolved Native A/B debt remains on PR #46/#47;
- cheap deterministic repository/static gates remain;
- new fixes get focused deterministic regression coverage;
- do not rerun expensive already-passed real-model A/B trials merely because the UI or candidate head changed.

PR #46/#47 need to be re-read only when release-candidate test debt becomes relevant. Do not modify `AB-READ-003-source-contract` merely because the historical v1.1 run never reached it.

## 12. Immediate resume sequence

When a new conversation resumes this project:

1. Read `docs/workbench-map/CURRENT_CHECKPOINT.md`, this checkpoint, and `docs/V0.1-MVP-SCOPE-FREEZE.md` from PR #50's current head.
2. Re-read GitHub metadata/head for PR #50. Git refs are authoritative if the branch moved after this checkpoint.
3. Re-read PR #48/#49 only when historical product/scope ancestry is needed; they are no longer the current product endpoint.
4. Treat PR #50 / `release/v0.1-integration` as the current v0.1 release candidate unless newer repository ancestry proves otherwise.
5. Keep the v0.1 Scope Freeze hard. Do not add deferred Automation systems.
6. Do not repeat the already-closed deterministic blocker audit above unless new repository evidence or Real E2E contradicts it.
7. The immediate product task is **Real Source E2E**: run `npm run test:real:v0.1` on a real development host with working Codex runtime/authentication and capture `dist/e2e/v01-real-e2e.json`.
8. If Real Source E2E fails, fix only the concrete acceptance-path defect found, add/update focused deterministic regression coverage, rerun repository gates, and rerun the affected E2E path.
9. After Source Real E2E passes, run `npm run test:real:v0.1:package` on real Windows and capture `dist/e2e/v01-package-e2e.json`.
10. Only after packaged E2E passes, proceed to final regression: Typecheck, focused tests, full repository tests, Build, Windows package, restart/persistence confirmation, and retained release-candidate test debt as explicitly required.
11. Do not merge, delete branches, force-push, close PRs, or mark Draft PRs ready without explicit user approval.
12. Do not restart already-passed expensive formal model trials.

If repository truth contradicts this checkpoint, repository truth wins and this checkpoint should be deliberately advanced again as part of the next durable handoff.
