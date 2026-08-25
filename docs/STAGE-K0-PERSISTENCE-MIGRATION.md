# STAGE-K0 Persistence and Migration

## JSON snapshot path

The existing JSON migration path parses and validates the source, creates a
side-by-side SQLite candidate, writes the migrated v4 document, verifies
identity, then renames the source to a timestamped backup before promoting the
candidate. A failed candidate is removed and the source remains canonical.

## SQLite v2/v3 path

The K0 path:

1. Detects document schema v2 or v3 in metadata.
2. Copies an explicit `.v2-backup-*` or `.v3-backup-*` SQLite source.
3. Reads legacy rows without applying the current v4 validator prematurely.
4. Upgrades rows to v4 and materializes RequirementOrigin rows.
5. Rewrites the canonical tables in one `BEGIN IMMEDIATE` transaction.
6. Writes migration source hash/path/timestamp and current schema metadata.
7. Commits only after every row passes the persistence boundary.
8. Rolls back on any error, preserving the prior canonical snapshot.

## Recovery guarantees

- A corrupt or incomplete candidate is never promoted.
- A failed transaction does not publish a partial origin/version chain.
- Existing IDs are checked by the migration identity comparator.
- No migration copies V1 Native Thread/Turn/Item or WebGPT transcript data.

## Evidence

The migration and rollback tests in `tests/automation-foundation.test.ts` and
`tests/automation-persistence.test.ts` pass, including interrupted migration,
SQLite rollback, v1/v2 compatibility, identity preservation, and corrupt
candidate recovery.
