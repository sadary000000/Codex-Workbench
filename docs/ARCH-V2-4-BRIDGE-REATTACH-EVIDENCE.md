# ARCH-V2-4 FIX-01 Bridge Reattach Evidence

## Contract

同一 project、role、规范化 targetChatUrl、idempotency key 与 semanticSha256 的可恢复 WebGPT request，在 readiness classifier 返回 reattachRequestId 时，Bridge 只能复用原有 correlation：

~~~text
ActionIntent
  -> existing ActionAttempt
  -> existing WEBGPT_PROVIDER_REQUEST ExternalRef
  -> existing ResourceClaim
  -> provider.reconcile
~~~

不得 createActionAttempt、provider.submit、替代 ProviderRequest 或替代 Thread/Chat。

## Direct test

Test: tests/arch-v2-4-external-action.test.ts
Name: FIX-01 Bridge same-semantic reattach reuses the existing Attempt and ProviderRequest

Observed:

~~~yaml
reattachRequestId: provider-reattach
submitCount: 1
reconcileCount: 1
attemptCountBeforeAfter: unchanged
providerRequestExternalRefCountBeforeAfter: unchanged
receipt: SUCCEEDED
reconcileState: RECONCILED
native_or_web_prompt_sent: 0
~~~

The first submit is fixture setup. The reattach path itself performs no second submit.

## Fail-closed checks

The reattach path rejects missing dispatchFacts, mismatched idempotency, semantic drift, project/role mismatch, target mismatch, missing ProviderRequest correlation, duplicate correlation and missing Attempt/ResourceClaim correlation. It does not silently fall back to a new dispatch.

## Limitation

This is a contract/integration fixture at the Bridge boundary, not a real ChatGPT business Prompt. Real provider Prompt execution remains out of scope for this round.
