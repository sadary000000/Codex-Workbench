# STAGE-K1-A Migration and Rollback

## Strategy

K1-A keeps the current automation schema version at the K0-compatible v4 boundary and makes the Plan additions additive. Existing v0/v1/v2/v3 inputs continue through the established migration chain and then pass through the v3-to-v4 normalizer.

Legacy minimal StageSpec rows receive bounded defaults: `name` from `stageKey`, `objective` from `goal`, empty definition arrays, and `detailLevel: OUTLINE`. Legacy StepSpec rows receive `objective` from `goal`, a deterministic per-stage `ordinal`, and empty definition arrays. Legacy plan rows have their Requirement hash rebound to the migrated canonical Requirement payload; current-schema rows with an existing hash are never silently repaired. IDs, project/plan/stage references, order, status, timestamps, and predecessor lineage are preserved.

## Safety contract

```text
validate source
  -> migrate in memory / transaction boundary
  -> validate destination
  -> promote through the existing persistence writer
  -> retain rollback evidence on failure
```

The existing K0 migration implementation remains responsible for backup/side-by-side recovery and unsupported-version fail-closed behavior. K1-A does not introduce a destructive migration or alter production database paths.

## Evidence

The targeted K1-A suite constructs a legacy v3 document with the additive fields removed, migrates it to v4, verifies the new fields and references, and injects a transaction failure. It also mutates a current-schema SQLite row to the old minimal shape, closes/reopens it, and verifies in-memory normalization without changing the migration boundary. Legacy v1/v2/v3 plan hashes are explicitly rebound as part of their existing migration; current v4 hash mismatches remain fail-closed. The failure leaves the canonical file hash unchanged. The full K0 migration and rollback regression suite also remains green in the 447-test run.

## Deferred

No schema v5 is needed for this additive field set. A future schema change must preserve RequirementVersion, PolicyVersion, Action Ledger, and AutomationProject identity and must obtain a new stage authorization.
