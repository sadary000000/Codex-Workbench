# STAGE-K1-D FIX ROUND 4 — Review Package

## Verdict

- Gate: `FIX_REQUIRED`
- Status: `BLOCKED`
- Disposition: `BLOCKED_MISSING_CORRELATION`
- Scope: Workbench-owned reconcile-only recovery for the existing ProviderAttempt #2
- K2: not entered

This round does not claim Planner success. The only permitted recovery action was to prove the existing durable correlation and, if proven, reconcile the same Request. The precondition did not pass, so no recovery side effect was taken.

## Fixed identity

| Field | Value |
|---|---|
| Logical PlannerRequest | `f4a70e74-6ae8-4a2b-9e3a-1d59d84f62a3` |
| Attempt #1 | `c87a55e9-11df-4eed-8251-2db1f8dbfc81` |
| Attempt #2 | `5de6027e-2ad5-43cc-b650-0861a665e935` |
| Workbench Request | `wgpt-79b08be8-2686-4d39-88c7-f41e39b6672d` |
| Project | `371c3fb8-30ac-4943-9584-1915045ea34d` |
| Role | `PLANNER` |
| Provider target | `webgpt-role-v1:371c3fb8-30ac-4943-9584-1915045ea34d:PLANNER` |
| Max provider attempts | `2` |

## Observed durable state

The exact Request Journal record is present and identity-compatible:

- `state=RECOVERY_REQUIRED`
- `error=REQUEST_NOT_VERIFIABLE`
- `sendStartedAt=2026-08-27T11:46:30.731Z`
- `submittedAt=null`
- `resultPath`, `resultSha256`, and `resultBytes` are absent
- page identity is equivalent to the bound Planner Chat
- the last page state is still `generating=true`
- the Request record has `baselineAssistantCount=1` and observed `assistantCount=2`

The Automation snapshot does not contain the exact ActionIntent/Attempt/Receipt graph required to correlate this Request to Attempt #2. The bounded preflight emitted:

`ACTION_INTENT_MISSING`, `PROVIDER_ATTEMPT_COUNT_MISMATCH`, `ATTEMPT_1_TERMINAL_CORRELATION_MISSING`, `ATTEMPT_1_RECEIPT_MISMATCH`, `ATTEMPT_2_CORRELATION_MISSING`, `ATTEMPT_2_RECEIPT_MISMATCH`, `PROVIDER_REQUEST_REF_MISMATCH`, `PROVIDER_OBSERVATION_REF_MISMATCH`, `AUTOMATION_PROJECT_MISSING`.

## Actual recovery trace

1. Read the exact existing Request by fixed Request ID.
2. Read the exact bound PLANNER role and compare the canonical-equivalent target.
3. Read the Automation snapshot and evaluate all immutable identity/correlation guards.
4. Stop before `AUTO_CONTROL`, page navigation, Composer access, Request reconciliation, Planner reconciliation, or promotion.

The run produced `docs/STAGE-K1-D-FR4-RECONCILE-EVIDENCE.json`. The Request Journal SHA-256 was identical before and after the run. No browser/page API was used by the outer Runner.

## Round counters

```json
{
  "logical_planner_requests": 1,
  "provider_attempts": 2,
  "active_provider_attempt": 0,
  "real_planner_prompts_total": 2,
  "new_planner_prompts_in_fix_round": 0,
  "attempt_3_created": 0,
  "new_webgpt_requests": 0,
  "duplicate_planner_prompt": 0,
  "blind_resend": false,
  "planner_rebinds": 0,
  "new_chatgpt_chats": 0,
  "plan_promotions": 0,
  "retry_budget_exhausted": true,
  "executed_steps": 0,
  "new_native_threads": 0,
  "verifier_started": false,
  "scheduler_started": false,
  "k2_entered": false
}
```

## Implementation and validation

The implementation adds a typed reconcile-only entry with no submit/new-request/retry/Composer/page operation in its dependency surface. The main composition root injects Workbench request, role, control, and Planner-reconcile adapters. Missing exact correlation fails closed before control acquisition. Existing recovery errors are preserved during read-only restart normalization.

Validation completed:

- TypeScript check: PASS
- full test suite: `499/499` PASS
- targeted boundary/reconcile suite: `61/61` PASS
- `npm audit --omit=dev`: 0 vulnerabilities
- `git diff --check`: PASS
- Windows build: PASS
- Windows package: PASS
- real reconcile-only run: expected `BLOCKED`, no Request Journal mutation

## Reviewer decision requested

Keep the gate at `FIX_REQUIRED` and stop K2. If a future operator supplies an exact, immutable Automation correlation for the already-existing Attempt #2, the only allowed next operation is same-Request Workbench reconciliation followed by strict result/schema/K1-B checks and exactly-once promotion. No Attempt #3, new Planner prompt, blind resend, rebind, or new Chat is allowed.
