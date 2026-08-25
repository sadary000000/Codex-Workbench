# STAGE-K0 Policy / Action / Recovery Check

Date: `2026-08-25`

## Required execution chain

```text
pinned PolicyVersion
  → EffectivePolicy (project scoped)
  → RuntimeCapability
  → ActionIntent
  → ActionAttempt
  → ProviderRequest
  → ProviderObservation / Receipt
  → Reconcile
```

K0 does not add an executor, planner, scheduler, or reviewer. It closes the
foundation invariants around the chain already used by the Requirement
provider boundary.

## Check matrix

| check | result | evidence |
|---|---|---|
| policy is pinned before side-effect dispatch | PASS | `store.ts`, `effective-policy.ts`, policy contract tests |
| policy pin is scoped to the dispatch project | PASS | `webgpt-policy-authority.ts`, provider dispatch correlation |
| ActionIntent is idempotent and durable before dispatch | PASS | `store.ts`, `requirement-provider-dispatch.ts` |
| accepted provider request has a correlation path | PASS | `ProviderCorrelation.projectId`, `resolveRequestByCorrelation`, provider-boundary tests |
| local provider-reference persistence failure cannot trigger blind resend | PASS / FAIL-CLOSED | reconcile reattaches by existing idempotency reference or returns recovery-required |
| observation identity is checked against the attempt | PASS | provider observation correlation and `assertStoredProviderRefs` |
| unknown result is reconcile-only | PASS | receipt/recovery state machine and AUT-R0 regression |
| generic reconcile can bypass the Automation chain | NO | `main.ts` returns `AUTOMATION_RECONCILE_REQUIRED`; formal Requirement reconcile is the allowed seam |

## Recovery invariant

`Provider accepted` is not equivalent to `Requirement completed`. If the local
provider reference is missing after acceptance, the durable intent and
idempotency reference remain the authority. Reconcile may resolve the existing
provider request and attach it to the same ActionAttempt. If correlation cannot
be proven, the result is `RECOVERY_REQUIRED`; no new Chat, Prompt, or provider
dispatch is created.

## Out-of-scope findings

The old review-submit helper and the Submission Runner have their own ledger
and are not part of the Automation provider chain. They were not modified in
K0. Any future hardening of that external review tool remains deferred and
does not authorize a K0 bypass.
