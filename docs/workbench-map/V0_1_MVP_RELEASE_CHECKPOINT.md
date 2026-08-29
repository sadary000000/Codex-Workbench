# Codex Workbench v0.1 MVP / Release Checkpoint

Checkpoint date: **2026-08-30**
Status: **ACTIVE RESUME INDEX**

This file is the durable resume index for the current Workbench mainline. Git refs, PR metadata, and repository contents are authoritative if any branch moves after this checkpoint. Before changing code, re-read the referenced PRs/refs instead of trusting cached conversation state.

## 1. Repository truth

- Repository: `sadary000000/Codex-Workbench`
- Default/stable branch: `codex/workbench-v1`
- Current product endpoint: PR #48, `feature/automation-project-create-associate`
- PR #48 exact product head at checkpoint: `68faf1ce38c1bd39aadcad3ed3d6382fd3d8a599`
- Current scope/handoff branch: PR #49, `docs/v0.1-mvp-scope-freeze`
- Scope-freeze commit before this resume-index update: `fa4713c4bd63b3f61421280fa358d284e839ac46`
- PR #48 and PR #49 are Draft / open / unmerged at checkpoint time.
- No merge, branch deletion, force-push, or PR close is authorized by this checkpoint.

## 2. Frozen v0.1 decision

The first usable release is intentionally small. Do not continue expanding v0.1 with long-term Automation ideas.

The authoritative scope document is:

- `docs/V0.1-MVP-SCOPE-FREEZE.md`

v0.1 requires only:

1. normal Codex-native conversation/coding behavior;
2. Product Project management and restart persistence;
3. usable basic Conversation Map / Project Map;
4. one understandable Automation path from goal -> Requirement -> Plan -> Execute -> Reconcile if needed -> Verify -> Review/Gate -> Advance -> Complete;
5. a real runnable Windows package and packaged end-to-end validation.

Manual user clicks between Automation governance stages are acceptable in v0.1.

Explicitly deferred beyond v0.1 include fully autonomous continuous execution, Attention Center, user-facing Requirement Change / automatic Replan UX, standalone Workflow Map, parallel scheduling, generalized hardware/deployment/GUI adapters, expanded multi-provider UI, cloud/team features, enterprise permissions, advanced backup UI, and updater productization.

Scope-control rule: if a proposed feature is not required to make the frozen v0.1 acceptance path complete, understandable, reliable, or packageable, defer it.

## 3. Current product closure

PR #48 closes the zero-to-start AutomationProject gap for an existing Product Project:

- user can create an AutomationProject from Product Project UI;
- Store owns generated project identity, DRAFT lifecycle default, persistence, and audit;
- renderer can provide only the bounded project name;
- creation and Product association are separate writes;
- association failure retains the created AutomationProject for later rebind instead of destructive rollback.

PR #48 final validation run `33261824669`, job `99124960895`, passed implementation, dependency install, Typecheck, focused creation/association contracts, existing association tests, full repository tests, Build, and self-clean.

The currently reachable basic Automation path is:

Product Project -> create/associate AutomationProject -> select exact Native Thread -> Requirement Start/Draft/Reconcile -> USER answers/confirmation -> Planner -> Execute -> Reconcile -> Verify -> Review -> Gate -> Advance -> Complete.

Do not reopen old K1-K8 implementation sequencing merely because historical documents exist. That sequence is archive/history, not the current mainline.

## 4. Architecture invariants

- Native Thread/Turn/Item is Codex Runtime Truth.
- Workbench does not own a second Native transcript.
- Workbench does not implement a second Native context manager, sandbox, tool executor, or subagent runtime.
- Ordinary Native execution reuses Codex-native runtime/harness behavior.
- Product Project and AutomationProject remain distinct identities with explicit association.
- unlink association != delete AutomationProject.
- RequirementVersion / PlanVersion and governance state remain Workbench workflow truth.
- Map is projection/governance increment, not Runtime Truth.
- unknown external-provider side effect -> reconcile the exact request identity; never blind resend.
- optional Workbench features must not contaminate ordinary Native Codex context unless explicitly activated.

## 5. Test-debt policy

The user decision is an incremental test-debt queue:

- historical published evidence remains immutable / append-only;
- a formal model case that already passed is retired from future formal trial queues;
- unresolved, failed, interrupted, or unstarted formal cases remain;
- cheap deterministic repository/static gates remain;
- every new product change should add/update focused deterministic tests where appropriate;
- do not rerun expensive real-model A/B after every UI/product change.

Historical results remain on `codex/test-results` and are append-only.

### Current unresolved Native A/B debt

PR #46: `Test: retain only unresolved Native A/B debt`

- branch: `test/native-ab-unresolved-v1-2-clean`
- exact head at checkpoint: `95ac3c6358627dcbd7c8b486fae667d0c1e2d40f`
- protocol: `1.2.0`
- state at checkpoint: Draft / open / unmerged
- passed formal Case 1 is retired from the required queue;
- unresolved required cases are `AB-READ-002-package-contract` and `AB-READ-003-source-contract`;
- capacity failures such as `usageLimitExceeded` pause/checkpoint the frozen run instead of being treated as semantic failure;
- completed successful formal trials are not rerun on resume.

PR #47: `Test: rebind Native A/B debt to protocol v1.2`

- branch: `chore/rebind-native-ab-v1-2-clean`
- exact head at checkpoint: `f48c71ed46faf517c64c90c5e7ef181b85f0dd47`
- state at checkpoint: Draft / open / unmerged
- deferred A/B remains non-blocking for ordinary mainline work and is retained for release-candidate validation.

Do not modify `AB-READ-003-source-contract` merely because the previous v1.1 run never reached it.

## 6. Current release route

The mainline is no longer “add more Automation systems.” It is:

1. **Integration** — establish one coherent v0.1 candidate from the current stacked product line.
2. **Minimal UI cleanup** — only changes required to make the acceptance path understandable.
3. **Real E2E** — run the complete Product Project -> Native Thread -> Requirement -> Plan -> Execute -> Verify/Review/Gate -> Complete path.
4. **Windows packaged E2E** — build/package and validate the same path in the real packaged Windows application.
5. **Bug fixes** — fix defects actually found by integrated/package testing; accompany fixes with focused deterministic regression tests.
6. **Final regression** — Typecheck, focused tests, full repository tests, Build, package, restart/persistence smoke, then prepare v0.1.

Current package entry already exists as `npm run package:win`; this is not proof of release readiness until a real packaged Windows E2E passes.

## 7. v0.1 acceptance path

v0.1 is functionally complete when the packaged Windows build can reliably:

1. launch Workbench;
2. create/open a Product Project for a real local repository;
3. create/open a Native Codex Thread and use normal Codex coding behavior;
4. inspect Conversation/Project Map;
5. create and associate an AutomationProject;
6. enter a goal and produce a Requirement draft;
7. answer questions and confirm the Requirement as USER;
8. generate a Plan using an explicit current Native Thread target;
9. execute the current Step and reconcile if needed;
10. verify/review/gate and advance until complete;
11. complete the AutomationProject;
12. close/reopen Workbench and confirm Product Project, Native Thread binding, and Automation workflow state remain usable.

Manual clicks between governance stages are acceptable.

## 8. Expected remaining effort

At the scope freeze, expected remaining work was approximately **3-5 normal development days / 20-35 engineering hours**, with a conservative 5-7 day range if packaged Windows E2E reveals significant integration defects.

This estimate assumes the frozen v0.1 scope is not expanded.

## 9. Immediate resume sequence

When a new conversation resumes this project:

1. Read this checkpoint and `docs/V0.1-MVP-SCOPE-FREEZE.md` from PR #49's current head.
2. Re-read GitHub metadata for PR #48 and PR #49; do not assume the SHAs above are still current if refs moved.
3. Re-read PR #46/#47 only if test-debt or release-gate work is relevant.
4. Treat PR #48 as the current product endpoint unless current GitHub ancestry proves a newer product endpoint exists.
5. Treat the v0.1 Scope Freeze as a hard product constraint.
6. Continue the release route: Integration -> Minimal UI Cleanup -> Real E2E -> Windows Packaged E2E -> Bug Fix -> Final Regression -> v0.1.
7. Prefer exact repository evidence over conversation recollection; inspect source/PRs before making architectural claims.
8. Do not merge, delete branches, force-push, or close PRs without explicit user approval.
9. Keep new feature/fix tests deterministic and focused; do not restart already-passed expensive formal model trials.

If repository truth contradicts this checkpoint, repository truth wins and this checkpoint should be updated as part of the next durable handoff.