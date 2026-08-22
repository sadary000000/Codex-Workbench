# ARCH-V2-4 Source Evidence Index

## Implementation

- `src/automation/types.ts` — outcome certainty, provider correlation, ExternalRef and ResourceClaim fields.
- `src/automation/schema.ts` — new field validation, legacy defaults, project-scoped ref validation.
- `src/automation/store.ts` — provider attachment, single Receipt reconciliation, ActionAttempt transition, lease mapping.
- `src/automation/webgpt-external-action.ts` — pure dispatch gate and WebGPT provider bridge.
- `src/automation/index.ts` — public module export.
- `src/features/webgpt/runtime/webgpt-operation-arbiter.ts` — existing live lease epoch/diagnostics.

## Tests

- `tests/arch-v2-4-external-action.test.ts` — mapping, lease, unknown/reconcile, retry, single Receipt.
- `tests/webgpt-action-readiness.test.ts` — scope-aware history and fail-closed blockers, including 15 unrelated records.

## Existing boundaries audited

- `src/features/webgpt/runtime/webgpt-request-manager.ts` — RequestRecord/Journal/idempotency/reconcile authority.
- `src/automation/requirement-service.ts` and WebGPT adapters — no provider observation -> Workflow PASS write.
- `src/features/webgpt/runtime/webgpt-operation-arbiter.ts` — single live browser owner.
