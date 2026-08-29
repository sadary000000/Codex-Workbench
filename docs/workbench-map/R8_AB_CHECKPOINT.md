# R8 -> Direct Codex / Workbench Native A/B Checkpoint

Checkpoint date: **2026-08-29**

This file is a durable resume index. Git refs and PR metadata remain authoritative if a branch moves after this checkpoint.

## 1. Repository truth

- Repository: `sadary000000/Codex-Workbench`
- Default/stable branch: `codex/workbench-v1`
- Stable branch checkpoint used by repository-test bootstrap: `b2e891bcf8e0a5059e1edd63fbea1ea2fc325619`
- Integration branch: `workbench/next`
- Verified current `workbench/next` head at checkpoint time: `ab4423930f8cc633aee0edb21a1172bf59754991`
- No PR listed below has been merged by the work described in this checkpoint.
- No force-push or branch deletion was used.

## 2. R7/R8 stacked line

Current stacked Draft PR line continues through PR #17. The important current R8 endpoint is:

### PR #17 — remove Project Map compatibility runtime

- branch: `feature/r8-remove-project-map-compat-runtime`
- base: `feature/r8-share-project-map-thread-reads`
- final head: `af911e71ca3370c143d504e2923b122f827cac6c`
- state at checkpoint: Draft / open / unmerged
- validation run: `33233413426`
- validation job: `99050107477`
- result: bounded diff, typecheck, targeted tests, full repository tests, build, and workflow self-clean all PASS

Final PR #17 diff relative to its exact base contains only:

- `src/main/project-map-manager.ts`
- `tests/arch-v2-8-fix-round-3.test.ts`
- `tests/arch-v2-8-fix-round-4.test.ts`
- `tests/r8-project-map-context-read-boundary.test.ts`
- `tests/r8-project-map-no-compat-runtime.test.ts`

## 3. R8 runtime-ownership audit closure

R8 ownership audit is closed at PR #17 exact head. No further production churn is justified merely to keep R8 open.

Verified production ownership:

1. `AppServerHost` owns the ordinary shared Codex App Server process/transport.
2. Ordinary `NativeThreadRuntime` instances created by production composition receive `clientFactory` handles from that one shared host and use `skipInitialize=true`; they are per-thread adapters, not second App Server processes.
3. Project Map member-thread reads first reuse the registered Native runtime; unattached reads use a temporary handle on the same shared host and close only that handle.
4. Conversation Map has no independent `AppServerProcessClient` or `NativeThreadRuntime` compatibility fallback.
5. Project Map keeps one intentional dedicated hidden `NativeThreadRuntime` for dynamic-tools maintenance because current dynamic-tool registration requires fresh experimental `thread/start`; there is no second direct compatibility App Server fallback beside it.
6. Automation Native provider dispatch uses already attached runtimes and does not create/start/resume a second Native runtime trunk.
7. No duplicate Native transcript, sandbox, tool executor, subagent runtime, or context manager was found in the audited production path.

A stale generic comment in `NativeThreadRuntime` still mentions an explicit compatibility-maintenance path for resumed dynamic-tool threads. Product behavior no longer uses the removed Conversation/Project Map compatibility fallbacks; treat any future comment cleanup as documentation-only unless new behavioral evidence appears.

## 4. Repository-owned Codex test control plane — PR #18

PR #18:

- title: `Repo: add repository-owned Codex test bootstrap`
- branch: `chore/codex-repository-test-bootstrap`
- base: `codex/workbench-v1`
- control-plane head before the A/B ready-target binding in this checkpoint: `2e0c37cfa6e9d25d3c7698d55c890a071fbecd33`
- state before this binding update: Draft / open / unmerged / mergeable
- prior green CI run: `33234552297`
- prior green CI job: `99053121329`

PR #18 provides:

- root `AGENTS.md` repository-test bootstrap;
- `ACTIVE_TEST.json` for blocking exact-SHA tests;
- `DEFERRED_TESTS.json` for retained non-blocking tests;
- control-plane freeze while tests run;
- isolated detached worktrees;
- explicit mainline freshness separate from exact-commit verdict;
- contract tests preventing protocol routing drift.

Important deployment fact: because the repository default branch is `codex/workbench-v1`, the "tell Codex only which repository to test" behavior becomes default-checkout discoverable only after PR #18 is explicitly approved and merged. This checkpoint does not grant merge approval.

## 5. Direct Codex vs Workbench Native A/B harness — PR #19

PR #19:

- title: `A/B: add Direct Codex vs Workbench Native parity harness`
- branch: `feature/ab-native-parity-validation`
- base: `feature/r8-remove-project-map-compat-runtime`
- exact base: `af911e71ca3370c143d504e2923b122f827cac6c`
- final self-clean head: `7420b7c6ce93201641c7e79e33e05392602ebf01`
- state at checkpoint: Draft / open / unmerged / mergeable
- harness source commit validated by CI: `44b6b3886d139cf9181681803b7f2a5ac9f44604`
- validation run: `33235545775`
- validation job: `99055770565`
- validation result: PASS

The final self-clean diff relative to PR #17 contains exactly six files:

- `docs/testing/DIRECT_CODEX_WORKBENCH_AB_AGENT_PLAN.md`
- `docs/testing/DIRECT_CODEX_WORKBENCH_AB_CASES.json`
- `docs/testing/DIRECT_CODEX_WORKBENCH_AB_RUNBOOK.md`
- `docs/testing/DIRECT_CODEX_WORKBENCH_AB_SCHEMA.json`
- `scripts/ab-native-arm.ts`
- `tests/ab-native-parity-contract.test.ts`

The temporary branch-local workflow is absent from final PR #19 diff.

### A/B experimental boundary

Primary A/B arms are intentionally compared at one Codex App Server boundary:

- Direct: verified raw App Server initialize -> thread/start -> turn/start;
- Workbench Native: production-isomorphic `AppServerHost -> NativeThreadRuntime`.

Both arms pin the same Codex binary, explicit model/effort, exact prompt, cwd, approvals, and sandbox policy. Actual App Server request envelopes are captured so model-visible Workbench-only payload can be proven rather than inferred.

Formal timing is serialized on the measurement host. Read-only audits/setup are parallelized before timing; Direct/Workbench evidence analysis may run in parallel after timing. Formal sequence is counterbalanced and the protocol contains one bounded variance-escalation rule.

The harness CI proves the harness compiles and repository/static parity contracts pass. It is **not** a real model-performance A/B result.

## 6. Deferred A/B state

`docs/testing/DEFERRED_TESTS.json` binds `direct-codex-vs-workbench-native-ab-v1` to:

```text
feature/ab-native-parity-validation
@ 7420b7c6ce93201641c7e79e33e05392602ebf01
PR #19
```

Classification remains `deferred`, `blocksMainline=false`, `requiredBefore=release-candidate`.

This means ordinary engineering may continue without waiting for real A/B execution. The A/B can be run later against the retained exact target. Any future forward-validation of newer code requires an explicit new exact target binding; an old PASS cannot be reused for a newer commit.

## 7. Immediate resume sequence

When continuing from this checkpoint:

1. Read remote refs for PR #17, PR #18, PR #19; do not assume cached branch heads are current.
2. Treat R8 production ownership audit as closed unless new source evidence contradicts it.
3. If real A/B execution is requested, use frozen `DEFERRED_TESTS.json` entry, create a detached worktree at its exact `executionTarget.commit`, then read the A/B protocol from that exact target.
4. Let Codex follow `DIRECT_CODEX_WORKBENCH_AB_RUNBOOK.md` and `DIRECT_CODEX_WORKBENCH_AB_AGENT_PLAN.md`; do not redesign trial ordering or parallelism during execution.
5. Preserve real A/B raw evidence and structured result. Keep unavailable token/compaction/retry metrics null rather than inferred.
6. Do not let a real A/B result block current mainline merely because it exists in the deferred ledger; it becomes a required gate only at the declared release-candidate boundary or through an explicit versioned control-plane change.
7. After real A/B evidence exists, use it to decide whether Workbench Native overhead is acceptable and to re-freeze the next Automation/Release route.

## 8. Frozen architecture invariants

- Native Thread/Turn/Item is Codex Runtime Truth.
- Workbench does not own a second Native transcript.
- Workbench does not implement a second Native tool executor, sandbox, context manager, or subagent runtime.
- Product Project and AutomationProject remain distinct identities with explicit 1:N Product-Shell-owned association.
- unlink association != delete AutomationProject.
- RequirementVersion/PlanVersion remain Workbench governance truth.
- unknown external provider side effect -> reconcile exact request; never blind resend.
- Map is projection/governance increment, not Runtime Truth.
- optional Workbench features must not contaminate ordinary Native Codex context unless explicitly activated.
