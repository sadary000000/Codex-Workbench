# AUT-1.5 Persistence Migration and Recovery

## Migration model

Migration is side-by-side and fail-closed:

1. Detect the active path as missing, SQLite, JSON, or unknown.
2. Validate an existing JSON document against the current bounded Automation schema.
3. Create a uniquely named temporary SQLite candidate beside the active file.
4. Import the complete validated document in one transaction.
5. Write format/schema/writer/provenance metadata, including the source JSON SHA-256.
6. Close the candidate, rename the JSON source to a unique `.v2-backup-<timestamp>-<suffix>.json`, then rename the candidate to the active database path.
7. Reopen and validate the SQLite document before reporting success.

The original JSON is preserved as a rollback backup. Migration never silently replaces malformed, future-version, or unknown data with an empty document.

## Provenance

The database metadata records the source document schema version, source SHA-256, backup path, and migration timestamp. This makes the conversion auditable without storing private page data or credentials.

## Interrupted migration

On startup, if the active database is absent, the store first searches for a valid migration candidate and promotes it only after validation. If no valid candidate exists, it restores the newest valid JSON backup. A corrupt candidate, unsupported persistence version, or invalid source fails closed with a typed persistence error and leaves the source files available for diagnosis.

## Compatibility and safety

- SQLite persistence schema versions newer than the supported version return `AUTOMATION_DB_VERSION_UNSUPPORTED`.
- Corrupt headers or invalid rows return `AUTOMATION_DB_CORRUPT` / `AUTOMATION_DB_INVALID`.
- Migration errors return `AUTOMATION_MIGRATION_FAILED` and do not claim a successful replacement.
- Unknown record fields are checked at the persistence boundary; sensitive names such as prompt, response, transcript, cookie, token, authorization, password, credential, secret, raw body, stdout, and stderr fail closed.
- Nested persisted values are bounded by depth and JSON record validation before insertion.

## Idempotency and retry semantics

`ActionAttempt` is one-to-many per `ActionIntent`, keyed by `(intentId, dispatchNumber)`. A retry after `FAILED`, `UNCERTAIN`, or `RECOVERY_REQUIRED` requires explicit `REAUTHORIZE_RETRY` and creates a new dispatch number. Each attempt has at most one receipt. An `UNKNOWN` receipt must remain `RECOVERY_REQUIRED`; it cannot be overwritten as an ordinary success or failure and cannot receive a second receipt.
