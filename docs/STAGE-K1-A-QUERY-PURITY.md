# STAGE-K1-A Query Purity

## Pure operations

The K1-A read surface is:

- `AutomationStore.get`
- `AutomationStore.list`
- `AutomationStore.getCurrentPlanVersion`
- existing evidence/correlation reads
- existing `inspect` for inspection-only behavior

Each operation snapshots and clones data. No query creates a PlanVersion, changes `activePlanVersionId`, repairs a migration, updates RequirementVersion, starts a provider request, or creates a Native Thread.

## Non-pure operational API

`persistenceDiagnostics` is deliberately separate. It calls the operational persistence initialization path and therefore is not used as evidence for query purity.

## Test proof

The K1-A test hashes the durable file, performs `getCurrentPlanVersion`, `get`, and `list`, then hashes it again. The hashes match. It also closes and reopens the store and verifies the selected PlanVersion without any write-side repair.
