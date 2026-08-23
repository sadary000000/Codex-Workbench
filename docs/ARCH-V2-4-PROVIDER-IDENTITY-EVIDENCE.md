# ARCH-V2-4 FIX-02 Provider Identity Evidence

## Validation order

Provider observation correlation is validated before Observation ExternalRef, Observation Evidence, Attempt observation link or Receipt mutation.

The validation covers:

- providerRequestId;
- provider identity = WEBGPT;
- input targetChatUrl = ProviderRequest targetChatUrl = Observation targetChatUrl after normalizeRoleChatUrl;
- ActionIntent project = caller project;
- persisted ActionAttempt intent/provider reference;
- ProviderRequest ExternalRef project, kind, provider and opaqueId.

## Tests

The targeted suite includes request-id mismatch, provider mismatch, target mismatch, wrong reconcile observation and provider-request target mismatch cases.

Representative result:

~~~yaml
error_code: PROVIDER_OBSERVATION_CORRELATION_MISMATCH
mismatch: targetIdentity
receipt_count_after_mismatch: 0
observation_external_ref_count_after_mismatch: 0
redispatch: false
~~~

The new provider-request target test makes provider.submit return a ProviderRequest whose target is another Chat. The bridge rejects it before terminalization.

## Boundary

A provider observation is untrusted external evidence. It cannot create a workflow PASS, replace the target Chat, or make a wrong Chat valid. No second Provider model was introduced.
