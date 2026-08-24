# AUT-R0 Requirement Production Rewire

## Boundary

The active production composition is:

```text
RequirementAutomationService
  -> RequirementProviderDispatch
  -> AutomationProviderPort
  -> ActionIntent / ActionAttempt / ProviderRequest / Observation / Receipt
```

The provider port is the only side-effect boundary. The main-process
composition root creates it with the shared process-owned `InputRefRegistry`.
The provider-neutral path receives only an opaque provider target and InputRef.

The executable main-process entry is the authenticated Control Plane trio:
`webgpt.requirement.start`, `webgpt.requirement.draft`, and
`webgpt.requirement.reconcile`. The Control Plane uses separate
`requirementSessionId`/`requirementRoundId` fields so its own authenticated
session identity cannot be confused with an Automation alignment identity.

## Request/response separation

The active provider path no longer constructs a legacy
`IWebGPTRequirementRequest` or `RequirementChatBinding` merely to parse a
response. It creates a neutral `RequirementEnvelopeContext` containing only
project, role, request, idempotency, and domain semantic identity. The old
request object remains available only for paused/test-only compatibility
callers.

The response parser attaches trusted local envelope identity to provider
semantic data. A provider-owned execution semantic returned after acceptance
is stored separately from the domain semantic and is used for reconciliation.

## Recovery and idempotency

- An existing ActionIntent for the same idempotency reference produces
  `RECOVERY_REQUIRED`; it cannot submit again.
- Accepted-but-unresolved provider work is recorded as `UNKNOWN`/
  `RECOVERY_REQUIRED` and must be reconciled before another attempt.
- A `NEEDS_INPUT` result closes its current round and creates a fresh next-round
  identity. Provider request, InputRef, and Action ledger references are not
  copied into the next round.
- Missing policy pin is rejected before an ActionIntent is created.
- The Requirement round receives ActionIntent/ActionAttempt references before
  `AutomationProviderPort.submit` is called. Accepted provider request and
  observation refs are attached transactionally; a persistence failure becomes
  `RECOVERY_REQUIRED`/`UNKNOWN` and cannot turn into a blind resend.
- A provider result must preserve both provider identity and accepted request
  identity before a terminal receipt is recorded.

## Legacy containment

The paused AUT-2/AUT-3 real harnesses and the legacy WebGPT Requirement
adapter remain explicitly classified as paused/test-only seams. The production
barrel no longer exports the legacy adapter. No active provider-neutral caller
uses a URL-shaped target or current-chat fallback.

## Frozen boundaries preserved

Native Thread/Turn/Item remain the runtime facts. This change does not create a
second Conversation, Transcript, Requirement, Task, or execution-history truth
source, and it does not modify the old donor project.
