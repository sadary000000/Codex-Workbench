# Automation Governance Checkpoint

> Exact remote checkpoint captured on 2026-08-29 from the stacked Automation branches. This file records confirmed remote truth for continuation; older ROADMAP/HANDOFF text must not override newer exact branch/PR evidence.

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

The following heads are exact remote commits observed during this checkpoint. All listed PRs remain stacked; no merge is implied by this document.

| PR | Branch | Exact head | Confirmed role |
| --- | --- | --- | --- |
| #20 | `feature/automation-execution-to-verification` | `0baf6d1aadb2b64926d9a9867ce3ac9cbc161432` | ExecutionAttempt completion drives Step into verification/failure lifecycle correctly. |
| #21 | `feature/automation-native-step-executor` | `a9223d30e5cd5cfd2919994fa3a3802dc7250fa2` | First bounded PURE/read-only Native Step executor; reuses existing Native runtime and exact reconcile identity. |
| #22 | `feature/automation-step-verification-contract` | `f26e9700525e4095541e206016d77a7f6caaf2f4` | Persists optional typed verifier policy in immutable PlanVersion canonical truth. |
| #24 | `feature/automation-step-verifier` | `a140d4d14abd9f451a7a10d567a16b01be883f5f` | Deterministic workflow-truth verifier; v1 executes only HASH_MATCH and advances PASS to REVIEWING. |
| #25 | `feature/automation-step-review-completion` | `7bd5fbf40af95f66ff4709ae7b1526b0ff3877b1` | Explicit USER review Evidence completes or rejects a verified Step without rewriting execution truth. |

PR #25 was explicitly observed as Draft, open, and unmerged at its exact final head.

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

Main Review chain validation:

- workflow run: `33242609682`
- job: `99074398135`
- result: bounded/static ownership guard, TypeScript, targeted Review/Verifier/Executor tests, full repository tests, build, and self-clean all green

Verifier-Evidence provenance hardening:

- workflow run: `33242710265`
- job: `99074660530`
- result: bounded provenance guard, TypeScript, targeted governance-chain tests, full repository tests, build, and self-clean all green

Final #25 diff against #24 contains only:

- `src/automation/step-review-service.ts`
- `src/main/automation-execution-facade.ts`
- `tests/automation-step-review-completion.test.ts`

The temporary validation workflow is absent from the final head.

## 4. Current end-to-end governance chain

The bounded v1 chain is now:

1. **Plan truth**
   - Planner may attach optional typed verifier policy to a Step candidate.
   - The exact normalized PlanCandidate is persisted in immutable `PlanVersion.canonicalPayload` and bound by `payloadSha256`.
   - Verifier policy is not copied into StepSpec as a second truth source.

2. **Execution truth**
   - First executor slice is deliberately limited to `sideEffectClass=PURE` and existing attached Native Thread execution.
   - Native runtime remains Codex-owned.
   - Workbench persists opaque Native Turn identity / hashes / receipts, not raw transcript ownership.
   - Accepted-but-unknown work is reconciled without a second submit.
   - successful ExecutionAttempt truth advances the Step to `VERIFYING`.

3. **Verification truth**
   - `DeterministicStepVerificationService` consumes immutable Plan policy plus already-persisted workflow truth only.
   - It does not start Native Turns, invoke providers, run shell text, own a sandbox, or inspect a transcript.
   - v1 auto-executes only `HASH_MATCH` with exact data instruction `result-sha256:<64 lowercase hex>`.
   - PASS writes bounded `STEP_VERIFICATION` Evidence and advances `VERIFYING -> REVIEWING`.
   - explicit mismatch writes FAIL Evidence and terminates the Step as failed.
   - missing/malformed/unsupported verifier policy fails closed and leaves the Step in `VERIFYING`.

4. **Review truth**
   - `StepReviewCompletionService` requires exactly one PASS verifier Evidence bound to the exact project/stage/step/execution-attempt/active-plan identity.
   - Accepted verifier Evidence must also have `source=WORKFLOW_TRUTH`, producer `workbench-step-verifier-v1`, and metadata `verifierProtocol=workbench-step-verifier-v1`.
   - Review writes one immutable `STEP_REVIEW` Evidence before the terminal transition.
   - `APPROVE` drives `REVIEWING -> TERMINAL/COMPLETED`.
   - `REJECT` drives `REVIEWING -> TERMINAL/FAILED` while the already-successful ExecutionAttempt remains `COMPLETED/COMPLETED`.
   - review Evidence identity deliberately does not include the decision, so one execution attempt has one immutable decision slot.
   - same decision/provenance replay is idempotent; conflicting decision or reviewer provenance fails closed.
   - `reviewerRef` is optional provenance only; authentication/authorization remains a caller/UI boundary concern.

## 5. Important negative guarantees

The current execution-governance work intentionally does **not** add:

- a second Codex runtime, transcript, context manager, sandbox, tool executor, or subagent system
- a second provider transport
- raw Native prompt/response persistence in Automation workflow truth
- executable verification-plan text
- a schema migration for Review
- a durable `ReviewResult` or `GateDecision` entity
- use of provider `REQUIRE_HUMAN_GATE` as reviewer approval truth

`REQUIRE_HUMAN_GATE` remains dispatch authorization semantics; it must not be silently reinterpreted as post-execution Review/Gate evidence.

## 6. Gate question that remains open

The exact current schema/state machine has `REVIEWING` and `TERMINAL`, but no durable independent Gate entity/state. PR #25 currently terminalizes the Step from explicit Review.

Before adding a separate Gate implementation, the next slice must decide from repository policy/requirements which of these is authoritative:

1. **v1 Review-is-final-gate** — explicit USER Review is the final governance gate for the bounded Step chain; no second Gate entity is introduced unless a concrete policy requires it.
2. **separate Gate truth** — a distinct policy/gate decision is required after Review. This cannot be bolted on after `TERMINAL`; it would require an explicit lifecycle/data contract change rather than an ad-hoc extra Evidence record.

Do not solve this by reusing provider dispatch `REQUIRE_HUMAN_GATE` or by treating Verifier PASS as completion.

## 7. Next exact work

1. Audit current PolicyVersion / risk / human-gate semantics at the #25 exact head.
2. Search exact architecture/requirement docs for a normative independent Gate requirement.
3. If no independent Gate requirement exists, freeze **Review-is-final-gate for v1** with an architecture contract test/documentation rather than inventing another state machine.
4. If an independent Gate is explicitly required, design its lifecycle and durable truth first, then implement it as a separate bounded stacked PR.
5. After Gate semantics are frozen, continue orchestration scheduling of the next eligible Step/Stage without changing Codex-native ownership.
