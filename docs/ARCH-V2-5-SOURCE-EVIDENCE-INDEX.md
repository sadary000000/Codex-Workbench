# ARCH-V2-5 FIX ROUND 1 Source Evidence Index

| Evidence | Purpose |
|---|---|
| src/automation/webgpt-policy-authority.ts | stable persisted PolicyVersion and single host budget authority |
| src/features/webgpt/runtime/webgpt-request-manager.ts | production Prompt/NewChat pin, admission and commit boundary |
| src/automation/requirement-webgpt-adapter.ts | repair pre-dispatch release and commit-before-transport |
| src/automation/effective-policy.ts | pin correlation and pinned resolver fail-closed |
| src/automation/webgpt-external-action.ts | policyVersionId propagation into provider evidence |
| src/main/main.ts | normal production authority injection |
| tests/arch-v2-5-production-consumers.test.ts | Prompt/Retry/NewChat, legacy unpinned, reservation evidence |
| docs/ARCH-V2-5-BUDGET-CALLER-INVENTORY.md | caller classification |
| docs/ARCH-V2-5-RESERVATION-LIFECYCLE.md | reserve/commit/release semantics |

No Cookie, Token, browser profile, private Chat content or raw user credential is
included in the review package.

## FIX ROUND 2 additions

| Evidence | Purpose |
|---|---|
| package.json | formal source-test discovery boundary |
| src/main/main.ts | normal startup / explicit smoke branch correction |
| scripts/real-webgpt-web6.6-protocol-smoke.ts | bounded packaged Control Plane and official CLI Runtime smoke |
| dist-stage-arch-v2-5-fix-round-2/review/WEBGPT-WEB6.6-REAL-GATE.json | sanitized final packaged status evidence |
| docs/ARCH-V2-5-FIX-ROUND-2.md | GPT finding-to-fix mapping and final gate |

The final evidence retains only booleans, bounded status/result fields, error codes,
timings, schema hash and sanitized paths. Auth token values and userData contents are
not included.
