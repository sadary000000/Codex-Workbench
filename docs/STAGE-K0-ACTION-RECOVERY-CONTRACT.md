# STAGE-K0 Action / Recovery Contract

Status: `IMPLEMENTED / VALIDATION IN PROGRESS`

## Required chain

```text
pinned PolicyVersion
→ EffectivePolicy
→ RuntimeCapability
→ ActionIntent
→ ActionAttempt
→ ProviderRequest
→ Observation / Receipt
→ explicit Reconcile
```

The policy is project-scoped and pinned before side-effect dispatch. The
ActionAttempt and durable idempotency/correlation reference are created before
the provider side effect.

## Unknown side effects

```text
provider accepted + local persistence uncertain
→ UNKNOWN / RECOVERY_REQUIRED
→ reattach or reconcile the same request/attempt
→ never blind resend
```

An observation or receipt with mismatched attempt, provider request,
idempotency, semantic, or external reference identity is rejected before
terminal mutation. A terminal receipt remains terminal across restart.

## Evidence

- `src/automation/requirement-provider-dispatch.ts`
- `src/automation/webgpt-external-action.ts`
- `src/automation/recovery-intent.ts`
- `src/automation/store.ts`
- `src/features/webgpt/automation/webgpt-provider-port.ts`
- `tests/arch-v2-4-external-action.test.ts`
- `tests/aut-r0-requirement-provider.test.ts`
