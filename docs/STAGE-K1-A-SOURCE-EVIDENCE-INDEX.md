# STAGE-K1-A Source Evidence Index

## Implementation

- `src/automation/types.ts:317-379` — PlanVersion, StageSpec, StepSpec additive domain fields.
- `src/automation/store.ts:151-226,359-374,601-672,839-1061,1720-1726` — immutable replacement guards, exact Requirement correlation, Plan creation, active selection, Stage/Step persistence, pure current-plan query, bounded definition values.
- `src/automation/schema.ts:65,232-291,620-911,1059-1123` — v4 validation, same-plan current-stage reference, additive legacy migration, bounded field checks.
- `tests/stage-k1-a-plan-domain.test.ts:1-199` — targeted round-trip, immutability/pointer/correlation, migration/rollback/query-purity evidence.

## Reused baseline

- `src/automation/index.ts` — exports existing K0 store/schema/migration contracts.
- Existing `tests/automation-persistence.test.ts`, `tests/automation-foundation.test.ts`, `tests/aut3-planner.test.ts` — regression coverage for persistence, runtime separation, and historical Planner compatibility.
- `docs/STAGE-K1-A-REALITY-CHECK.md` — pre-change inventory and scope classification.

Line numbers were captured after the final source edit and are tied to implementation commit `58a090e`.
