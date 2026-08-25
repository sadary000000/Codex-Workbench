# STAGE-K0 Subagent Record

Date: `2026-08-26`

The first three required audits completed naturally before the first implementation pass. The independent challenge was dispatched after the targeted implementation tests passed and also completed naturally.

| agent | id | task | mode | result |
|---|---|---|---|---|
| K0-A | `01a03a05-72dc-7a31-aa67-eb3abe1fa0dc` | Domain ownership / RequirementOrigin / version chain | READ_ONLY | completed; reuse primitives, repair integration and scope checks |
| K0-B | `01a03a05-7378-7ac2-8068-e221910a180a` | Persistence / migration / identity / security | READ_ONLY + TEST_RECOMMENDATION_ONLY | completed; repair row identity, opaque boundary, provider-ref ownership, migration coverage |
| K0-C | `01a03a05-7447-79a2-889b-893170682f8b` | Policy / Action / Provider / Recovery | READ_ONLY | completed; repair project scope and accepted-side-effect durable UNKNOWN path |
| K0-D | `01a03a1f-ef50-78d2-9a5b-b648b03b314e` | Independent challenge after implementation | READ_ONLY CHALLENGE | completed; five blockers fixed in the authorized K0 scope |

## Findings adopted in scope

- accepted provider identity mismatch and accepted local persistence failure now become durable UNKNOWN / RECOVERY_REQUIRED rather than terminal FAILED;
- provider correlation requires project scope and unique request/observation ownership;
- SQLite row identity and project identity are checked on load;
- Requirement versions receive an explicit immediate predecessor;
- USER confirmation supersedes the prior active version and synchronizes the associated alignment Session/Round;
- Requirement alignment payloads accept only the bounded `automation-input-v1` opaque InputRef shape.
- The legacy external-action Bridge is retained only as a paused compatibility seam in production composition; it cannot submit or reconcile.
- Accepted-provider recovery writes the opaque request marker, ActionAttempt correlation, and UNKNOWN Receipt atomically before optional evidence/lease decoration.
- Side-by-side JSON migration restores the original source after a promoted-candidate reopen failure and records raw-source mapping evidence.
- Fresh side-effecting intents must pin the current project PolicyVersion; an existing idempotent old-pin intent remains eligible only for recovery.

## Accounting at final gate

```yaml
subagents_started: 4
subagents_completed: 4
running_subagents: 0
```
