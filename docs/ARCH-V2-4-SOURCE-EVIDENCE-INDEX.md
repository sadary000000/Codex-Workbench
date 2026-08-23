# ARCH-V2-4 Source Evidence Index — FIX ROUND 1

> **Current authoritative addendum:** The Round 2 evidence index is `ARCH-V2-4-FIX-ROUND-2.md` and its companion FIX-01/02/03 evidence files. The Round 1 entries below remain historical.

## Implementation

- `src/automation/webgpt-external-action.ts` — dispatch facts/context, provider bridge, accepted-local-failure recovery, reconcile state, production adapter.
- `src/automation/webgpt-action-readiness.ts` — existing scope-aware classifier reused by `buildWebGptDispatchContext()`.
- `src/features/webgpt/runtime/webgpt-operation-arbiter.ts` — single live Browser lease identity and diagnostics.
- `src/features/webgpt/runtime/webgpt-request-manager.ts` — read-only status, explicit reconcile, live lease snapshot bridge, control ownership.

## Tests

- `tests/arch-v2-4-external-action.test.ts` — mapping, production adapter lease correlation, observation/retry behavior.
- `tests/arch-v2-4-fix-round-1.test.ts` — FIX-01/FIX-04/FIX-05/FIX-07 targeted gates.
- `tests/webgpt-action-readiness.test.ts` — unrelated history, same-side-effect, lease and semantic blockers.
- `tests/webgpt-operation-arbiter.test.ts` / `tests/webgpt-request-manager.test.ts` — live lease, control and explicit reconciliation boundaries.

## Real evidence

- `dist/review/WEBGPT-WEB6.4-REAL-GATE.json` — second safe control/arbiter smoke; no real prompts and Journal SHA unchanged in that run.
- `docs/ARCH-V2-4-REAL-REGRESSION-MATRIX.json` — historical regression matrix, supplemented by current command outputs in the FIX ROUND 1 report.

## Provenance and safety

- base `da9c7b9`, prior implementation `d304e70`;
- current source/test/script overlay is intentionally dirty and selectively reviewed;
- no Cookie, Token, Password, browser profile, private chat, full Journal or prompt body is included in the package.
