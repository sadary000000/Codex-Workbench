# ARCH-V2-7 Migration Inventory

| Source | Target | Compatibility status | Write trigger | Identity rule |
|---|---|---|---|---|
| Automation JSON v0/v1/v2 | Automation SQLite schema v3 / `sqlite-record-v1` | `MIGRATION_REQUIRED` | `AutomationMigrationService.migrate()` / `AutomationStore.migrate()` | all table IDs and correlation fields unchanged |
| Current Automation SQLite | same SQLite format | `READ_COMPATIBLE` | none on inspect/read | no-op |
| Missing Automation file | empty target on explicit migrate | `READ_COMPATIBLE` before open; `MIGRATED` after explicit create | explicit migrate | no historical identity exists |
| Unsupported/future Automation version | no target | `UNSUPPORTED` | never automatic | fail-closed |
| Corrupt Automation JSON/SQLite | no target | `CORRUPT` | never automatic | source remains untouched |
| WebGPT Request Journal v1 | v2 Journal | `MIGRATION_REQUIRED` by explicit manager `migrate()` | `WebGptRequestManager.migrate()` | requestId/idempotency/semantic/target facts unchanged |
| V1 PromptRecovery legacy raw prompt | hash/length/ref-only record | read-compatible in memory; scrubbed on next canonical write | explicit V1 mutation or migration boundary | localRunId/nativeThreadId/turnId/status/error unchanged |

## Migration safety

- JSON→SQLite writes a temporary candidate, validates it, and records source hash/backup metadata.
- Interrupted candidate recovery validates the SQLite candidate before promotion.
- Interrupted JSON backup recovery validates JSON/schema again before promotion; invalid backup is not renamed into the canonical path.
- `assertMigrationIdentityPreserved()` compares stable IDs and correlation fields before/after.
