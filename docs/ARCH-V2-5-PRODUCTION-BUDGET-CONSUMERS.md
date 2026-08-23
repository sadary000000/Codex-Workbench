# ARCH-V2-5 Production Budget Consumers

## Consumer contract

~~~text
caller
  -> immutable policyVersionId
  -> authorizePinned(operation, correlationId, ...)
  -> reserve
  -> commit immediately before browser/provider side effect
  -> operation correlation in Request/Provider evidence
~~~

## Evidence matrix

| Operation | Pin | Reserve | Correlation | Duplicate blocked | Exhaustion blocks |
|---|---:|---:|---:|---:|---:|
| PROMPT | PASS | PASS | PASS | PASS | PASS |
| RETRY | PASS | PASS | PASS | PASS | PASS |
| NEW_CHAT | PASS | PASS | PASS | PASS | PASS |

The high-fidelity matrix is in
tests/arch-v2-5-production-consumers.test.ts. It uses temporary storage and a fake
workspace; it never sends a real business Prompt or creates a real Chat.

The RequestManager-specific test additionally proves that the persisted
policyVersionId is visible on the Request Journal and that the second Prompt is
blocked before fake submitPrompt is invoked.

## Production wiring

main.ts creates/reuses the stable WebGPT runtime policy pointer during normal
Automation persistence startup and injects it into WebGptRequestManager with
requirePolicyAuthority=true. Test-only normal GUI store smoke remains isolated.

## Non-goals

No AUT-2/AUT-3 restoration, Planner continuation, scheduler, workflow, multi-account
or real ChatGPT business Prompt was added.
