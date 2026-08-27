# STAGE-K1-D FIX ROUND 1 — Target Identity / Pre-dispatch Recovery Review

## Executive summary

```yaml
stage: STAGE-K1-D FIX ROUND 1
local_result: FIX_REQUIRED
gate: PENDING_GPT_REVIEW
status: PARTIAL_NOT_FROZEN
implementation_commit: 47e3abc5cdcacdb1adc406832bac9d02af66ff17
branch: codex/workbench-v1
implementation_scope: K1-D target identity and pre-dispatch recovery only
v1_frozen_core_changed: NO
submission_runner_changed: NO
real_planner_prompts: 0
duplicate_planner_prompt: 0
blind_resend: false
executed_steps: false
new_native_threads: 0
```

This round closes the semantic error in which a request that never reached the
browser send phase could be represented as an accepted/unknown side effect.
The Request Manager now records the pre-dispatch phase explicitly, bounds
navigation, page probing, lease admission, and pre-dispatch waiting, and maps a
known no-send outcome to `NOT_DISPATCHED`. The provider does not report such a
request as accepted and does not blind-resend it.

The real Planner smoke still cannot prove a positive roundtrip. The configured
Planner resolver is available, but the bound Chat target does not converge to a
verified page/observer identity before the bounded readiness window. The smoke
therefore ends in `RECOVERY_REQUIRED` with `WAITING_IDENTITY_READY`, before any
real Planner prompt is sent. This remains a K1-D `FIX_REQUIRED` result, not a
PASS claim and not a user/platform blocker.

## GPT feedback addressed

The previous review identified four issues: no real Planner prompt had been
sent, target navigation returned to the home route, the receipt semantics
contradicted the absence of a send, and no isolated fix evidence/commit had
been captured. This round addresses the locally actionable semantics and
evidence gaps:

1. Page navigation and probes carry a revision and reject stale results after
   navigation or destruction.
2. Target identity is checked after Composer readiness and during a bounded
   quiet window; a transient home route or stale observer cannot be accepted as
   the target.
3. Navigation, page-probe, lease-admission, and pre-dispatch waits are bounded.
   The dispatch wait yields to the event loop so those deadlines remain live.
4. `sendStartedAt` is only written immediately before the actual provider
   submit. A pre-submit identity/readiness failure remains no-dispatch.
5. The provider distinguishes `WEBGPT_REQUEST_NOT_DISPATCHED` from a provider
   rejection and records receipt external status `NOT_DISPATCHED`.
6. The smoke evidence contains bounded error codes and correlation metadata,
   not raw requirement, prompt, response, credential, cookie, or token data.

## Real smoke evidence

Evidence source: `STAGE-K1-D-REAL-PLANNER-EVIDENCE.json`.

```yaml
provider_target_resolution: AVAILABLE
provider_target_ref: webgpt-role-v1:<project-id>:PLANNER
request_state: RECOVERY_REQUIRED
request_error: WAITING_IDENTITY_READY
send_started_at: null
submitted_at: null
real_planner_prompts: 0
duplicate_planner_prompt: 0
blind_resend: false
receipt_status: FAILED
receipt_external_status: NOT_DISPATCHED
receipt_outcome_certainty: TERMINAL_FAILED
provider_status: PROVIDER_FAILED
provider_error: WEBGPT_REQUEST_NOT_DISPATCHED
target_identity_match: false
provider_request_identity_match: false
provider_observation_identity_match: false
executed_steps: false
new_native_threads: 0
```

The identity-match fields are false because there is no provider request or
observation to correlate; this is an explicit no-send result, not evidence of
a successful or partially successful Planner call. The target resolver being
`AVAILABLE` is not equivalent to page identity being ready.

## Contract and safety matrix

| Area | Result | Evidence |
| --- | --- | --- |
| Canonical target validation | PASS locally | workspace/request-manager tests |
| Stale page/probe invalidation | PASS locally | WebGPT workspace tests |
| Pre-dispatch deadline | PASS locally | bounded manager/provider implementation |
| Known no-send classification | PASS locally | provider boundary and K1-C tests |
| Post-submit recovery semantics | PASS locally | request-manager recovery tests |
| Real Planner positive send | NOT PROVEN | `real_planner_prompts: 0` |
| Target/observer convergence | FAIL CLOSED | `WAITING_IDENTITY_READY` |
| Blind resend | PASS | `blind_resend: false` |
| New Chat / native thread | PASS | `new_native_threads: 0` |
| Plan promotion | NOT REACHED | no valid real Planner result |

## Verification

```yaml
npm_run_check: PASS
npm_test: PASS (473/473)
npm_audit_omit_dev: PASS (0 vulnerabilities)
npm_run_build: PASS
npm_run_package_win: PASS
git_diff_check_tolerant_cr_at_eol: PASS
git_diff_check_strict: PRE_EXISTING_WORKTREE_LINE_ENDING_NOISE
```

The strict diff check reports line-ending/trailing-whitespace noise from the
shared dirty worktree. It was not normalized because that would modify
unrelated user-owned files. The K1-D selected files pass the tolerant check.

## Scope boundary

No Workbench UI, WebGPT page logic, Provider Port architecture, Policy
Authority, InputRef model, Automation Foundation, K2, or Submission Runner
product code was added by this round. No private API, cookie, token, password,
or browser profile was accessed. No new Chat was created and no second real
business prompt was sent.

## Review decision requested

Please assess this package and return one explicit primary Gate and one
independent Status. Do not infer PASS from local tests, resolver availability,
or the existence of a durable ActionAttempt. The required final two physical
lines are:

```text
Gate: PASS | FIX_REQUIRED | BLOCKED | REDESIGN
Status: <explicit status>
```
