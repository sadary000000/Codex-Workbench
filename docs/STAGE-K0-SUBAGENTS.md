# STAGE-K0 Subagent Record

All four required K0 agents were dispatched with non-overlapping ownership,
allowed to run to natural completion, and only then closed. No agent was
terminated, stopped, or closed while running.

| agent | task | mode | natural completion | result | adopted |
|---|---|---|---|---|---|
| K0-A | Domain / RequirementOrigin / version-chain audit | READ_ONLY | completed | found explicit-origin, chain, migration, identity, and policy-scope gaps | yes; store/schema/migration fixes |
| K0-B | Persistence / migration / identity / security audit | READ_ONLY + test suggestions | completed | found full-document comparison, rollback, and accepted-side-effect correlation risks | yes; comparator, rollback, correlation recovery |
| K0-C | Policy / Action / Recovery regression audit | READ_ONLY | completed | found generic reconcile and policy/correlation bypass risks | yes; policy scope, formal reconcile seam, fail-closed generic reconcile |
| K0-D | Independent challenge after first implementation | READ_ONLY CHALLENGE | completed | found duplicate roots, orphan origins, migration fingerprint and accepted-side-effect gaps | yes; schema and migration hardening; recovery-only disposition |

Final accounting:

```yaml
subagents_started: 4
subagents_completed: 4
running_subagents: 0
```

The findings were reviewed by the main agent. Scope-external findings were
recorded as deferred debt rather than expanded into K0.
