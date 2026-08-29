# Automation Governance Checkpoint

> Exact remote checkpoint captured on 2026-08-29 from the stacked Automation branches. This file records confirmed remote truth for continuation. Older ROADMAP/HANDOFF text must not override newer exact branch/PR evidence.

## 1. Non-negotiable ownership boundary

Workbench does not rebuild Codex.

Codex-native owns Thread / Turn / Item, context and compaction, tools, sandbox, approvals, subagents, and runtime lifecycle.

Workbench owns Product Project shell, Requirement/version/change governance, Plan/Stage/Step workflow truth, Evidence/Audit/Verifier/Review/Gate governance, Map/projection, and optional external-provider orchestration.

Truth boundaries:

- runtime truth: Codex App Server/Core
- workflow truth: Automation DB
- projection truth: Workbench UI / Map sidecars
- external action truth: provider subsystem
- live resource truth: runtime ownership / lease
- accepted-but-unknown external work is reconciled by exact request identity; it is never blindly resent
- Workbench must not introduce a second transcript, sandbox, tool executor, subagent runtime, or context manager

## 2. Confirmed stacked execution-governance heads

All PRs below remain stacked Draft work; no merge is implied by this checkpoint.

| PR | Branch | Exact final head | Confirmed role |
| --- | --- | --- | --- |
| #20 | `feature/automation-execution-to-verification` | `0baf6d1aadb2b64926d9a9867ce3ac9cbc161432` | ExecutionAttempt completion drives Step into verification/failure lifecycle correctly. |
| #21 | `feature/automation-native-step-executor` | `a9223d30e5cd5cfd2919994fa3a3802dc7250fa2` | First bounded PURE/read-only Native Step executor; reuses existing Native runtime and exact reconcile identity. |
| #22 | `feature/automation-step-verification-contract` | `f26e9700525e4095541e206016d77a7f6caaf2f4` | Persists optional typed verifier policy in immutable PlanVersion canonical truth. |
| #24 | `feature/automation-step-verifier` | `a140d4d14abd9f451a7a10d567a16b01be883f5f` | Deterministic workflow-truth verifier; v1 executes only HASH_MATCH and advances PASS to REVIEWING. |
| #25 | `feature/automation-step-review-completion` | `7bd5fbf40af95f66ff4709ae7b1526b0ff3877b1` | Explicit USER review Evidence completes or rejects a verified Step without rewriting execution truth. |
| #27 | `feature/automation-stage-gate` | `9be5cf73f2c68ea077c4406fd0ff6c2dc54fca72` | Separate Stage-level Gate consumes approved Step truth and dependency Stage PASS truth. |
| #28 | `feature/automation-stage-progression` | `e61652f421b82c95a94191c85c5db4f8037ff67c` | Exact PASS Stage Gate advances runtime position via immutable Checkpoint; final Stage yields PLAN_COMPLETE_READY. |
| #29 | `feature/automation-project-completion` | `bc06eec3b1d7bed89a3d03acd644aee551d9f45f` | Final governance truth projects RUNNING AutomationProject to COMPLETED without adding another approval gate. |

## 3. Confirmed validation checkpoints

### PR #22 — verifier-policy continuity

- workflow run: `33241244660`
- job: `99070847833`
- result: bounded diff, TypeScript, targeted tests, full repository tests, build, and self-clean all green
- final product/test diff:
  - `src/automation/planner-validator.ts`
  - `src/automation/store.ts`
  - `tests/automation-step-verification-contract.test.ts`

### PR #24 — deterministic Step verifier

- workflow run: `33241943041`
- job: `99072713718`
- result: bounded/static ownership guard, TypeScript, targeted execution/verifier tests, full repository tests, build, and self-clean all green
- final diff against #22:
  - `src/automation/step-verification-service.ts`
  - `src/main/automation-execution-facade.ts`
  - `tests/automation-step-verifier.test.ts`

### PR #25 — explicit user Review completion

- provenance-hardening workflow run: `33242710265`
- job: `99074660530`
- result: bounded provenance guard, TypeScript, targeted governance-chain tests, full repository tests, build, and self-clean all green
- final diff against #24:
  - `src/automation/step-review-service.ts`
  - `src/main/automation-execution-facade.ts`
  - `tests/automation-step-review-completion.test.ts`

### PR #27 — Stage Gate

- workflow run: `33246870043`
- job: `99085753190`
- result: bounded/static ownership guard, TypeScript, targeted Stage governance tests, full repository tests, build, and self-clean all green
- final diff against #25:
  - `src/automation/stage-gate-service.ts`
  - `src/main/automation-execution-facade.ts`
  - `tests/automation-stage-gate.test.ts`

### PR #28 — Stage progression

- workflow run: `33247163432`
- job: `99086523909`
- result: bounded/static ownership guard, TypeScript, targeted Stage progression/governance tests, full repository tests, build, and self-clean all green
- final diff against #27:
  - `src/automation/stage-progression-service.ts`
  - `src/main/automation-execution-facade.ts`
  - `tests/automation-stage-progression.test.ts`

### PR #29 — Project completion projection

- workflow run: `33247399934`
- job: `99087150858`
- result: bounded/static ownership guard, TypeScript, targeted Project-completion/governance tests, full repository tests, build, and self-clean all green
- final diff against #28:
  - `src/automation/project-completion-service.ts`
  - `src/main/automation-execution-facade.ts`
  - `tests/automation-project-completion.test.ts`

All temporary validation workflows above are absent from their final heads.

## 4. Frozen v1 governance model

The architecture decision is now explicit:

- **Step level:** execution -> deterministic verification -> explicit Review -> terminal.
- **Stage level:** a separate Stage Gate decides whether the whole Stage may progress.
- **Project level:** no third approval gate. Project completion is a non-interactive projection from already-proven final governance truth.

This prevents a noisy `execute -> verify -> review -> gate` sequence on every Step while preserving a real Stage-level engineering gate.

## 5. Current end-to-end governance chain

### 5.1 Plan truth

- Planner may attach optional typed verifier policy to a Step candidate.
- The exact normalized PlanCandidate is persisted in immutable `PlanVersion.canonicalPayload` and bound by `payloadSha256`.
- Verifier policy is not copied into StepSpec as a second truth source.

### 5.2 Execution truth

- First executor slice is deliberately limited to `sideEffectClass=PURE` and existing attached Native Thread execution.
- Native runtime remains Codex-owned.
- Workbench persists opaque Native Turn identity / hashes / receipts, not raw transcript ownership.
- Accepted-but-unknown work is reconciled without a second submit.
- Successful ExecutionAttempt truth advances the Step to `VERIFYING`.

### 5.3 Verification truth

- `DeterministicStepVerificationService` consumes immutable Plan policy plus already-persisted workflow truth only.
- It does not start Native Turns, invoke providers, run shell text, own a sandbox, or inspect a transcript.
- v1 auto-executes only `HASH_MATCH` with exact data instruction `result-sha256:<64 lowercase hex>`.
- PASS writes bounded `STEP_VERIFICATION` Evidence and advances `VERIFYING -> REVIEWING`.
- Explicit mismatch writes FAIL Evidence and terminates the Step as failed.
- Missing/malformed/unsupported verifier policy fails closed and leaves the Step in `VERIFYING`.

### 5.4 Review truth

- `StepReviewCompletionService` requires exactly one PASS verifier Evidence bound to the exact project/stage/step/execution-attempt/active-plan identity.
- Accepted verifier Evidence must have `source=WORKFLOW_TRUTH`, producer `workbench-step-verifier-v1`, and metadata `verifierProtocol=workbench-step-verifier-v1`.
- Review writes one immutable `STEP_REVIEW` Evidence before the terminal transition.
- `APPROVE` drives `REVIEWING -> TERMINAL/COMPLETED`.
- `REJECT` drives `REVIEWING -> TERMINAL/FAILED` while the already-successful ExecutionAttempt remains successful execution truth.
- Review decision replay is idempotent; conflicting decision/provenance fails closed.
- `reviewerRef` is provenance only; authentication/authorization remains a caller/UI boundary concern.

### 5.5 Stage Gate truth

- A Stage PASS is never implied by Step completion or Review.
- `StageGateService` requires every active Step in the Stage to be terminal COMPLETED with exact `APPROVE STEP_REVIEW` Evidence bound to the active Plan id/hash.
- Every declared `dependsOn` Stage must already have exact PASS `STAGE_GATE` Evidence.
- The Stage itself must be ACTIVE in the exact active PlanVersion.
- One deterministic Stage/Plan decision slot records PASS or REJECT as immutable `STAGE_GATE` Evidence.
- Same decision replay is idempotent; conflicting decision or gatekeeper provenance fails closed.
- REJECT is durable governance truth and does not satisfy downstream dependencies.
- Stage Gate owns no provider/runtime/sandbox capability and does not mutate PlanVersion or runtime position.

### 5.6 Stage progression truth

- `StageProgressionService` accepts only the deterministic PASS `STAGE_GATE` identity and revalidates its provenance, prerequisite refs, bounded counts, and digest.
- Runtime Stage position lives in immutable `Checkpoint.currentStageSpecId`; immutable PlanVersion is never rewritten for runtime progress.
- v1 progression is explicitly serial because the runtime model has one current Stage pointer.
- The current runtime Stage is resolved from the latest same-Plan Checkpoint, then immutable `PlanVersion.currentStageId`, then the first active ordinal Stage for bootstrap.
- A stale/non-current Stage cannot be advanced.
- Progression Checkpoint ids are deterministic, so replay is idempotent.
- Final Stage PASS creates a completion-ready Checkpoint with `currentStageSpecId=null`; it does not itself complete the AutomationProject.

### 5.7 Project completion truth

- `ProjectCompletionService` is not another approval gate.
- It independently revalidates exact PASS Gate evidence for every active Stage in the active Plan.
- It requires the deterministic final progression Checkpoint and a cleared runtime Stage/Step/Attempt position.
- The final Checkpoint must correlate every active Stage PASS Gate.
- Completion writes one bounded `PROJECT_COMPLETION_READY` Evidence record before projecting the existing project lifecycle `RUNNING -> COMPLETED`.
- Same exact completion replay is idempotent.
- A Project already marked COMPLETED by another path without the expected completion Evidence is rejected; the service does not fabricate historical provenance after the fact.

## 6. Important negative guarantees

The current execution-governance work intentionally does **not** add:

- a second Codex runtime, transcript, context manager, sandbox, tool executor, or subagent system
- a second provider transport
- raw Native prompt/response persistence in Automation workflow truth
- executable free-form verification-plan text
- a schema migration for Review, Stage Gate, Stage progression, or Project completion
- use of provider `REQUIRE_HUMAN_GATE` as reviewer or Stage Gate approval truth
- a separate Gate after every Step Review
- a separate Project completion approval click
- mutation of immutable `PlanVersion.currentStageId` for runtime progress
- automatic project completion directly from Step completion or Stage Gate alone

`REQUIRE_HUMAN_GATE` remains dispatch authorization semantics; it must not be silently reinterpreted as post-execution Review/Gate evidence.

## 7. Next exact work

The core governance chain is now closed at the domain/service level. The next work must be **orchestration reachability**, not more isolated governance primitives:

1. Audit exact production callers of `AutomationExecutionFacade` at PR #29 final head.
2. Determine which lifecycle actions (`START`, Step scheduling, Verify, Review, Stage Gate, Stage advance, Project completion) are actually reachable from main-process/UI/product entrypoints.
3. Add only the missing composition/orchestration edges needed to drive the existing services; do not invent duplicate execution engines.
4. Keep unsupported verifier classes fail-closed until each deterministic verifier gets its own bounded implementation.
5. Keep the real Direct Codex vs Workbench Native A/B benchmark deferred/non-blocking at its pinned exact target unless it becomes a release gate.
