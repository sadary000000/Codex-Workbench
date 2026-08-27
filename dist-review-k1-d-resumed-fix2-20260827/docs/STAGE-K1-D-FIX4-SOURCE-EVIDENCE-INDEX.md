# STAGE-K1-D Fix Round 4 Source and Evidence Index

## Round evidence

- `docs/STAGE-K1-D-FIX4-EVIDENCE-20260827.json` — bounded result classification, three audits, validation, safety, and provenance.
- `docs/STAGE-K1-D-FIX4-REVIEW.md` — human-readable Review package summary.
- `docs/STAGE-K1-D-FIX4-SUBAGENTS.md` — exact new read-only audit record.
- `docs/STAGE-K1-D-FIX4-PROVENANCE.txt` — source, commit, build, and artifact provenance.

## Existing-request evidence

- `docs/STAGE-K1-D-REAL-PLANNER-EVIDENCE-RESUMED-20260827.json` — original one-send smoke.
- `docs/STAGE-K1-D-RECOVERY-LEDGER-EVIDENCE-20260827.json` — existing-request-only ledger reconstruction.
- `docs/STAGE-K1-D-RECOVERY-RECONCILIATION-EVIDENCE-20260827.json` — same-request reconcile and reopened persistence result.

## Implementation source

- `src/shared/chat-url-identity.ts` — shared URL normalization, equivalence, and stable conversation identity key.
- `src/features/webgpt/runtime/webgpt-role-session-registry.ts` — Role binding and collision identity.
- `src/features/webgpt/runtime/webgpt-request-manager.ts` — request target, recovery, semantic/idempotency, and legacy-hash compatibility.
- `src/features/webgpt/runtime/webgpt-target-readiness.ts` — target readiness identity.
- `src/features/webgpt/automation/webgpt-provider-port.ts` — provider observation identity.
- `src/automation/webgpt-external-action.ts` — external action target correlation.
- `src/automation/planner-webgpt-adapter.ts` — Planner target identity.
- `src/automation/requirement-webgpt-adapter.ts` — URL alias comparison with opaque-ref fallback.
- `src/automation/aut2-real-webgpt-gate.ts` — AUT-2 identity gate.
- `src/automation/aut3-real-planner-gate.ts` — AUT-3 identity gate.
- `src/automation/stage-k1-d-real-planner-smoke.ts` — K1-D smoke evidence matching.
- `src/main/main.ts` — production binding validation and composition.

## Tests

- `tests/webgpt-role-session-registry.test.ts`
- `tests/webgpt-target-readiness.test.ts`
- `tests/webgpt-request-manager.test.ts`
- `tests/arch-v2-6-provider-boundary.test.ts`
- `tests/aut2-requirement-webgpt-adapter.test.ts`

The package contains the corresponding audited source excerpts and tests. The raw request result is not included.
