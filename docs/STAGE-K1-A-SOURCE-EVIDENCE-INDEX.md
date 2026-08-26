# STAGE-K1-A Source Evidence Index

## Implementation

- `src/automation/types.ts` — PlanVersion, StageSpec, StepSpec additive domain fields.
- `src/automation/store.ts` — immutable replacement guards, exact Requirement correlation, Plan creation, active selection, Stage/Step persistence, pure current-plan query, bounded definition values.
- `src/automation/schema.ts` — v4 validation, same-plan current-stage reference, additive legacy migration, bounded field checks.
- `tests/stage-k1-a-plan-domain.test.ts` — targeted round-trip, immutability/pointer/correlation, migration/rollback/query-purity evidence.

## Reused baseline

- `src/automation/index.ts` — exports existing K0 store/schema/migration contracts.
- Existing `tests/automation-persistence.test.ts`, `tests/automation-foundation.test.ts`, `tests/aut3-planner.test.ts` — regression coverage for persistence, runtime separation, and historical Planner compatibility.
- `docs/STAGE-K1-A-REALITY-CHECK.md` — pre-change inventory and scope classification.

Line numbers are generated into the final package manifest after the last source edit so the index remains tied to the frozen tree.
