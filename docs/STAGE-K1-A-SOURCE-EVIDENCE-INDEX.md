# STAGE-K1-A Source Evidence Index

## Implementation

- `src/automation/types.ts:317-382` — PlanVersion provenance, StageSpec, StepSpec additive domain fields and Step ordinal.
- `src/automation/store.ts:151-229,369-381,560-678,844-1075,1720-1726` — immutable replacement guards, exact Requirement/hash correlation, Plan creation, active selection, Stage/Step version/ordinal persistence, pure current-plan query, bounded definition values.
- `src/automation/schema.ts:65,213-300,620-925,1102-1205` — v4 validation, active Plan/Requirement/hash convergence, duplicate/predecessor checks, current-v4 additive normalization, bounded field checks.
- `src/automation/sqlite-persistence.ts:336-356,418-447` — query-only SQLite reads normalize current-schema legacy rows in memory.
- `tests/stage-k1-a-plan-domain.test.ts:1-257` — targeted round-trip, immutability/pointer/hash attacks, duplicate/gap/conflict/ordinal checks, SQLite restart normalization, migration/rollback/query-purity evidence.

## Reused baseline

- `src/automation/index.ts` — exports existing K0 store/schema/migration contracts.
- Existing `tests/automation-persistence.test.ts`, `tests/automation-foundation.test.ts`, `tests/aut3-planner.test.ts` — regression coverage for persistence, runtime separation, and historical Planner compatibility.
- `docs/STAGE-K1-A-REALITY-CHECK.md` — pre-change inventory and scope classification.

Line numbers were captured after the K1-A challenge-fix source edit; the final implementation commit is recorded in the package provenance.
