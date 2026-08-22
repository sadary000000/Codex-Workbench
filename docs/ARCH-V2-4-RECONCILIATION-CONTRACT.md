# ARCH-V2-4 Reconciliation Contract

## Outcome certainty

The bridge uses the bounded certainty values:

```text
NOT_DISPATCHED
ACCEPTED_UNKNOWN_RESULT
RESULT_OBSERVED
TERMINAL_CONFIRMED
TERMINAL_FAILED
ABANDONED_WITH_UNKNOWN_OUTCOME
```

An accepted provider request whose result is not yet known produces one `UNKNOWN` ActionReceipt in `RECOVERY_REQUIRED`. It is never silently converted to success.

## Explicit reconcile

`WebGptExternalActionBridge.reconcile()` calls the provider adapter's explicit reconcile operation. It does not call submit, does not create a new Attempt, and updates the existing UNKNOWN Receipt in place. A terminal Receipt cannot be reconciled again.

## Retry

- same unknown side effect: blocked with `UNKNOWN_OUTCOME_SAME_SIDE_EFFECT`;
- terminal failure: a new ActionAttempt and new ProviderRequest are allowed;
- same idempotency reference with semantic drift: existing Action Domain validation rejects it;
- provider acceptance followed by local observation failure: remains unknown/recovery-required.

## Workflow boundary

Provider Observation and ActionReceipt are evidence of an external action. They do not mutate Requirement, Planner, Plan, or Workflow PASS state.
