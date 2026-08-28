# Current Handoff Checkpoint

This file is the shortest path for resuming active engineering work safely. Read `ARCHITECTURE.md` before changing ownership boundaries, `ROADMAP.md` before changing stage order, and `GIT_WORKFLOW.md` before creating development or validation branches.

## Repository checkpoint

- Repository: `sadary000000/Codex-Workbench`
- Formal Workbench integration target: `codex/workbench-v1`
- Active integration branch: `workbench/next`
- `workbench/next` was created from documentation checkpoint `375206182e5ee436dd1eac4ddf9d60938f98c37d`.
- Exact-ref CI transition commit: `52df1f3f987c521e7ee9619d1d3ea567a7564843`.
- R5 source audit base: `3a7c3509b7fff16fb10a2b598aa6a20c857cd7b6`.
- R5 audit report commit: `90ee105fda031916ee514baac43bc0776edb5ceb`.
- Pre-documentation architecture stack tip: `717069965d211189919ed081946a21d224b11353` on `arch-r4/webgpt-policy-budget-durability`.
- Documentation PR #8 remains a Draft documentation-only checkpoint; ongoing R5+ integration is on `workbench/next`.

Git is authoritative for the current `workbench/next` SHA. This document records durable relationships and known checkpoints, not a replacement for remote-ref inspection.

## Development workflow checkpoint

Current intended flow:

`feature/<bounded-slice> -> workbench/next -> codex/workbench-v1 -> tag/release`

Use a short-lived feature branch only when an implementation slice needs isolation. Documentation/handoff checkpoints may be fast-forwarded directly on `workbench/next` after stating the exact base/ref. Never create a helper branch merely to trigger CI.

Validation rules:

- old `fix/**-exact-head-verify` branches are obsolete;
- CI runs on pushes to `workbench/next` and `codex/workbench-v1`;
- PR CI checks out the PR head SHA;
- manual `workflow_dispatch` accepts a branch/tag/commit `ref`;
- disposable validation output belongs in GitHub Actions, not Git branch names.

See `GIT_WORKFLOW.md` for the complete rule set.

## Legacy branch cleanup

The following four validation-only branches have deletion approval but remain because the current connector does not expose remote branch deletion:

- `fix/arch-r3-exact-head-verify`
- `fix/arch-r3-resource-exact-head-verify`
- `fix/arch-r4-native-budget-exact-head-verify`
- `fix/arch-r4-webgpt-budget-exact-head-verify`

Do not branch new work from them. Existing `arch/**` branches from R2-R4 remain references for Draft PRs #3-#7 and must not be deleted without explicit approval.

## Delivery state

PR #2 is merged. PRs #3 through #8 remain Draft/unmerged checkpoints and do not imply merge approval.

Known heads:

- PR #3: `36477bcd75e7c43c3704575eb06fcd31da7a1bb3`
- PR #4: `1ea60dfdb6f03c929371c9069c1ee6c3b7661fa0`
- PR #5: `3f24f8ff904907e7538289c897c682427fca1208`
- PR #6: `270e3de45bb07d4a9d5199a7cecb1c0058df4f10`
- PR #7: `717069965d211189919ed081946a21d224b11353`
- PR #8 initial docs head: `375206182e5ee436dd1eac4ddf9d60938f98c37d`

## R5 completed audit

`R5 — Native Runtime Dedup` is `AUDIT_PASS`.

The original handoff list named four files that no longer exist (`project-thread-store`, `context-sharing`, `agent-run-service`, `tool-registry`). The audit corrected itself against remote Git and followed actual production callers instead.

What was proven:

- `NativeThreadRuntime` delegates Native lifecycle/read/interrupt to Codex App Server and requires authoritative Native IDs.
- `thread/read` history is parsed/projection-only; Workbench does not maintain a competing durable transcript.
- Prompt recovery persists hash/length/correlation metadata, not raw prompt text.
- ordinary Native Threads share `AppServerHost`; `RuntimeRegistry` is an in-memory live-handle registry.
- Automation Native dispatch uses an already-attached runtime and cannot create/resume a missing target as a hidden fallback.
- composer model/effort/approval/sandbox handling is native protocol adaptation.
- renderer message surfaces are UI projection from Native read/events.
- Conversation/Project Map maintenance uses real Codex Native Threads/Turns and writes Workbench Map projection. Its isolated App Server compatibility paths are documented capability-domain exceptions, not ordinary user Thread truth.
- no independent Workbench agent/subagent runtime or generic Native tool executor/registry was found.

Detailed evidence: `R5_NATIVE_RUNTIME_AUDIT.md`.

No R5 production diff was justified.

## Current engineering stage

`R6 — Manual / Automation Decouple` is now active.

The next action is a read-only production lifecycle/identity audit before editing code. Use `R6_AUDIT_TARGETS.md`.

Primary questions:

1. Does normal manual Native UI/runtime startup require Automation persistence/composition to initialize successfully?
2. If Automation initialization fails, is manual Native Thread/Turn operation unnecessarily blocked?
3. Are Automation-only gates/smokes isolated from ordinary manual startup?
4. Does Workbench `ProjectRecord.projectId` remain a product/navigation identity distinct from Automation `AutomationProject.projectId`?
5. Where the domains correlate, is that correlation explicit rather than implicit equality/type collapse?
6. Do manual `thread/start/resume/read`, `turn/start`, approval, interrupt, and composer paths remain direct Native runtime operations without Workflow/Requirement/Plan prerequisites?

R6 classifications:

- `MANUAL_INDEPENDENCE_PASS`
- `IDENTITY_BOUNDARY_PASS`
- `DECOUPLE_CHANGE`
- `NEEDS_EVIDENCE`

Do not create an implementation diff until `DECOUPLE_CHANGE` has concrete production evidence.

## Resume protocol

1. Read this file, `ARCHITECTURE.md`, `GIT_WORKFLOW.md`, `R5_NATIVE_RUNTIME_AUDIT.md`, and `R6_AUDIT_TARGETS.md`.
2. Verify the remote `workbench/next` SHA and any legacy PR refs actually needed.
3. Check whether PRs #3-#8 changed state since this checkpoint.
4. Continue R6 from the normal Electron startup/manual Native path in `src/main/main.ts` and `src/main/startup-policy.ts`.
5. Trace Workbench Project vs AutomationProject identity across persistence/composition/binding call sites.
6. If a concrete decoupling defect is proven, define one bounded regression test and implementation slice; use `feature/**` only when isolation is useful.
7. Never create a CI-helper branch.
8. Before creating/pushing a new implementation branch, state the exact branch and base SHA/ref and that no merge will occur.
9. Validate against the frozen Manual/Automation and Native-runtime ownership rules.
10. Do not merge or delete branches without explicit approval.
11. Update ROADMAP/HANDOFF/roadmap.json whenever the durable checkpoint changes.

## Non-negotiable continuation constraints

- Native Thread/Turn/Item remain execution truth.
- Do not persist a second transcript.
- Manual V1 must remain independent of Automation.
- Workbench Project must remain distinct from AutomationProject.
- RequirementVersion/PlanVersion remain Workbench governance truth.
- Unknown provider side effects reconcile instead of blind resend.
- Evidence/Audit do not own resource leases.
- Map remains Workbench projection/governance, not duplicate native planning.
- Do not add a second sandbox, Native tool executor, or subagent runtime.

## When this checkpoint is stale

Update this checkpoint when an architecture PR changes state, `workbench/next` changes role, an R6+ implementation slice changes the continuation point, a frozen invariant is reopened, stage status changes, or a discovered runtime fact materially changes ownership.
