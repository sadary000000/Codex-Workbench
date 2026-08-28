# Current Handoff Checkpoint

This file is the shortest path for resuming active engineering work safely. Read `ARCHITECTURE.md` before changing ownership boundaries, `ROADMAP.md` before changing stage order, and `GIT_WORKFLOW.md` before creating development or validation branches.

## Repository checkpoint

- Repository: `sadary000000/Codex-Workbench`
- Formal Workbench integration target: `codex/workbench-v1`
- Active integration branch: `workbench/next`
- `workbench/next` was created from documentation checkpoint `375206182e5ee436dd1eac4ddf9d60938f98c37d`.
- Exact-ref CI transition commit: `52df1f3f987c521e7ee9619d1d3ea567a7564843`.
- Pre-documentation architecture stack tip: `717069965d211189919ed081946a21d224b11353` on `arch-r4/webgpt-policy-budget-durability`.
- Documentation PR: #8, branch `docs/workbench-handoff-map`, remains a Draft documentation-only checkpoint.

Git is authoritative for the current `workbench/next` SHA. This document records durable relationships and known checkpoints, not a replacement for remote-ref inspection.

## Development workflow checkpoint

The repository has moved away from using permanent architecture/validation branches as a project-state database.

Current intended flow:

`workbench/next -> feature/<bounded-slice> -> review/exact-head CI -> workbench/next`

When an entire roadmap stage satisfies its exit criteria, review the complete `workbench/next` diff against `codex/workbench-v1` and open/update the formal integration PR. Merge only after explicit approval.

Validation rules:

- `fix/**-exact-head-verify` branches are obsolete.
- CI runs on pushes to `workbench/next` and `codex/workbench-v1`.
- PR CI checks out the PR head SHA instead of relying on a synthetic merge ref.
- Manual `workflow_dispatch` accepts an optional branch/tag/commit `ref` for exact-ref verification.
- Disposable logs/results should be kept as Actions output/artifacts, not Git branches.

See `GIT_WORKFLOW.md` for the complete rule set.

## Legacy branch cleanup

These four branches were created only to trigger exact-head validation under the old CI workflow and have no independent product value:

- `fix/arch-r3-exact-head-verify`
- `fix/arch-r3-resource-exact-head-verify`
- `fix/arch-r4-native-budget-exact-head-verify`
- `fix/arch-r4-webgpt-budget-exact-head-verify`

Their deletion has been approved as part of the workflow cleanup, but the currently available authenticated GitHub connector does not expose remote branch deletion. Treat them as obsolete cleanup debt; do not branch new work from them.

Existing `arch/**` branches from R2-R4 are different: they remain active references for the current stacked Draft PR chain and must not be deleted merely to reduce branch count.

## Delivery state

The legacy stacked delivery chain is:

`#3 Provider boundary -> #4 Query/Reconcile -> #5 Resource reconcile -> #6 Native policy durability -> #7 WebGPT policy durability`

PR #2 (Planner retry/source-integrity) is already merged. PRs #3 through #7 are Draft/unmerged checkpoints and remain subject to explicit merge approval. PR #8 is the initial handoff-map documentation Draft.

Known validated heads:

- PR #3: `36477bcd75e7c43c3704575eb06fcd31da7a1bb3`
- PR #4: `1ea60dfdb6f03c929371c9069c1ee6c3b7661fa0`
- PR #5: `3f24f8ff904907e7538289c897c682427fca1208`
- PR #6: `270e3de45bb07d4a9d5199a7cecb1c0058df4f10`
- PR #7: `717069965d211189919ed081946a21d224b11353`
- PR #8 initial docs head: `375206182e5ee436dd1eac4ddf9d60938f98c37d`

The R3/R4 slices were validated with targeted tests plus the repository typecheck/full test/build path before being marked complete. Validation does not grant merge permission.

## Current engineering stage

`R5 — Native Runtime Dedup` is active.

No R5 implementation slice had been justified at this checkpoint. New R5 work should start from the current `workbench/next` head, not from one of the legacy `fix/**` validation branches.

The correct next action remains a read-only production call-graph audit of the Codex-facing layer, especially:

- `src/codex/project-thread-store.ts`
- `src/codex/context-sharing.ts`
- `src/codex/agent-run-service.ts`
- `src/codex/tool-registry.ts`
- `src/codex/composer-capabilities.ts`
- adjacent App Server/native provider/control-plane adapters as required to establish actual ownership.

## R5 decision test

For every candidate component, answer these questions from production callers and persisted behavior rather than from its filename:

1. What authoritative truth does the component read or mutate?
2. Does Codex App Server already own that truth natively?
3. Is Workbench storing only a stable reference, projection, product/governance state, or compatibility metadata?
4. Would deleting this component remove a Workbench-specific semantic rather than a duplicate runtime?
5. If it is duplicate runtime state, what caller migration is required before removal?

Classify each audited surface as one of:

- `NATIVE_ADAPTER_PASS` — thin protocol/native adapter; keep.
- `WORKBENCH_INCREMENT_PASS` — legitimate product/governance/projection semantic; keep.
- `DUPLICATE_RUNTIME_CHANGE` — competing native execution state/behavior; design a bounded removal/migration slice.
- `NEEDS_EVIDENCE` — ownership cannot yet be established; gather call-graph/runtime evidence before editing.

Do not create an implementation diff until a `DUPLICATE_RUNTIME_CHANGE` has concrete evidence.

## Resume protocol

A future human or AI session should resume in this order:

1. Read this file, `ARCHITECTURE.md`, and `GIT_WORKFLOW.md`.
2. Verify the current remote SHA of `workbench/next` and every legacy ref that will actually be used; do not trust this file as Git truth if the repository has advanced.
3. Check whether any stacked PR has been merged, retargeted, closed, or superseded since this checkpoint, then update the map before relying on its stage status.
4. Continue the R5 call-graph audit from the current `workbench/next` head.
5. If a code change is justified, define one bounded slice and its regression test first; use a short-lived `feature/**` branch only when isolation is useful.
6. Never create a helper branch merely to trigger exact-head CI; use the existing CI triggers or manual `ref` input.
7. Before creating/pushing a new implementation branch, state the exact branch name and base SHA/ref and explicitly state that no merge will be performed.
8. Validate the resulting diff and ensure it does not create a second Thread/context/agent/tool/sandbox/approval runtime.
9. Open or update a Draft PR as appropriate; do not merge or delete branches without explicit approval.
10. Update `ROADMAP.md`, this checkpoint, and `roadmap.json` when the durable handoff state changes.

## Non-negotiable continuation constraints

- Never infer execution truth from this document when native runtime state is available.
- Never reconstruct or persist a second transcript for convenience.
- Never blind-resend an external side effect with an unknown outcome; reconcile it.
- Never make Evidence/Audit the owner of a resource lease.
- Never collapse Workbench Project into AutomationProject merely to reduce types.
- Never delete Map as duplicate native planning; Map is a Workbench projection/governance capability.
- Never add a second sandbox, native tool executor, or subagent runtime inside Workbench.

## When this checkpoint is stale

This file is stale as soon as any of the following occurs:

- an architecture PR in the stack is merged, closed, retargeted, or superseded;
- `workbench/next` is formally integrated or its role changes;
- a new R5+ implementation slice changes the continuation tip;
- a frozen invariant is deliberately reopened;
- stage status changes;
- a discovered runtime fact materially changes the ownership map.

When stale, update the map in the same PR/commit as the durable architectural or workflow status change when practical. Do not preserve obsolete SHA/status text for historical sentiment; Git history already provides history.
