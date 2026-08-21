# AUT-1.5 Persistence Decision

## Decision

```yaml
stage: AUT-1.5 Persistence Readiness & Productionization Gate
decision: MIGRATE_EMBEDDED_DB
engine: node:sqlite / DatabaseSync
persistence_format: sqlite-record-v1
persistence_schema_version: 1
document_schema_version: 2
writer_authority: Workbench Automation Host
v1_core_changed: NO
webgpt_v1_changed: NO
```

AUT-1.5 selects an embedded SQLite store for the Automation domain. This is not a replacement for the V1 runtime facts: Native Thread remains the only Native conversation identity, Native Turn/Item remain the only Native message and execution facts, and Codex App Server remains the Runtime path. The Automation store is a bounded, separate persistence boundary for future automation state.

## Why SQLite

- The packaged Electron runtime is Electron `43.3.0`, Node `24.18.1`, and SQLite `3.53.1`.
- The packaged Electron executable exposes the built-in `node:sqlite` module and `DatabaseSync`; no new npm package, native addon, installer, or system configuration was added.
- Transactions, rollback, durable restart recovery, bounded records, and deterministic migrations are available without introducing a second application database service.
- The store uses `BEGIN IMMEDIATE`, `busy_timeout = 2000`, `journal_mode = DELETE`, `synchronous = FULL`, and `foreign_keys = ON`.
- DELETE rollback journaling is intentional for the current packaged Windows boundary. WAL is not enabled in this phase.

## Boundary

The SQLite store contains only the Automation document tables: projects, plan/stage specifications, execution/action attempts, receipts, external references, evidence metadata, artifacts, resource claims, workspace snapshots, policy versions, checkpoints, and bounded audit events. It does not import or reconstruct Native Thread/Turn/Item history, WebGPT page content, cookies, tokens, prompts, responses, transcript text, or shell output.

The persisted document remains schema version 2. The SQLite persistence schema is version 1. The two versions are recorded separately in `automation_meta` and rejected when incompatible.

## Write authority

`Workbench Automation Host` is the single writer authority. `AutomationStore` acquires a per-database writer marker and rejects a second process with `AUTOMATION_DB_LOCKED`; it does not permit two independent processes to merge stale snapshots. Same-process callers are serialized through the existing store tail and SQLite transaction boundary. Direct multi-process database writing is intentionally unsupported in AUT-1.5.

## Gate position

The implementation and automated evidence are ready for GPT review. No real Native or WebGPT execution was started, and no real prompt was sent.
