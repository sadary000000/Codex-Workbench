# Current Handoff Checkpoint

Read `ARCHITECTURE.md` before changing ownership boundaries, `ROADMAP.md` before changing stage order, and `GIT_WORKFLOW.md` before creating development/validation branches.

## Repository checkpoint

- Repository: `sadary000000/Codex-Workbench`
- Formal integration target: `codex/workbench-v1`
- Active integration branch: `workbench/next`
- `workbench/next` was created from `375206182e5ee436dd1eac4ddf9d60938f98c37d`.
- Exact-ref CI transition: `52df1f3f987c521e7ee9619d1d3ea567a7564843`.
- R5 audit source base: `3a7c3509b7fff16fb10a2b598aa6a20c857cd7b6`.
- R6 audit source base: `68d813b707326e4079992c26435bfbe53a148982`.
- PR #8 remains Draft; ongoing integration is on `workbench/next`.

Git is authoritative for the current remote SHA. This file is a durable navigation checkpoint, not Git truth.

## Development workflow

`feature/<bounded-slice> -> workbench/next -> codex/workbench-v1 -> tag/release`

Use a feature branch only when a concrete implementation slice benefits from isolation. Do not create branches solely for CI. GitHub Actions owns exact-ref validation evidence.

Four obsolete `fix/**-exact-head-verify` branches have deletion approval but remain because the current connector cannot delete remote branch refs. Do not use them for new work. Existing `arch/**` branches remain references for Draft PRs #3-#7 and must not be deleted without explicit approval.

## Delivery state

PR #2 is merged. PRs #3-#8 remain Draft/unmerged checkpoints; no stage/audit status grants merge approval.

Known Draft heads:

- #3 `36477bcd75e7c43c3704575eb06fcd31da7a1bb3`
- #4 `1ea60dfdb6f03c929371c9069c1ee6c3b7661fa0`
- #5 `3f24f8ff904907e7538289c897c682427fca1208`
- #6 `270e3de45bb07d4a9d5199a7cecb1c0058df4f10`
- #7 `717069965d211189919ed081946a21d224b11353`
- #8 `375206182e5ee436dd1eac4ddf9d60938f98c37d`

## Completed audits

### R5 — Native Runtime Dedup: `AUDIT_PASS`

Codex App Server remains Thread/Turn/Item truth. Workbench does not persist a duplicate Native transcript or implement a second agent/subagent/tool/sandbox runtime. Evidence: `R5_NATIVE_RUNTIME_AUDIT.md`.

### R6 — Manual / Automation Decouple: `AUDIT_PASS`

Evidence established that:

- ordinary GUI startup does not initialize Automation/WebGPT persistence/control-plane state unless explicitly activated;
- `tests/arch-v2-8-startup-idle.test.ts` verifies no Automation filesystem/store side effects on ordinary startup;
- manual Thread/Turn IPC calls `NativeThreadRuntime` directly without Workflow/Requirement/Plan/AutomationProject prerequisites;
- product `ProjectRecord` is owned by V1 Workbench persistence and groups cwd/ThreadProjection navigation;
- `AutomationProject` is owned by independent `automation.db` and owns workflow/governance lifecycle;
- Requirement and Planner operations require an existing AutomationProject;
- normal Product Project creation passes `{name, cwd}` and gets identity from V1 persistence;
- no automatic Product Project -> AutomationProject identity equality/binding was found;
- Automation's legacy `WORKBENCH_PROJECT` ExternalRef kind is a provider-scope carrier name, not Product Project ownership.

Evidence: `R6_MANUAL_AUTOMATION_AUDIT.md`.

No R5 or R6 production diff was justified.

## Current engineering stage

`R7 — Projection / Map` is active.

Read `R7_AUDIT_TARGETS.md`. Start with read-only ownership/call-graph/persistence evidence before editing production code.

Primary questions:

1. Can Map state mutate Native Thread/Turn/Item, Automation Workflow, provider, or resource truth, or is it projection-only?
2. Are Conversation/Project Map context reads bounded and read-only rather than a second transcript store?
3. Are hidden maintenance Threads explicitly scoped and executed by Codex Native runtime with narrow dynamic Map tools?
4. How are stale/unavailable projections represented and reconciled?
5. Which missing Requirement/Plan/Workflow/Change/Evidence/Review/PR/commit/native/provider/resource links are real Workbench product gaps rather than duplicated Codex-native plan/status UI?

R7 classifications:

- `PROJECTION_BOUNDARY_PASS`
- `MAP_INCREMENT_PASS`
- `PROJECTION_LEAK_CHANGE`
- `MAP_PRODUCT_GAP`
- `NEEDS_EVIDENCE`

Do not create a production diff until a concrete `PROJECTION_LEAK_CHANGE` or bounded `MAP_PRODUCT_GAP` is proven.

## Resume protocol

1. Verify current `workbench/next` remote SHA and relevant Draft PR states.
2. Read `ARCHITECTURE.md`, `GIT_WORKFLOW.md`, `R5_NATIVE_RUNTIME_AUDIT.md`, `R6_MANUAL_AUTOMATION_AUDIT.md`, and `R7_AUDIT_TARGETS.md`.
3. Audit MapStore/map types and all Map mutation callers first.
4. Trace Conversation Map and Project Map context/maintenance paths back to Native `thread/read` and Map dynamic tools.
5. Classify each surface by owner; distinguish an ownership leak from a legitimate product projection gap.
6. If implementation is justified, define one bounded regression test and slice. Use `feature/**` only when isolation is useful.
7. Never create a helper branch solely for exact-head CI.
8. Before creating/pushing a new implementation branch, state exact branch/base and that no merge will occur.
9. Never merge or delete branches without explicit approval.
10. Update ROADMAP/HANDOFF/roadmap.json at durable checkpoints.

## Frozen continuation constraints

- Native Thread/Turn/Item are execution truth; no duplicate transcript.
- Manual V1 remains independent of Automation.
- Workbench Project remains distinct from AutomationProject.
- RequirementVersion/PlanVersion remain Workbench governance truth.
- Unknown provider side effects reconcile instead of blind resend.
- Evidence/Audit do not own resource leases.
- Map remains a Workbench projection/governance increment, not duplicate native planning.
- Do not add a second sandbox, Native tool executor, or subagent runtime.
