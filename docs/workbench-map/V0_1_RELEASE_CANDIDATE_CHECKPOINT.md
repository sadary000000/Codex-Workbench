# Codex Workbench v0.1 Release Candidate Checkpoint

Checkpoint date: **2026-08-30**
Status: **ACTIVE RESUME INDEX — REAL E2E PENDING**

Git refs, PR metadata, and repository contents are authoritative. This checkpoint advances the durable resume route from the original PR #49 scope-freeze handoff to the current integrated release candidate. The frozen v0.1 scope itself is unchanged.

## 1. Repository truth

- Repository: `sadary000000/Codex-Workbench`
- Default/stable branch: `codex/workbench-v1`
- Current release candidate: PR #50, `release/v0.1-integration`
- PR #50 base: `workbench/next`
- PR #50 base SHA at this checkpoint: `ab4423930f8cc633aee0edb21a1172bf59754991`
- PR #50 exact candidate head **before this checkpoint commit**: `79de8f299fbdc21ea8aa04afbc0485d199456d37`
- PR #50 state at this checkpoint: Draft / open / unmerged / mergeable
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

## 4. Integration stage — complete at deterministic gate

PR #50 was created as the coherent v0.1 candidate instead of merging or rewriting the historical stacked PRs.

The integration-only delta after PR #49 synchronized stable repository-test bootstrap/control files into the candidate without changing product runtime behavior. Initial candidate commit:

- `59294a785f111517bb5af488b8896697679d0fc3`
- message: `Release: synchronize stable test bootstrap into v0.1 candidate`

CI run `33263782548`, job `99130093172`, passed:

- checkout exact ref
- `npm ci`
- Typecheck
- full repository tests
- Build

Integration is therefore closed for the current candidate unless later E2E exposes a real integration defect.

## 5. Minimal UI cleanup — complete at deterministic gate

Static acceptance-path review found one concrete understandability defect: the shared Automation launcher still described itself as a read-only `Governance Inspector` even though Requirement/Planner and mutating Governance Actions had subsequently been attached to the same surface.

The candidate now adds presentation-only v0.1 guidance:

- launcher title: `Automation Workflow`
- `状态 / 证据`
- `1 · Requirement / Plan`
- `2 · Execute / Review / Complete`
- bounded v0.1 flow guidance: Requirement/Plan -> Execute -> Reconcile if needed -> Verify -> Review -> Gate -> Advance -> Complete

The cleanup does not add a renderer lifecycle state machine, does not change backend action legality, and does not change Native runtime/provider semantics.

Candidate head after this cleanup was `eddb0964d20c1cf3e3ae0c2c5bc565e54326b788`. CI run `33263890236`, job `99130374937`, passed dependency install, Typecheck, full repository tests, and Build.

## 6. Current Real E2E harness

The repository now has one current frozen-v0.1 E2E harness:

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
5. inspect Conversation Map and Project Map status;
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

Candidate head after adding the harness and npm commands was `79de8f299fbdc21ea8aa04afbc0485d199456d37`. CI run `33264162097`, job `99131108157`, passed:

- `npm ci`
- Typecheck
- focused E2E harness syntax/boundary contract as part of repository tests
- full repository tests
- Build

**Important:** this deterministic CI PASS is not a real-model E2E PASS. The current release route is waiting for the actual `npm run test:real:v0.1` execution on a real development host with working Codex runtime/authentication.

## 7. Windows package state

The existing package entry remains:

- `npm run package:win`

It builds the application and creates the Windows package under `dist/package`, including `Codex Workbench V1.exe` and the official Workbench CLI executable. Packaging requires a real Windows environment with `csc.exe` available.

The packaged acceptance command is now:

- `npm run test:real:v0.1:package`

This first runs the existing Windows packaging path, then runs the same v0.1 E2E harness against `dist/package/Codex Workbench V1.exe`.

No packaged-E2E PASS is claimed yet.

## 8. Current release-route status

- Integration: **deterministic gate PASS**
- Minimal UI Cleanup: **deterministic gate PASS**
- Real E2E: **harness ready; real execution pending**
- Windows Packaged E2E: **command ready; execution pending after source Real E2E**
- Bug Fix: pending defects found by Real/packaged E2E
- Final Regression: pending
- v0.1 release: pending

Do not reopen historical K1-K8 implementation sequencing. Historical AUT/K1 real gates remain evidence/history, not the current release route.

## 9. Test-debt policy

The incremental test-debt policy remains unchanged:

- published historical evidence is immutable / append-only;
- already-passed formal model cases are retired from future formal trial queues;
- unresolved Native A/B debt remains on PR #46/#47;
- cheap deterministic repository/static gates remain;
- new fixes get focused deterministic regression coverage;
- do not rerun expensive already-passed real-model A/B trials merely because the UI or candidate head changed.

PR #46/#47 need to be re-read only when release-candidate test debt becomes relevant. Do not modify `AB-READ-003-source-contract` merely because the historical v1.1 run never reached it.

## 10. Immediate resume sequence

When a new conversation resumes this project:

1. Read `docs/workbench-map/CURRENT_CHECKPOINT.md`, this checkpoint, and `docs/V0.1-MVP-SCOPE-FREEZE.md` from PR #50's current head.
2. Re-read GitHub metadata/head for PR #50. Git refs are authoritative if the branch moved after this checkpoint.
3. Re-read PR #48/#49 only when historical product/scope ancestry is needed; they are no longer the current product endpoint.
4. Treat PR #50 / `release/v0.1-integration` as the current v0.1 release candidate unless newer repository ancestry proves otherwise.
5. Keep the v0.1 Scope Freeze hard. Do not add deferred Automation systems.
6. The immediate product task is **Real E2E**, not more feature implementation: run `npm run test:real:v0.1` on a real host with working Codex runtime/authentication and capture `dist/e2e/v01-real-e2e.json`.
7. If Real E2E fails, fix only the concrete acceptance-path defect found, add/update focused deterministic regression coverage, rerun repository gates, and rerun the affected E2E path.
8. After source Real E2E passes, run `npm run test:real:v0.1:package` on real Windows and capture `dist/e2e/v01-package-e2e.json`.
9. Only after packaged E2E passes, proceed to final regression: Typecheck, focused tests, full repository tests, Build, Windows package, restart/persistence confirmation, and retained release-candidate test debt as explicitly required.
10. Do not merge, delete branches, force-push, close PRs, or mark Draft PRs ready without explicit user approval.
11. Do not restart already-passed expensive formal model trials.

If repository truth contradicts this checkpoint, repository truth wins and `CURRENT_CHECKPOINT.md` should be deliberately advanced again as part of the next durable handoff.
