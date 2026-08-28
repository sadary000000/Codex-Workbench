# Current Handoff Checkpoint

This file is the shortest path for resuming active engineering work safely. Read `ARCHITECTURE.md` before changing ownership boundaries and `ROADMAP.md` before changing stage order.

## Repository checkpoint

- Repository: `sadary000000/Codex-Workbench`
- Current architecture stack tip before this documentation branch: `717069965d211189919ed081946a21d224b11353`
- Stack-tip branch: `arch-r4/webgpt-policy-budget-durability`
- Documentation branch: `docs/workbench-handoff-map`
- Documentation branch purpose: add only `docs/workbench-map/**` as a handoff/projection layer.

The documentation branch is stacked from the R4 WebGPT policy durability tip so its PR can show a documentation-only diff against that branch. It must not be treated as approval to merge any earlier stacked architecture PR.

## Delivery state

The active stacked delivery chain is:

`#3 Provider boundary -> #4 Query/Reconcile -> #5 Resource reconcile -> #6 Native policy durability -> #7 WebGPT policy durability -> docs/workbench-handoff-map`

PR #2 (Planner retry/source-integrity) is already merged. PRs #3 through #7 are Draft/unmerged checkpoints and remain subject to explicit merge approval.

Known validated heads:

- PR #3: `36477bcd75e7c43c3704575eb06fcd31da7a1bb3`
- PR #4: `1ea60dfdb6f03c929371c9069c1ee6c3b7661fa0`
- PR #5: `3f24f8ff904907e7538289c897c682427fca1208`
- PR #6: `270e3de45bb07d4a9d5199a7cecb1c0058df4f10`
- PR #7: `717069965d211189919ed081946a21d224b11353`

The R3/R4 slices were validated with targeted tests plus the repository typecheck/full test/build path before being marked complete. Validation does not grant merge permission.

## Current engineering stage

`R5 — Native Runtime Dedup` is active.

No R5 implementation branch had been created at the point this handoff map was introduced. The correct next action is a read-only production call-graph audit of the Codex-facing layer, especially:

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

1. Read this file and `ARCHITECTURE.md`.
2. Verify the current remote SHA of every branch/ref that will be used; do not trust this file as Git truth if the repository has advanced.
3. Check whether any stacked PR has been merged, retargeted, closed, or superseded since this checkpoint, then update the map before relying on its stage status.
4. Continue the R5 call-graph audit from the latest valid stacked head.
5. If a code change is justified, define one bounded slice and its regression test first.
6. Before creating/pushing a new branch, state the exact branch name and base SHA/ref and explicitly state that no merge will be performed.
7. Validate the resulting diff and ensure it does not create a second Thread/context/agent/tool/sandbox/approval runtime.
8. Open or update a Draft PR as appropriate; do not merge or delete branches without explicit approval.
9. Update `ROADMAP.md`, this checkpoint, and `roadmap.json` when the durable handoff state changes.

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
- a new R5+ implementation branch becomes the continuation tip;
- a frozen invariant is deliberately reopened;
- stage status changes;
- a discovered runtime fact materially changes the ownership map.

When stale, update the map in the same PR as the durable architectural/status change when practical. Do not preserve obsolete SHA/status text for historical sentiment; Git history already provides history.
