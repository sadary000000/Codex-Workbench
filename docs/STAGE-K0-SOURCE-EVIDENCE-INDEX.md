# STAGE-K0 Source Evidence Index

Date: `2026-08-26`

## Domain and persistence

| concern | source |
|---|---|
| domain types and lifecycle states | `src/automation/types.ts` |
| origin, version, active-pointer validation | `src/automation/schema.ts` |
| immutable writes, predecessor chain, confirmation transaction | `src/automation/store.ts`, `src/automation/requirement-service.ts` |
| canonical identity, raw legacy mapping delta, and migration comparison | `src/automation/migration-identity.ts`, `src/automation/stable-identity.ts` |
| migration and SQLite load boundary | `src/automation/migration-contract.ts`, `src/automation/sqlite-persistence.ts` |
| opaque InputRef boundary | `src/automation/input-ref.ts`, `src/automation/store.ts`, `src/automation/schema.ts` |

## Policy / provider / recovery

| concern | source |
|---|---|
| project-scoped policy pinning | `src/automation/adapters.ts`, `src/automation/webgpt-policy-authority.ts` |
| Requirement provider dispatch | `src/automation/requirement-provider-dispatch.ts` |
| project-scoped provider correlation | `src/features/webgpt/automation/webgpt-provider-port.ts` |
| durable accepted-side-effect UNKNOWN | `src/automation/store.ts` |
| observation / receipt correlation | `src/automation/store.ts`, `src/automation/webgpt-external-action.ts` |
| paused legacy Bridge / live provider-neutral composition | `src/automation/webgpt-external-action.ts`, `src/main/main.ts` |
| atomic accepted-provider UNKNOWN marker | `src/automation/store.ts`, `src/automation/webgpt-external-action.ts` |

## Review and audit documents

- `docs/STAGE-K0-HOLD-REUSE-AUDIT.md`
- `docs/STAGE-K0-REALITY-CHECK.md`
- `docs/STAGE-K0-AUTOMATION-FOUNDATION-CONTRACT.md`
- `docs/STAGE-K0-DOMAIN-OWNERSHIP.md`
- `docs/STAGE-K0-PERSISTENCE-BOUNDARY.md`
- `docs/STAGE-K0-ACTION-RECOVERY-CONTRACT.md`
- `docs/STAGE-K0-PROVIDER-BOUNDARY.md`
- `docs/STAGE-K0-DEFERRED-DEBT.md`
- `docs/STAGE-K0-VALIDATION-EVIDENCE.txt`
- `docs/STAGE-K0-SOURCE-INVENTORY.txt`

## Tests

- `tests/automation-foundation.test.ts`
- `tests/automation-persistence.test.ts`
- `tests/aut-r0-requirement-provider.test.ts`
- `tests/aut2-requirement-service.test.ts`
- `tests/arch-v2-4-external-action.test.ts`
- `tests/arch-v2-4-fix-round-1.test.ts`
- `tests/arch-v2-7-review-harness.test.ts`
- `tests/aut3-planner.test.ts`
- `tests/arch-v2-8-fix-round-3.test.ts`

The final package must exclude cookies, tokens, browser profiles, user chat content, raw prompts, and unrelated historical artifacts.
