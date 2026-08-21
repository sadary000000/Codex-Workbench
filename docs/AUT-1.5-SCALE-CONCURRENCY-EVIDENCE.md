# AUT-1.5 Scale and Concurrency Evidence

## Concurrency gate

| Test | Result |
|---|---|
| 25 same-process concurrent callers | PASS |
| Transaction rollback preserves document and audit | PASS |
| Audit append-only validation | PASS |
| Second process competing for the same database | PASS: `AUTOMATION_DB_LOCKED` |
| SQLite `busy_timeout` | PASS: 2000 ms |
| Foreign keys | PASS |
| Full synchronous durability setting | PASS: SQLite value `2` |

The store's single writer authority prevents the stale-snapshot loss pattern. Same-process calls are serialized before the durable transaction. A second process is not merged or queued implicitly; it receives a machine-readable lock error and must be handled by its caller.

## Scale gate

The scale fixture imported the following bounded records into one SQLite database:

```yaml
projects: 100
stages: 1000
steps: 10000
audit_events: 50000
evidence_records: 10000
action_intents: 10000
total_records: 91300
elapsed: 2240 ms
gate_limit: 60000 ms
result: PASS
```

The test checks that the resulting document reloads and validates. It is a bounded V1 readiness gate, not a claim of unlimited production capacity.

## Operational boundary

The current design is a single Workbench Automation Host writer. It does not offer a distributed lock, multi-host database, or concurrent CLI writer protocol. If future automation requires multiple processes or machines, that is a separate design decision and must not be inferred from this gate.
