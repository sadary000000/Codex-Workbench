# ARCH-V2-4 FIX-03 Production-Equivalent Composition Evidence

## Composition under test

~~~text
WebGptExternalActionBridge
  -> createWebGptRequestManagerActionAdapter
  -> WebGptRequestManager.submit/requestStatus/reconcileRequest
  -> WebGptOperationArbiter live Browser lease
  -> ProviderRequest / ExternalRef / ResourceClaim
~~~

The adapter maps the existing RequestManager record to ProviderRequest and maps the existing live lease snapshot to the ProviderRequest resourceLease. Observation and reconcile use requestStatus/reconcileRequest; they do not call submit.

## Gate result

~~~yaml
composition: PASS
caller_activation: PAUSED
workflow_requirement_planner: NOT_ACTIVATED
real_business_prompts: 0
v1_frozen_core_changed: NO
second_provider_model: NO
~~~

The production-equivalent composition proof is an isolated integration fixture using the real Bridge, real RequestManager adapter and real OperationArbiter contract. It does not claim a live GUI/WebGPT business roundtrip.
