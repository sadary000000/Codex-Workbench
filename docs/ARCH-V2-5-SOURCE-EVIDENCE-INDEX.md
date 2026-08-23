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
