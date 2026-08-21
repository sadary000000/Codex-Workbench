# AUT-1.5 Crash Recovery Evidence

## Scope

These tests cover the Automation persistence boundary only. They do not start Codex App Server, Native Thread execution, WebGPT, a browser request, or an external action.

## Evidence matrix

| Scenario | Expected invariant | Result |
|---|---|---|
| Process exits before SQLite commit | Uncommitted entity and audit rows are absent after reopen | PASS |
| Durable intent/receipt is reopened in a new process | Persisted intent and receipt remain available; no external execution is inferred | PASS |
| JSON-to-SQLite migration is interrupted | Valid candidate or backup is recovered; no empty replacement is created | PASS |
| Corrupt persistence header/content | Store fails closed and preserves the source path | PASS |
| Future persistence schema | Store rejects it as unsupported | PASS |
| Second process opens the same database | Single writer authority returns `AUTOMATION_DB_LOCKED` | PASS |
| Same-process concurrent transactions | Store serializes writers and preserves a valid audit sequence | PASS |
| UNKNOWN receipt override | Requires `RECOVERY_REQUIRED`; duplicate receipt is rejected | PASS |

## Crash semantics

The SQLite rollback journal is the durability mechanism. A hard kill can leave a rollback journal temporarily present; reopening SQLite rolls back the incomplete transaction before the store reads the document. The test gate is recovery of the valid committed state, not absence of every transient journal file.

## Findings resolved during the audit

- Cross-process stale-snapshot writers previously had no safe merge boundary. The production path now has an exclusive writer marker and fails closed for a competing process. Cross-process direct writes remain unsupported by design.
- Unknown sensitive extra fields could bypass a shallow record check. The persisted boundary now recursively rejects sensitive field names and bounds nesting.
- An `UNKNOWN` receipt could be treated as a normal terminal result or duplicated. Schema and store validation now require `RECOVERY_REQUIRED` and one receipt per attempt.
- A retry model that treated an intent as one attempt prevented explicit reauthorization. The schema now supports multiple dispatch attempts with unique `(intentId, dispatchNumber)` identity.

## Not claimed

This evidence does not claim exactly-once execution of an external side effect. It claims durable intent/attempt/receipt state, no blind replay after restart, explicit recovery for uncertainty, and no external execution in the tests.
