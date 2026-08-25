# STAGE-K0 Persistence Boundary

Status: `IMPLEMENTED / VALIDATION IN PROGRESS`

## Three state classes

```text
Canonical durable truth
  AutomationProject / Requirement / Policy / Action / Receipt / Evidence

Process-owned transient state
  unresolved InputRef payloads, active in-process handles, lease objects

Rebuildable projection
  UI views, diagnostics projections, derived summaries
```

The Automation database does not become a second Native transcript, ChatGPT
conversation, browser DOM, cookie/token store, or temporary browser handle.

## Migration contract

```text
validate source
→ create side-by-side candidate / backup
→ migrate in a transaction
→ validate destination and canonical identity
→ promote
```

Candidate corruption, interrupted migration, identity drift, or transaction
failure leaves the prior canonical source intact and fails closed. SQLite and
JSON paths use explicit schema/version metadata and writer boundaries.

## Evidence

- `src/automation/migration-contract.ts`
- `src/automation/migration-identity.ts`
- `src/automation/sqlite-persistence.ts`
- `src/automation/schema.ts`
- `tests/automation-persistence.test.ts`

No production `automation.db` was created by this test run; all persistence
fixtures use isolated temporary roots.
