# STAGE-K1-D FIX ROUND 1 Subagent Evidence

The four authorized K1-D audit streams were started once and completed
naturally. They were not terminated, duplicated, or restarted for this fix
round. Their findings were used as review constraints; no conflicting
production-file ownership was introduced.

```yaml
subagents_started: 4
subagents_completed: 4
running_subagents: 0
```

## SA1 — Real Provider Boundary Audit

Confirmed the production path remains provider-neutral and that the target
reference must remain opaque. A real Planner positive path requires a valid
control-plane target and must not infer the target from the current page.

## SA2 — Recovery / Persistence Audit

Flagged accepted-side-effect/local-persistence races and provider-reference
loss as recovery concerns. The fix preserves recovery-only behavior and does
not claim a terminal Planner result without a verified send.

## SA3 — Policy / Ledger Challenge

Confirmed the PolicyVersion → ActionIntent → ActionAttempt → ProviderRequest →
Observation → Receipt chain and highlighted late-failure/provenance risks. The
pre-dispatch path now records `NOT_DISPATCHED` instead of accepted unknown.

## SA4 — Independent K1-D Challenge

Rejected a PASS conclusion without a real Planner positive roundtrip and warned
about provider-scope/identity gaps. The latest smoke evidence reflects that
challenge: zero submitted prompts, no blind resend, no new Chat, and a bounded
identity-readiness failure.

