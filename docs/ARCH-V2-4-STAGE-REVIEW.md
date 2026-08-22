# ARCH-V2-4 Stage Review

## Scope resolution

```yaml
stage: ARCH-V2-4 External Action / Resource / Reconciliation Integration
base_commit: af8659b8e3619a84d26465e0a46aeabf72a30521
implementation_commit: d304e70
goal: connect the existing Automation Action Domain with WebGPT RequestRecord, provider observation, and the existing live browser lease without creating a second truth
v1_core_changed: NO
real_aut2_aut3_prompts: 0
```

## Implemented vertical slice

- Added outcome certainty and provider correlation fields to existing ActionAttempt/ActionReceipt/ExternalRef/ResourceClaim records.
- Added project-scoped schema validation for provider/evidence/lease references, while inferring safe defaults for legacy persisted records.
- Added `WebGptExternalActionBridge` and pure `canDispatch()` safety gate.
- Added explicit unknown-result and reconcile semantics: one UNKNOWN Receipt, no blind resend, explicit reconcile updates the same Receipt.
- Added terminal-failure retry semantics: new Attempt and new provider request.
- Added `leaseEpoch` to the existing OperationArbiter identity/diagnostics and mapped provider lease references onto the existing ResourceClaim.
- Exported the bridge without changing Native Thread/Turn/Item, Request Journal ownership, Requirement/Planner truth, Map, Renderer or Control Plane architecture.

## Architecture boundary

```text
V1 Frozen Core
  Native Thread / Turn / Item truth
        |
        +-- WebGPT RequestManager / Request Journal / OperationArbiter
        |
        +-- Automation ActionIntent / ActionAttempt / ActionReceipt
              ExternalRef / Evidence / ResourceClaim
```

Provider Request is not an ActionReceipt. A historical RequestRecord is not a live resource lease. Provider Observation is not Workflow PASS.

## Tests and gates

```yaml
npm_run_check: PASS
npm_test: PASS / 313/313
arch_v2_4_targeted: PASS / 11/11
npm_run_build: PASS
npm_run_package_win: PASS
npm_audit_omit_dev: PASS / 0 vulnerabilities
secret_scan: PASS
production_request_journal: BLOCKED / SHA_CHANGED_BY_EXISTING_CONTROL_AUTO_SMOKE
```

Passing real regressions are recorded in `ARCH-V2-4-REGRESSION-EVIDENCE.md`. The existing packaged WEB-6.4 arbiter smoke remains a disclosed failure: `webgpt control auto` timed out after `webgpt open` returned `USER_CONTROL`; it sent zero real prompts and did not read credentials or page content. It is outside this stage's allowed Control Plane scope and is not hidden.

## Subagents

Five bounded audits were dispatched per the stage instruction. Their final messages must be reviewed before the gate and each agent closed after its result. `running_subagents_at_gate` is not zero until that review/close step is complete.

## Scope boundary

No AUT-2/AUT-3 Prompt, real external side effect, Automation/Workflow/Planner/Scheduler, PolicyVersion activation, provider-neutral ports, V1 Frozen Core, Native runtime, Map, Renderer or Shared Host redesign is included.

## Current gate

`ARCH-V2-4 CONTRACT PASS; FINAL GATE REVIEW REQUIRED`

The review package must disclose the pre-existing WEB-6.4 arbiter failure, the production Journal mutation, and the final subagent results. It must not claim an all-regressions PASS while that evidence remains unresolved.
