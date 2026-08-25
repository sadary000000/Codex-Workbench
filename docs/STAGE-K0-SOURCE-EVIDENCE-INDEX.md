# STAGE-K0 Source Evidence Index

## Domain and persistence

| concern | source |
|---|---|
| schema/version and origin validation | `src/automation/types.ts`, `src/automation/schema.ts` |
| immutable writes and predecessor rules | `src/automation/store.ts` |
| canonical identity comparison | `src/automation/migration-identity.ts`, `src/automation/stable-identity.ts` |
| v4 migration and rollback | `src/automation/migration-contract.ts`, `src/automation/sqlite-persistence.ts` |
| Requirement service origins | `src/automation/requirement-service.ts` |

## Policy / provider / recovery

| concern | source |
|---|---|
| project-scoped policy evaluation | `src/automation/webgpt-policy-authority.ts`, `src/automation/effective-policy.ts` |
| Requirement provider dispatch | `src/automation/requirement-provider-dispatch.ts` |
| provider request reattachment | `src/automation/adapters.ts`, `src/features/webgpt/automation/webgpt-provider-port.ts` |
| observation / receipt correlation | `src/automation/webgpt-external-action.ts`, `src/automation/store.ts` |
| generic reconcile fail-closed boundary | `src/main/main.ts` |

## Tests

- `tests/automation-foundation.test.ts`
- `tests/automation-persistence.test.ts`
- `tests/aut-r0-requirement-provider.test.ts`
- `tests/arch-v2-4-external-action.test.ts`
- `tests/arch-v2-6-provider-boundary.test.ts`
- `tests/arch-v2-7-review-harness.test.ts`
- `tests/arch-v2-8-fix-round-3.test.ts`
- `tests/webgpt-control-contract.test.ts`
- `tests/webgpt-request-manager.test.ts`

The final package includes this index, the stage reports, exact command
outputs, and the provenance manifest. It excludes cookies, tokens, browser
profiles, user chats, and unrelated historical packages.
