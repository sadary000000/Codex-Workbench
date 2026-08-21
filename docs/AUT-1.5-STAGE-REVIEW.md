# AUT-1.5 Persistence Readiness & Productionization Gate

## Executive summary

```yaml
stage: AUT-1.5 Persistence Readiness & Productionization Gate
result: PASS_CANDIDATE
persistence_decision: MIGRATE_EMBEDDED_DB
engine: node:sqlite / DatabaseSync
implementation_commit: 954f32d
base_commit: 9b30aa8
v1_core_changed: NO
webgpt_v1_changed: NO
real_native_execution_started: NO
real_webgpt_execution_started: NO
```

AUT-1.5 productionizes persistence for the AUT Automation domain. It does not enter AUT-2 and does not add an Automation workflow, Planner, Reviewer, Scheduler, or real execution path.

## Architecture boundary

```text
V1 Frozen Core
  Native Thread -> sole conversation identity
  Native Turn / Native Item -> sole message and runtime facts
  Codex App Server -> Runtime main path

AUT Automation extension
  Workbench Automation Host
    -> bounded SQLite persistence
    -> schema/state validation
    -> migration/recovery metadata
    -> audit/checkpoint/receipt durability
```

The Automation store is not a second Conversation truth, Transcript truth, Task truth, Context truth, or exec-history reconstruction. WebGPT and V1 Native paths were not modified by this stage.

## Scope and implementation

- Added `src/automation/sqlite-persistence.ts` using the packaged Electron built-in `node:sqlite` runtime.
- Switched `AutomationStore` from the old JSON write path to side-by-side SQLite persistence while retaining bounded document validation and JSON migration.
- Added an exclusive writer marker and typed lock/migration/persistence errors.
- Added rollback-journal durability, full synchronous mode, foreign keys, busy timeout, migration provenance, backup/recovery, diagnostics, and sensitive-field boundary rejection.
- Preserved `ActionIntent`/`ActionAttempt`/`ActionReceipt` semantics with explicit reauthorization and one receipt per attempt.
- Included the Automation directory in Windows packaging.
- Added crash, migration, writer authority, privacy boundary, receipt idempotency, and scale tests.

## Gate matrix

| Gate | Result | Evidence |
|---|---|---|
| Persistence decision | PASS | `MIGRATE_EMBEDDED_DB`, built-in SQLite |
| Schema versioning | PASS | persistence v1, document v2, fail-closed future versions |
| Single writer authority | PASS | same-process serialization and cross-process lock rejection |
| Migration | PASS | side-by-side JSON v2 migration, backup, SHA/provenance, interrupted recovery |
| Crash recovery | PASS | rollback, restart durability, corrupted/future store rejection |
| Scale | PASS | 91,300 bounded records under 60 seconds |
| Concurrency | PASS | 25 same-process writers; competing process rejected |
| Packaged Windows | PASS | `dist/package/Codex Workbench V1.exe` create/reopen smoke |
| Requirement truth regression | PASS | full suite |
| Action idempotency regression | PASS | retry/receipt contract tests |
| Checkpoint regression | PASS | checkpoint/reference tests |
| Audit regression | PASS | append-only and sequence tests |

## Automated verification

```text
npm run check                 PASS
npm test                      PASS — 237/237
npm run build                 PASS
npm run package:win           PASS
npm audit --omit=dev         PASS — 0 vulnerabilities
git diff --check              PASS
secret scan                   PASS
```

The packaged smoke used the host Node `execFile` API to invoke the packaged EXE twice with an isolated temporary database and `ELECTRON_RUN_AS_NODE=1`. It created and reopened the same Automation project, preserved the project ID, and returned the expected SQLite diagnostics. No prompt or external action was sent.

## Subagents

| Agent | Task | Result | Adopted |
|---|---|---|---|
| Dirac | Packaged Electron/node:sqlite capability audit | Electron 43.3.0 / Node 24.18.1 / SQLite 3.53.1 available; no new dependency | Yes |
| Poincare | Crash, scale, and concurrency audit | Found and verified lock, rollback, migration, and scale requirements; identified pre-fix stale-writer and receipt risks | Yes |
| Peirce | Schema, migration, and boundary audit | Verified version/provenance, retry, receipt, checkpoint, and privacy-boundary invariants | Yes |

All agents returned before integration and are closed. `running_subagents_at_gate: 0`.

## Accepted limitations

- This is a single Workbench Automation Host writer; multi-process direct database writes are rejected, not merged.
- SQLite rollback journal cleanup is an implementation detail; a hard kill may leave a transient journal that SQLite recovers on reopen.
- The persistence boundary stores bounded metadata and state only; it does not provide exactly-once guarantees for external side effects.
- Automation remains a foundation only. AUT-2, workflow execution, Planner/Reviewer behavior, and real Native/WebGPT execution are not part of this stage.

## Provenance and review package

```yaml
implementation_commit: 954f32d
review_commit: documentation/package commit (reported in final gate)
package: D:\办公\AI\Codex_Workbench_V1\dist\package\Codex Workbench V1.exe
package_resources: dist/package/resources/app/dist/automation/
```

The review package contains this report, the decision/migration/recovery/scale reports, bounded JSON evidence, and provenance. It contains no cookies, tokens, browser profiles, passwords, private chats, or raw logs.

## Gate

```yaml
result: PASS_CANDIDATE
next_action: USER_SUBMIT_REVIEW_PACKAGE_TO_GPT
next_stage: AUT-2 (not started)
```
