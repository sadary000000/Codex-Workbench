# STAGE-K1-A Persistence Boundary

## Reuse of K0

K1-A reuses the existing `AutomationStore` transaction boundary, SQLite/JSON inspection and migration code, writer lock, immutable identity checks, audit chain, and snapshot-based query surface. No second persistence truth is introduced.

Durable Plan data lives in the existing automation persistence collections: `automationProjects`, `planVersions`, `stageSpecs`, `stepSpecs`, `stepRuntimes`, and `auditEvents`. The project pointer is stored on `AutomationProject`; it is not encoded by mutating a historical PlanVersion. Validation rejects an active pointer to a DRAFT/SUPERSEDED plan, a stale RequirementVersion, or a mismatched requirement hash.

## Write path

Mutations run through `AutomationStore.transaction`. The store clones the prior document, applies the operation, validates the complete document, and commits through the existing persistence writer. A failed transaction leaves the previous durable snapshot and audit chain unchanged. Plan/Stage/Step definitions are immutable under generic replacement; new versions use insertion and explicit `supersedes` lineage. Duplicate project/version, stage key/version, and step key/version definitions are rejected, as are version gaps without an immediate predecessor. Step order is persisted as a stable ordinal.

## Read path

`get`, `list`, `getCurrentPlanVersion`, and correlation reads use a cloned snapshot. They do not acquire the writer lock, create directories, perform reconciliation, change active pointers, or call a provider. `persistenceDiagnostics` is intentionally operational and may initialize persistence; it is not presented as a pure domain query.

## Privacy and execution boundary

The Plan domain stores bounded structured definitions and hashes. It does not persist browser DOM, cookies, tokens, browser handles, raw GPT transcripts, or a duplicate Requirement payload truth. `StepRuntime` remains the separate existing execution projection.

## Restart evidence

The K1-A targeted suite closes and reopens the same store, then reads the exact StageSpec, StepSpec, PlanVersion, and active Plan pointer. It also reads a deliberately legacy-shaped current-v4 SQLite row and verifies additive fields are normalized in memory without a provider action. The reopened values are equal to the pre-close values. No provider, Native Thread, or business chat is involved.
