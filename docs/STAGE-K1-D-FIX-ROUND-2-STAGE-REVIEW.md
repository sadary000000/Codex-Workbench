# STAGE-K1-D Fix Round 2 — Target Identity Lifecycle Review

```yaml
stage: STAGE-K1-D FIX ROUND 2
implementation_commit: 62e8cbb9691c04a6f2a7e64c59bdf1fa458fb0aa
review_freeze_base_commit: 62e8cbb9691c04a6f2a7e64c59bdf1fa458fb0aa
review_package_source_commit: 62e8cbb9691c04a6f2a7e64c59bdf1fa458fb0aa
local_result: BLOCKED_EXTERNAL_TARGET
smoke_result: BLOCKED
gate: PENDING_GPT_REVIEW
status: TARGET_RESOURCE_UNAVAILABLE
v1_frozen_core_changed: NO
planner_prompts: 0/1
duplicate_prompts: 0
blind_resend: false
new_chat: 0
```

## Executive summary

Round 2 added the target lifecycle evidence requested by GPT and removed the
history-only hydration delay for a planning-only Planner send. Local checks,
build, and the Windows package pass. The controlled real smoke still stopped
before the browser send boundary: the bound Planner Chat matched the expected
identity for several consecutive samples, then Electron and the page probe
both returned to the global ChatGPT home route. The Request Manager therefore
returned `WAITING_IDENTITY_READY` and recorded `WEBGPT_REQUEST_NOT_DISPATCHED`.

This is a fail-closed external target-resource blocker. It is not safe to fix
by accepting the home composer, weakening identity checks, searching history,
creating a Chat, rebinding silently, or sending a second prompt.

## GPT feedback scope implemented

1. `WebGptWorkspace` now records a bounded, sanitized target lifecycle:
   binding resolution, navigation start/settled, identity samples, quiet
   confirmation, Composer readiness, hydration samples, observer epoch, and
   timeout/mismatch reasons. URLs and page content are represented by hashes.
2. Planner target hydration no longer waits for pre-existing message history
   before the strict identity and Composer checks. A blank Planner Chat is a
   valid send target; the identity gate remains mandatory.
3. The K1-D smoke captures the lifecycle trace and classifies a pre-send
   `WAITING_IDENTITY_READY` as `BLOCKED`, instead of presenting it as a normal
   fix result.
4. No Provider Port, Policy Authority, InputRef, WebGPT page logic, Submission
   Runner, or V1 Frozen Core changes were made.

## First mismatch evidence

The latest sanitized evidence is
`STAGE-K1-D-FIX-ROUND-2-REAL-PLANNER-EVIDENCE.json`.

| Lifecycle point | Evidence | Meaning |
| --- | --- | --- |
| Binding resolved | target hash `552ae380…`, resolution `AVAILABLE` | Local role registry and request target agree |
| Target settled | Electron/page-probe/expected hashes all `552ae380…` | Navigation reached the bound target |
| Quiet window | same hashes, Composer found, observer `NO_CANDIDATE` | Strict identity was temporarily stable |
| Hydration | `hydration_initial_empty_allowed`, counts `0/0` | The new path did not wait on old history |
| First divergence | Electron/page-probe hash `5d9354f7…` | Both moved to the global home route |
| Final state | `WAITING_IDENTITY_READY`, no send timestamp | Browser side effect was never crossed |

The first divergence occurs at `2026-08-27T03:26:10Z` in the evidence trace.
The expected target hash is the same as the persisted binding; the changed
hash is the sanitized hash of `https://chatgpt.com/`. The generic home
Composer still reports `onChatPage=true`, which is why the URL identity gate
must remain authoritative.

## Smoke and safety result

```yaml
provider_target_resolution: AVAILABLE
target_identity_match: false_at_final_boundary
observer_identity_match: false_at_final_boundary
request_error: WAITING_IDENTITY_READY
provider_result: WEBGPT_REQUEST_NOT_DISPATCHED
send_started_at: null
submitted_at: null
real_planner_prompts: 0
duplicate_planner_prompts: 0
provider_request_ref: null
provider_observation_ref: null
receipt: FAILED / NOT_DISPATCHED / TERMINAL_FAILED
blind_resend: false
new_chat: 0
```

The local result is `BLOCKED_EXTERNAL_TARGET`, not a successful Planner
roundtrip. K1-B validation and Plan persistence/restart are consequently not
claimed as real-smoke results.

## Automated verification

```yaml
npm_run_check: PASS
npm_test: PASS (473/473)
npm_audit_omit_dev: PASS (0 vulnerabilities)
git_diff_check: PASS (cr-at-eol; unrelated dirty worktree preserved)
npm_run_build: PASS
npm_run_package_win: PASS
```

## Subagents

Exactly three current-round audit streams were started and completed
naturally. They were read-only/test-only and did not edit production files.
See `STAGE-K1-D-FIX-ROUND-2-SUBAGENTS.md`.

```yaml
subagents_started: 3
subagents_completed: 3
running_subagents: 0
```

## Review decision requested

Please review the implementation, lifecycle trace, and no-send proof. Return
one primary Gate and one independent Status. Do not infer a positive Planner
roundtrip from local tests or from the existence of an ActionAttempt.

The remaining question is whether the existing authorized Planner binding is a
currently reachable/stable Chat in the review environment. If it is not
provable, keep the result blocked; do not recommend fallback to the current
Chat, history search, new Chat creation, or a blind retry.

```text
Gate: PASS | FIX_REQUIRED | BLOCKED | REDESIGN
Status: <explicit status>
```

